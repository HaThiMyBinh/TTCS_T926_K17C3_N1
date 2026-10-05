// Nghiệp vụ Mentor giao nhiệm vụ cho thực tập sinh (Task assignment)
const db = require("../db");
const { HttpError } = require("../errors");
const { getVietnamToday } = require("../utils/date");

const TITLE_MAX_LENGTH = 255;
const DESCRIPTION_MAX_LENGTH = 5000;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
const STATUSES = ["TODO", "IN_PROGRESS", "DONE"];

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

function toTaskDto(row, today = getVietnamToday()) {
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
    is_overdue: Boolean(dueDate && row.status !== "DONE" && dueDate < today),
    created_at: row.createdAt || null,
    updated_at: row.updatedAt || null,
  };
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

  const id = await db.insertInternTask({
    internId,
    createdByMentorId: mentor.id,
    ...value,
  });
  return toTaskDto(await db.findInternTaskById(id));
}

async function listTasksForMentor(user, query = {}) {
  const mentor = await requireMentorProfile(user);
  let internId = null;
  if (has(query, "intern_id")) {
    internId = parseId(query.intern_id, "Mã thực tập sinh");
  }
  const rows = await db.listInternTasksForMentor(mentor.id, { internId });
  const today = getVietnamToday();
  return rows.map((row) => toTaskDto(row, today));
}

async function updateTask(user, rawTaskId, body) {
  const mentor = await requireMentorProfile(user);
  const task = await loadOwnedTask(mentor, rawTaskId);
  const value = validateTaskInput(body, {
    partial: true,
    currentDueDate: task.dueDate || null,
  });
  await db.updateInternTask(task.id, value);
  return toTaskDto(await db.findInternTaskById(task.id));
}

async function deleteTask(user, rawTaskId) {
  const mentor = await requireMentorProfile(user);
  const task = await loadOwnedTask(mentor, rawTaskId);
  await db.deleteInternTask(task.id);
  return { id: Number(task.id) };
}

// Thực tập sinh chỉ xem được nhiệm vụ của chính mình.
async function listTasksForInternUser(user) {
  const intern = user?.email
    ? await db.findInternProfileByEmail(user.email)
    : null;
  if (!intern) {
    throw new HttpError(404, "Tài khoản chưa có hồ sơ thực tập sinh!");
  }
  const rows = await db.listInternTasksForIntern(intern.id);
  const today = getVietnamToday();
  return rows.map((row) => toTaskDto(row, today));
}

module.exports = {
  TITLE_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  PRIORITIES,
  STATUSES,
  validateTaskInput,
  toTaskDto,
  createTask,
  listTasksForMentor,
  updateTask,
  deleteTask,
  listTasksForInternUser,
};
