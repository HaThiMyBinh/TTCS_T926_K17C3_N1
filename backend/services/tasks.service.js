// Nghiệp vụ Mentor giao nhiệm vụ cho thực tập sinh (Task assignment)
const db = require("../db");
const { HttpError } = require("../errors");
const { assertHasConfirmedContract } = require("./contractGate");
const { getVietnamToday } = require("../utils/date");
const storage = require("./fileStorage");
const {
  MAX_ATTACHMENTS_PER_TASK,
  INLINE_MIME_TYPES,
  validateAttachment,
} = require("./attachmentValidator");
const { sanitizeFileName } = require("./documentValidator");

const TITLE_MAX_LENGTH = 255;
const DESCRIPTION_MAX_LENGTH = 5000;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
const STATUSES = ["TODO", "IN_PROGRESS", "DONE"];
const PROGRESS_NOTE_MAX_LENGTH = 2000;
// Intern chỉ được gửi các trường này khi cập nhật tiến độ.
const PROGRESS_FIELDS = ["status", "progress_percent", "progress_note"];

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseId(rawId, label) {
  const text = String(rawId ?? "");
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new HttpError(400, `${label} không hợp lệ!`);
  }
  return Number(text);
}

function has(input, key) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

/**
 * Chuẩn hóa và kiểm tra dữ liệu nhiệm vụ.
 * - Tạo mới (partial=false): bắt buộc có title.
 * - Cập nhật (partial=true): chỉ kiểm tra các trường được gửi, cần ít nhất
 *   một trường.
 * - Hạn nộp phải từ hôm nay (giờ Việt Nam) trở đi; khi sửa, giữ nguyên hạn cũ
 *   (đã quá hạn) vẫn hợp lệ.
 * Trả về object khóa nội bộ: title, description, dueDate, priority, status.
 */
function validateTaskInput(
  input,
  { partial = false, today = getVietnamToday(), currentDueDate = null } = {},
) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "Dữ liệu nhiệm vụ không hợp lệ!");
  }

  const value = {};

  if (has(input, "title")) {
    if (typeof input.title !== "string") {
      throw new HttpError(400, "Tiêu đề nhiệm vụ phải là chuỗi!");
    }
    const title = input.title.trim();
    if (!title) {
      throw new HttpError(400, "Vui lòng nhập tiêu đề nhiệm vụ!");
    }
    if (title.length > TITLE_MAX_LENGTH) {
      throw new HttpError(
        400,
        `Tiêu đề nhiệm vụ không được vượt quá ${TITLE_MAX_LENGTH} ký tự!`,
      );
    }
    value.title = title;
  } else if (!partial) {
    throw new HttpError(400, "Vui lòng nhập tiêu đề nhiệm vụ!");
  }

  if (has(input, "description")) {
    if (input.description !== null && typeof input.description !== "string") {
      throw new HttpError(400, "Mô tả nhiệm vụ phải là chuỗi!");
    }
    const description = (input.description || "").trim();
    if (description.length > DESCRIPTION_MAX_LENGTH) {
      throw new HttpError(
        400,
        `Mô tả nhiệm vụ không được vượt quá ${DESCRIPTION_MAX_LENGTH} ký tự!`,
      );
    }
    value.description = description || null;
  }

  if (has(input, "due_date")) {
    const raw = input.due_date;
    if (raw === null || raw === "") {
      value.dueDate = null;
    } else {
      if (!isValidDate(raw)) {
        throw new HttpError(
          400,
          "Hạn hoàn thành phải có dạng YYYY-MM-DD hợp lệ!",
        );
      }
      if (raw < today && raw !== currentDueDate) {
        throw new HttpError(400, "Hạn hoàn thành không được là ngày đã qua!");
      }
      value.dueDate = raw;
    }
  }

  if (has(input, "priority")) {
    if (!PRIORITIES.includes(input.priority)) {
      throw new HttpError(400, "Mức ưu tiên chỉ nhận LOW, MEDIUM hoặc HIGH!");
    }
    value.priority = input.priority;
  }

  if (partial && has(input, "status")) {
    if (!STATUSES.includes(input.status)) {
      throw new HttpError(
        400,
        "Trạng thái chỉ nhận TODO, IN_PROGRESS hoặc DONE!",
      );
    }
    value.status = input.status;
  }

  if (partial && Object.keys(value).length === 0) {
    throw new HttpError(
      400,
      "Cần gửi ít nhất một trường để cập nhật nhiệm vụ!",
    );
  }
  return value;
}

/**
 * Đồng bộ trạng thái và % tiến độ (DONE <=> 100%, TODO <=> 0%,
 * IN_PROGRESS <=> 0-99%).
 * - current: { status, percent } hiện tại của nhiệm vụ.
 * - input: { status?, percent? } do người dùng gửi (undefined = không gửi).
 * Trả về { status, percent } mới; ném 400 nếu hai giá trị mâu thuẫn.
 */
function resolveProgress(current, input = {}) {
  const hasStatus = input.status !== undefined;
  const hasPercent = input.percent !== undefined;
  const conflict = () =>
    new HttpError(400, "Trạng thái và phần trăm tiến độ không khớp nhau!");

  if (hasStatus && hasPercent) {
    const { status, percent } = input;
    const ok =
      (status === "DONE" && percent === 100) ||
      (status === "TODO" && percent === 0) ||
      (status === "IN_PROGRESS" && percent < 100);
    if (!ok) throw conflict();
    return { status, percent };
  }

  if (hasStatus) {
    const { status } = input;
    if (status === "DONE") return { status, percent: 100 };
    if (status === "TODO") return { status, percent: 0 };
    // Mở lại việc đã DONE: giữ tiến độ nhưng không còn là 100%.
    return { status, percent: Math.min(current.percent, 99) };
  }

  if (hasPercent) {
    const { percent } = input;
    if (percent === 100) return { status: "DONE", percent };
    if (percent > 0) return { status: "IN_PROGRESS", percent };
    // 0%: giữ IN_PROGRESS nếu đang làm, còn lại về TODO.
    const status = current.status === "IN_PROGRESS" ? "IN_PROGRESS" : "TODO";
    return { status, percent };
  }

  return { status: current.status, percent: current.percent };
}

/**
 * Kiểm tra dữ liệu intern gửi khi cập nhật tiến độ.
 * Trả về object khóa nội bộ: status?, progressPercent?, progressNote?.
 */
function validateProgressInput(input, current) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "Dữ liệu tiến độ không hợp lệ!");
  }
  const extra = Object.keys(input).filter((k) => !PROGRESS_FIELDS.includes(k));
  if (extra.length > 0) {
    throw new HttpError(
      400,
      "Thực tập sinh chỉ được cập nhật trạng thái, phần trăm tiến độ và ghi chú tiến độ!",
    );
  }
  if (!PROGRESS_FIELDS.some((k) => has(input, k))) {
    throw new HttpError(400, "Cần gửi ít nhất một trường tiến độ để cập nhật!");
  }

  const raw = {};
  if (has(input, "status")) {
    if (!STATUSES.includes(input.status)) {
      throw new HttpError(
        400,
        "Trạng thái chỉ nhận TODO, IN_PROGRESS hoặc DONE!",
      );
    }
    raw.status = input.status;
  }
  if (has(input, "progress_percent")) {
    const percent = input.progress_percent;
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      throw new HttpError(
        400,
        "Phần trăm tiến độ phải là số nguyên từ 0 đến 100!",
      );
    }
    raw.percent = percent;
  }

  const value = {};
  if (raw.status !== undefined || raw.percent !== undefined) {
    const resolved = resolveProgress(current, raw);
    value.status = resolved.status;
    value.progressPercent = resolved.percent;
  }

  if (has(input, "progress_note")) {
    if (
      input.progress_note !== null &&
      typeof input.progress_note !== "string"
    ) {
      throw new HttpError(400, "Ghi chú tiến độ phải là chuỗi!");
    }
    const note = (input.progress_note || "").trim();
    if (note.length > PROGRESS_NOTE_MAX_LENGTH) {
      throw new HttpError(
        400,
        `Ghi chú tiến độ không được vượt quá ${PROGRESS_NOTE_MAX_LENGTH} ký tự!`,
      );
    }
    value.progressNote = note || null;
  }
  return value;
}

// DTO tệp đính kèm (không lộ stored_name).
function toAttachmentDto(row) {
  return {
    id: Number(row.id),
    task_id: Number(row.taskId),
    original_name: sanitizeFileName(row.originalName),
    mime_type: row.mimeType,
    size_bytes: Number(row.sizeBytes),
    can_preview: INLINE_MIME_TYPES.includes(row.mimeType),
    uploaded_at: row.uploadedAt || null,
  };
}

function toTaskDto(row, today = getVietnamToday(), attachments = []) {
  const dueDate = row.dueDate || null;
  return {
    id: Number(row.id),
    intern_id: Number(row.internId),
    intern_name: row.internName || "",
    student_code: row.studentCode || "",
    mentor_name: row.mentorName || "",
    title: row.title,
    description: row.description || "",
    due_date: dueDate,
    priority: row.priority,
    status: row.status,
    progress_percent: Number(row.progressPercent) || 0,
    progress_note: row.progressNote || "",
    progress_updated_at: row.progressUpdatedAt || null,
    attachments: attachments.map(toAttachmentDto),
    is_overdue: Boolean(dueDate && row.status !== "DONE" && dueDate < today),
    created_at: row.createdAt || null,
    updated_at: row.updatedAt || null,
  };
}

// Chuyển danh sách dòng nhiệm vụ thành DTO kèm tệp đính kèm (1 truy vấn cho cả danh sách).
async function toTaskDtos(rows) {
  const today = getVietnamToday();
  const grouped = await db.listTaskAttachmentsByTaskIds(rows.map((r) => r.id));
  return rows.map((row) =>
    toTaskDto(row, today, grouped[Number(row.id)] || []),
  );
}

async function loadTaskDto(id) {
  const row = await db.findInternTaskById(id);
  return row ? (await toTaskDtos([row]))[0] : null;
}

async function requireMentorProfile(user) {
  const mentor =
    user?.role === "Mentor" && user.email
      ? await db.findMentorByEmail(user.email)
      : null;
  if (!mentor) {
    throw new HttpError(
      403,
      "Tài khoản chưa có hồ sơ mentor để giao nhiệm vụ!",
    );
  }
  return mentor;
}

function assertInternBelongsToMentor(mentor, internMentorId) {
  if (!internMentorId || Number(internMentorId) !== Number(mentor.id)) {
    throw new HttpError(
      403,
      "Bạn chỉ được giao và quản lý nhiệm vụ của thực tập sinh được phân công cho mình!",
    );
  }
}

async function loadOwnedTask(mentor, rawTaskId) {
  const taskId = parseId(rawTaskId, "Mã nhiệm vụ");
  const task = await db.findInternTaskById(taskId);
  if (!task) throw new HttpError(404, "Không tìm thấy nhiệm vụ!");
  assertInternBelongsToMentor(mentor, task.internMentorId);
  return task;
}

async function createTask(user, body) {
  const mentor = await requireMentorProfile(user);
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Dữ liệu nhiệm vụ không hợp lệ!");
  }
  const internId = parseId(body.intern_id, "Mã thực tập sinh");
  const value = validateTaskInput(body);

  const intern = await db.findInternProfileById(internId);
  if (!intern) throw new HttpError(404, "Không tìm thấy thực tập sinh!");
  assertInternBelongsToMentor(mentor, intern.mentorId);
  await assertHasConfirmedContract(
    internId,
    "Thực tập sinh chưa có hợp đồng được xác nhận nên chưa thể giao nhiệm vụ!",
  );

  const id = await db.insertInternTask({
    internId,
    createdByMentorId: mentor.id,
    ...value,
  });
  return loadTaskDto(id);
}

async function listTasksForMentor(user, query = {}) {
  const mentor = await requireMentorProfile(user);
  let internId = null;
  if (has(query, "intern_id")) {
    internId = parseId(query.intern_id, "Mã thực tập sinh");
  }
  let status = null;
  if (has(query, "status")) {
    if (!STATUSES.includes(query.status)) {
      throw new HttpError(
        400,
        "Trạng thái chỉ nhận TODO, IN_PROGRESS hoặc DONE!",
      );
    }
    status = query.status;
  }
  const rows = await db.listInternTasksForMentor(mentor.id, {
    internId,
    status,
  });
  return toTaskDtos(rows);
}

async function updateTask(user, rawTaskId, body) {
  const mentor = await requireMentorProfile(user);
  const task = await loadOwnedTask(mentor, rawTaskId);
  const value = validateTaskInput(body, {
    partial: true,
    currentDueDate: task.dueDate || null,
  });
  if (value.status !== undefined) {
    // Mentor đổi trạng thái thì % tiến độ phải khớp theo.
    const synced = resolveProgress(
      { status: task.status, percent: Number(task.progressPercent) || 0 },
      { status: value.status },
    );
    value.progressPercent = synced.percent;
  }
  await db.updateInternTask(task.id, value);
  return loadTaskDto(task.id);
}

async function deleteTask(user, rawTaskId) {
  const mentor = await requireMentorProfile(user);
  const task = await loadOwnedTask(mentor, rawTaskId);
  // Lấy tên file trước vì bản ghi đính kèm bị xóa theo nhiệm vụ (ON DELETE CASCADE).
  const files = (await db.listTaskAttachmentsByTaskIds([task.id]))[
    Number(task.id)
  ];
  await db.deleteInternTask(task.id);
  for (const file of files || []) storage.removeFile(file.storedName);
  return { id: Number(task.id) };
}

// Thực tập sinh chỉ xem được nhiệm vụ của chính mình.
async function listTasksForInternUser(user) {
  const intern = await requireInternProfile(user);
  const rows = await db.listInternTasksForIntern(intern.id);
  return toTaskDtos(rows);
}

async function requireInternProfile(user) {
  const intern = user?.email
    ? await db.findInternProfileByEmail(user.email)
    : null;
  if (!intern) {
    throw new HttpError(404, "Tài khoản chưa có hồ sơ thực tập sinh!");
  }
  return intern;
}

// Thực tập sinh cập nhật tiến độ việc của chính mình để mentor theo dõi.
async function updateMyTaskProgress(user, rawTaskId, body) {
  const intern = await requireInternProfile(user);
  const taskId = parseId(rawTaskId, "Mã nhiệm vụ");
  const task = await db.findInternTaskById(taskId);
  if (!task) throw new HttpError(404, "Không tìm thấy nhiệm vụ!");
  if (Number(task.internId) !== Number(intern.id)) {
    throw new HttpError(
      403,
      "Bạn chỉ được cập nhật tiến độ nhiệm vụ được giao cho mình!",
    );
  }
  const value = validateProgressInput(body, {
    status: task.status,
    percent: Number(task.progressPercent) || 0,
  });
  await db.updateInternTaskProgress(task.id, value);
  return loadTaskDto(task.id);
}

// Nhiệm vụ phải thuộc về thực tập sinh đang đăng nhập.
async function loadMyTask(user, rawTaskId) {
  const intern = await requireInternProfile(user);
  const taskId = parseId(rawTaskId, "Mã nhiệm vụ");
  const task = await db.findInternTaskById(taskId);
  if (!task) throw new HttpError(404, "Không tìm thấy nhiệm vụ!");
  if (Number(task.internId) !== Number(intern.id)) {
    throw new HttpError(
      403,
      "Bạn chỉ được đính kèm file cho nhiệm vụ được giao cho mình!",
    );
  }
  return task;
}

// Thực tập sinh đính kèm 1 file vào nhiệm vụ của mình (tối đa MAX_ATTACHMENTS_PER_TASK).
// Luồng: validate (RAM) -> ghi file UUID -> ghi DB; lỗi sau khi ghi đĩa thì xóa file.
async function uploadMyTaskAttachment(user, rawTaskId, file) {
  if (!file || !file.buffer) {
    throw new HttpError(
      400,
      "Vui lòng đính kèm file (trường 'file') để tải lên!",
    );
  }
  const meta = validateAttachment({
    buffer: file.buffer,
    originalname: file.originalname,
  });
  const task = await loadMyTask(user, rawTaskId);

  const storedName = storage.saveBuffer(file.buffer);
  let result;
  try {
    result = await db.insertTaskAttachmentLimited(
      {
        taskId: task.id,
        originalName: meta.cleanName,
        storedName,
        mimeType: meta.mimeType,
        sizeBytes: file.buffer.length,
      },
      MAX_ATTACHMENTS_PER_TASK,
    );
  } catch (err) {
    storage.removeFile(storedName);
    console.error("[TASKS] Lỗi lưu tệp đính kèm:", err);
    throw new HttpError(500, "Lỗi khi lưu tệp đính kèm vào cơ sở dữ liệu!");
  }

  if (result.outcome === "LIMIT") {
    storage.removeFile(storedName);
    throw new HttpError(
      409,
      `Mỗi nhiệm vụ chỉ được đính kèm tối đa ${MAX_ATTACHMENTS_PER_TASK} file! Hãy xóa bớt file cũ.`,
    );
  }
  if (result.outcome !== "SAVED") {
    storage.removeFile(storedName);
    throw new HttpError(404, "Không tìm thấy nhiệm vụ!");
  }
  return {
    attachment: toAttachmentDto(result.attachment),
    task: await loadTaskDto(task.id),
  };
}

// Thực tập sinh xóa file đính kèm của chính mình.
async function deleteMyTaskAttachment(user, rawTaskId, rawAttachmentId) {
  const task = await loadMyTask(user, rawTaskId);
  const attachmentId = parseId(rawAttachmentId, "Mã tệp đính kèm");
  const attachment = await db.findTaskAttachmentById(task.id, attachmentId);
  if (!attachment) throw new HttpError(404, "Không tìm thấy tệp đính kèm!");
  await db.deleteTaskAttachment(task.id, attachmentId);
  storage.removeFile(attachment.storedName);
  return { id: attachmentId, task: await loadTaskDto(task.id) };
}

// Chủ nhiệm vụ (Intern) hoặc Mentor đang phụ trách thực tập sinh đó được tải file.
async function getTaskAttachmentForDownload(user, rawTaskId, rawAttachmentId) {
  const taskId = parseId(rawTaskId, "Mã nhiệm vụ");
  const attachmentId = parseId(rawAttachmentId, "Mã tệp đính kèm");
  const task = await db.findInternTaskById(taskId);
  if (!task) throw new HttpError(404, "Không tìm thấy nhiệm vụ!");

  if (user?.role === "Intern") {
    const intern = await requireInternProfile(user);
    if (Number(task.internId) !== Number(intern.id)) {
      throw new HttpError(
        403,
        "Từ chối truy cập: Bạn không có quyền tải file của nhiệm vụ này!",
      );
    }
  } else {
    const mentor = await requireMentorProfile(user);
    assertInternBelongsToMentor(mentor, task.internMentorId);
  }

  const attachment = await db.findTaskAttachmentById(task.id, attachmentId);
  if (!attachment) throw new HttpError(404, "Không tìm thấy tệp đính kèm!");
  const filePath = storage.resolveExistingPath(attachment.storedName);
  if (!filePath) {
    throw new HttpError(404, "File không còn tồn tại trên máy chủ!");
  }
  return {
    filePath,
    originalName: sanitizeFileName(attachment.originalName),
    mimeType: attachment.mimeType || "application/octet-stream",
  };
}

module.exports = {
  TITLE_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  PRIORITIES,
  STATUSES,
  PROGRESS_NOTE_MAX_LENGTH,
  resolveProgress,
  validateTaskInput,
  validateProgressInput,
  toTaskDto,
  createTask,
  listTasksForMentor,
  updateTask,
  deleteTask,
  listTasksForInternUser,
  updateMyTaskProgress,
  INLINE_MIME_TYPES,
  MAX_ATTACHMENTS_PER_TASK,
  toAttachmentDto,
  uploadMyTaskAttachment,
  deleteMyTaskAttachment,
  getTaskAttachmentForDownload,
};
