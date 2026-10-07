// Nghiệp vụ báo cáo tuần của thực tập sinh: nộp mỗi tuần (thứ Hai -> Chủ nhật),
// hạn nộp là hết Chủ nhật (giờ Việt Nam), nộp sau hạn vẫn được nhưng gắn nhãn trễ.
const db = require("../db");
const { HttpError } = require("../errors");
const { getVietnamToday } = require("../utils/date");
const weeks = require("../utils/weeks");
const storage = require("./fileStorage");
const {
  MAX_ATTACHMENTS_PER_TASK,
  INLINE_MIME_TYPES,
  validateAttachment,
} = require("./attachmentValidator");
const { sanitizeFileName } = require("./documentValidator");

const MAX_ATTACHMENTS_PER_REPORT = MAX_ATTACHMENTS_PER_TASK;
const CONTENT_MAX_LENGTH = 5000;
const OPTIONAL_TEXT_MAX_LENGTH = 2000;
const REPORT_FIELDS = ["week_start", "content", "difficulties", "next_plan"];

function has(input, key) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function parseId(rawId, label) {
  const text = String(rawId ?? "");
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new HttpError(400, `${label} không hợp lệ!`);
  }
  return Number(text);
}

// DATE từ MySQL là chuỗi, TIMESTAMP là Date; quy về YYYY-MM-DD giờ Việt Nam.
function toDateString(value) {
  if (!value) return null;
  if (value instanceof Date) return getVietnamToday(value);
  return String(value).slice(0, 10);
}

function validateWeekStart(value, today) {
  if (!weeks.isValidDate(value)) {
    throw new HttpError(400, "Tuần báo cáo phải có dạng YYYY-MM-DD hợp lệ!");
  }
  if (!weeks.isMonday(value)) {
    throw new HttpError(400, "Ngày bắt đầu tuần báo cáo phải là thứ Hai!");
  }
  if (value > weeks.mondayOf(today)) {
    throw new HttpError(400, "Không thể nộp báo cáo cho tuần chưa đến!");
  }
  return value;
}

function validateOptionalText(input, key, label) {
  if (!has(input, key) || input[key] === null) return null;
  if (typeof input[key] !== "string") {
    throw new HttpError(400, `${label} phải là chuỗi!`);
  }
  const text = input[key].trim();
  if (text.length > OPTIONAL_TEXT_MAX_LENGTH) {
    throw new HttpError(
      400,
      `${label} không được vượt quá ${OPTIONAL_TEXT_MAX_LENGTH} ký tự!`,
    );
  }
  return text || null;
}

/**
 * Chuẩn hóa và kiểm tra dữ liệu báo cáo tuần.
 * Trả về { weekStart, content, difficulties, nextPlan }.
 */
function validateReportInput(input, { today = getVietnamToday() } = {}) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "Dữ liệu báo cáo tuần không hợp lệ!");
  }
  const extra = Object.keys(input).filter((k) => !REPORT_FIELDS.includes(k));
  if (extra.length > 0) {
    throw new HttpError(
      400,
      "Báo cáo tuần chỉ nhận week_start, content, difficulties và next_plan!",
    );
  }

  const weekStart = validateWeekStart(input.week_start, today);

  if (typeof input.content !== "string" || !input.content.trim()) {
    throw new HttpError(400, "Vui lòng nhập nội dung kết quả thực hiện!");
  }
  const content = input.content.trim();
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new HttpError(
      400,
      `Nội dung báo cáo không được vượt quá ${CONTENT_MAX_LENGTH} ký tự!`,
    );
  }

  return {
    weekStart,
    content,
    difficulties: validateOptionalText(input, "difficulties", "Khó khăn"),
    nextPlan: validateOptionalText(input, "next_plan", "Kế hoạch tuần sau"),
  };
}

// Kỳ thực tập phải nộp báo cáo: từ ngày bắt đầu hợp đồng đã xác nhận (nếu chưa có thì
// ngày tạo hồ sơ) đến ngày kết thúc (null nếu chưa xác định).
function resolvePeriod(intern, contractPeriod) {
  const startDate =
    toDateString(contractPeriod?.startDate) || toDateString(intern.createdAt);
  return { startDate, endDate: toDateString(contractPeriod?.endDate) };
}

async function getInternPeriod(intern) {
  return resolvePeriod(intern, await db.findInternContractPeriod(intern.id));
}

function toAttachmentDto(row) {
  return {
    id: Number(row.id),
    report_id: Number(row.reportId),
    original_name: sanitizeFileName(row.originalName),
    mime_type: row.mimeType,
    size_bytes: Number(row.sizeBytes),
    can_preview: INLINE_MIME_TYPES.includes(row.mimeType),
    uploaded_at: row.uploadedAt || null,
  };
}

function toReportDto(row, attachments = []) {
  const weekStart = toDateString(row.weekStart);
  const weekEnd = weeks.weekEndOf(weekStart);
  return {
    id: Number(row.id),
    intern_id: Number(row.internId),
    intern_name: row.internName || "",
    student_code: row.studentCode || "",
    week_start: weekStart,
    week_end: weekEnd,
    deadline: `${weekEnd} 23:59`,
    content: row.content,
    difficulties: row.difficulties || "",
    next_plan: row.nextPlan || "",
    is_late: Boolean(Number(row.isLate)),
    submitted_at: row.submittedAt || null,
    updated_at: row.updatedAt || null,
    attachments: attachments.map(toAttachmentDto),
  };
}

async function toReportDtos(rows) {
  const grouped = await db.listWeeklyReportAttachmentsByReportIds(
    rows.map((r) => r.id),
  );
  return rows.map((row) => toReportDto(row, grouped[Number(row.id)] || []));
}

async function loadReportDto(id) {
  const row = await db.findWeeklyReportById(id);
  return row ? (await toReportDtos([row]))[0] : null;
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

async function requireMentorProfile(user) {
  const mentor =
    user?.role === "Mentor" && user.email
      ? await db.findMentorByEmail(user.email)
      : null;
  if (!mentor) {
    throw new HttpError(
      403,
      "Tài khoản chưa có hồ sơ mentor để xem báo cáo tuần!",
    );
  }
  return mentor;
}

function assertInternBelongsToMentor(mentor, internMentorId) {
  if (!internMentorId || Number(internMentorId) !== Number(mentor.id)) {
    throw new HttpError(
      403,
      "Bạn chỉ được xem báo cáo của thực tập sinh được phân công cho mình!",
    );
  }
}

// ---------- Thực tập sinh ----------

// Nộp mới hoặc sửa báo cáo của một tuần. Nộp sau Chủ nhật của tuần đó thì gắn is_late
// (chỉ lúc nộp lần đầu; sửa lại không đổi nhãn).
async function submitMyReport(user, body, { today = getVietnamToday() } = {}) {
  const value = validateReportInput(body, { today });
  const intern = await requireInternProfile(user);

  const period = await getInternPeriod(intern);
  if (!weeks.isWeekRequired(value.weekStart, period)) {
    throw new HttpError(400, "Tuần này nằm ngoài kỳ thực tập của bạn!");
  }

  const row = await db.upsertWeeklyReport({
    internId: intern.id,
    ...value,
    isLate: weeks.isLateSubmission(value.weekStart, today),
  });
  return loadReportDto(row.id);
}

async function listMyReports(user) {
  const intern = await requireInternProfile(user);
  const rows = await db.listWeeklyReportsForIntern(intern.id);
  return toReportDtos(rows);
}

// Các tuần phải nộp (mới nhất trước) kèm trạng thái, để intern biết tuần nào còn thiếu.
async function getMyStatus(user, { today = getVietnamToday() } = {}) {
  const intern = await requireInternProfile(user);
  const period = await getInternPeriod(intern);
  const reports = await db.listWeeklyReportsForIntern(intern.id);
  const byWeek = new Map(
    reports.map((r) => [
      toDateString(r.weekStart),
      { id: Number(r.id), isLate: Boolean(Number(r.isLate)), row: r },
    ]),
  );

  const list = weeks
    .listRequiredWeeks({ ...period, today })
    .reverse()
    .map((weekStart) => {
      const report = byWeek.get(weekStart) || null;
      const weekEnd = weeks.weekEndOf(weekStart);
      return {
        week_start: weekStart,
        week_end: weekEnd,
        deadline: `${weekEnd} 23:59`,
        status: weeks.weekStatus({ weekStart, report, today }),
        report_id: report ? report.id : null,
        is_late: report ? report.isLate : false,
        submitted_at: report ? report.row.submittedAt || null : null,
      };
    });

  const count = (status) => list.filter((w) => w.status === status).length;
  return {
    today,
    current_week_start: weeks.mondayOf(today),
    period_start: period.startDate,
    period_end: period.endDate,
    summary: {
      submitted: count("SUBMITTED"),
      late_submitted: count("LATE_SUBMITTED"),
      missing: count("MISSING"),
      upcoming: count("UPCOMING"),
    },
    weeks: list,
  };
}

// Báo cáo phải thuộc về thực tập sinh đang đăng nhập.
async function loadMyReport(user, rawReportId) {
  const intern = await requireInternProfile(user);
  const reportId = parseId(rawReportId, "Mã báo cáo");
  const report = await db.findWeeklyReportById(reportId);
  if (!report) throw new HttpError(404, "Không tìm thấy báo cáo!");
  if (Number(report.internId) !== Number(intern.id)) {
    throw new HttpError(
      403,
      "Bạn chỉ được đính kèm file cho báo cáo của chính mình!",
    );
  }
  return report;
}

// Luồng: validate (RAM) -> ghi file UUID -> ghi DB; lỗi sau khi ghi đĩa thì xóa file.
async function uploadMyReportAttachment(user, rawReportId, file) {
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
  const report = await loadMyReport(user, rawReportId);

  const storedName = storage.saveBuffer(file.buffer);
  let result;
  try {
    result = await db.insertWeeklyReportAttachmentLimited(
      {
        reportId: report.id,
        originalName: meta.cleanName,
        storedName,
        mimeType: meta.mimeType,
        sizeBytes: file.buffer.length,
      },
      MAX_ATTACHMENTS_PER_REPORT,
    );
  } catch (err) {
    storage.removeFile(storedName);
    console.error("[WEEKLY REPORTS] Lỗi lưu tệp đính kèm:", err);
    throw new HttpError(500, "Lỗi khi lưu tệp đính kèm vào cơ sở dữ liệu!");
  }

  if (result.outcome === "LIMIT") {
    storage.removeFile(storedName);
    throw new HttpError(
      409,
      `Mỗi báo cáo chỉ được đính kèm tối đa ${MAX_ATTACHMENTS_PER_REPORT} file! Hãy xóa bớt file cũ.`,
    );
  }
  if (result.outcome !== "SAVED") {
    storage.removeFile(storedName);
    throw new HttpError(404, "Không tìm thấy báo cáo!");
  }
  return {
    attachment: toAttachmentDto(result.attachment),
    report: await loadReportDto(report.id),
  };
}

async function deleteMyReportAttachment(user, rawReportId, rawAttachmentId) {
  const report = await loadMyReport(user, rawReportId);
  const attachmentId = parseId(rawAttachmentId, "Mã tệp đính kèm");
  const attachment = await db.findWeeklyReportAttachmentById(
    report.id,
    attachmentId,
  );
  if (!attachment) throw new HttpError(404, "Không tìm thấy tệp đính kèm!");
  await db.deleteWeeklyReportAttachment(report.id, attachmentId);
  storage.removeFile(attachment.storedName);
  return { id: attachmentId, report: await loadReportDto(report.id) };
}

// Chủ báo cáo (Intern) hoặc Mentor đang phụ trách thực tập sinh đó được tải file.
async function getReportAttachmentForDownload(
  user,
  rawReportId,
  rawAttachmentId,
) {
  const reportId = parseId(rawReportId, "Mã báo cáo");
  const attachmentId = parseId(rawAttachmentId, "Mã tệp đính kèm");
  const report = await db.findWeeklyReportById(reportId);
  if (!report) throw new HttpError(404, "Không tìm thấy báo cáo!");

  if (user?.role === "Intern") {
    const intern = await requireInternProfile(user);
    if (Number(report.internId) !== Number(intern.id)) {
      throw new HttpError(
        403,
        "Từ chối truy cập: Bạn không có quyền tải file của báo cáo này!",
      );
    }
  } else {
    const mentor = await requireMentorProfile(user);
    assertInternBelongsToMentor(mentor, report.internMentorId);
  }

  const attachment = await db.findWeeklyReportAttachmentById(
    report.id,
    attachmentId,
  );
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

// ---------- Mentor (chỉ đọc) ----------

// Báo cáo của thực tập sinh mình phụ trách; lọc theo intern_id và/hoặc week_start.
async function listReportsForMentor(
  user,
  query = {},
  { today = getVietnamToday() } = {},
) {
  const mentor = await requireMentorProfile(user);
  let internId = null;
  if (has(query, "intern_id")) {
    internId = parseId(query.intern_id, "Mã thực tập sinh");
    const intern = await db.findInternProfileById(internId);
    if (!intern) throw new HttpError(404, "Không tìm thấy thực tập sinh!");
    assertInternBelongsToMentor(mentor, intern.mentorId);
  }
  let weekStart = null;
  if (has(query, "week_start")) {
    weekStart = validateWeekStart(query.week_start, today);
  }
  const rows = await db.listWeeklyReportsForMentor(mentor.id, {
    internId,
    weekStart,
  });
  return toReportDtos(rows);
}

// Bảng tổng quan một tuần: mỗi thực tập sinh đã nộp / nộp trễ / chưa nộp / chưa đến hạn.
async function getMentorOverview(
  user,
  query = {},
  { today = getVietnamToday() } = {},
) {
  const mentor = await requireMentorProfile(user);
  const weekStart = has(query, "week_start")
    ? validateWeekStart(query.week_start, today)
    : weeks.mondayOf(today);
  const weekEnd = weeks.weekEndOf(weekStart);

  const interns = await db.listInternsWithPeriodForMentor(mentor.id);
  const reports = await db.listWeeklyReportsForMentor(mentor.id, { weekStart });
  const byIntern = new Map(reports.map((r) => [Number(r.internId), r]));

  const rows = [];
  for (const intern of interns) {
    const period = resolvePeriod(intern, intern);
    if (!weeks.isWeekRequired(weekStart, period)) continue;
    const report = byIntern.get(Number(intern.id)) || null;
    rows.push({
      intern_id: Number(intern.id),
      intern_name: intern.fullName,
      student_code: intern.studentCode || "",
      status: weeks.weekStatus({
        weekStart,
        report: report ? { isLate: Boolean(Number(report.isLate)) } : null,
        today,
      }),
      report_id: report ? Number(report.id) : null,
      submitted_at: report ? report.submittedAt || null : null,
    });
  }

  const count = (status) => rows.filter((r) => r.status === status).length;
  return {
    week_start: weekStart,
    week_end: weekEnd,
    deadline: `${weekEnd} 23:59`,
    summary: {
      total: rows.length,
      submitted: count("SUBMITTED"),
      late_submitted: count("LATE_SUBMITTED"),
      missing: count("MISSING"),
      upcoming: count("UPCOMING"),
    },
    interns: rows,
  };
}

module.exports = {
  MAX_ATTACHMENTS_PER_REPORT,
  CONTENT_MAX_LENGTH,
  OPTIONAL_TEXT_MAX_LENGTH,
  INLINE_MIME_TYPES,
  validateReportInput,
  resolvePeriod,
  toReportDto,
  submitMyReport,
  listMyReports,
  getMyStatus,
  uploadMyReportAttachment,
  deleteMyReportAttachment,
  getReportAttachmentForDownload,
  listReportsForMentor,
  getMentorOverview,
};
