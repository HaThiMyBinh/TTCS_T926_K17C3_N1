// leaves.service.js - Đơn xin nghỉ của thực tập sinh: tạo / hủy, HR & Mentor xem và duyệt.
const db = require("../db");
const { HttpError } = require("../errors");
const weeks = require("../utils/weeks");
const { getVietnamToday } = require("../utils/date");
const { assertHasConfirmedContract } = require("./contractGate");

const LEAVE_TYPES = ["PERSONAL", "SICK", "STUDY", "OTHER"];
const LEAVE_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];
const CREATE_BODY = ["leave_type", "start_date", "end_date", "reason"];
const REVIEW_BODY = ["decision", "note"];
const LIST_QUERY = ["status", "from", "to", "intern_id", "page", "page_size"];
const OWN_LIST_QUERY = ["status", "from", "to", "page", "page_size"];
// Giới hạn nghiệp vụ.
const MAX_LEAVE_DAYS = 30; // một đơn nghỉ tối đa chừng này ngày
const MAX_BACKDATE_DAYS = 7; // được xin bù (vd. nghỉ ốm) cho ngày đã qua tối đa chừng này ngày
const MAX_RANGE_DAYS = 366; // khoảng ngày lọc tối đa
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function assertObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, message);
}
function daysBetween(from, to) {
  return Math.floor(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000,
  );
}
function parsePositiveInt(raw, message) {
  const n = Number(raw);
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(n))
    throw new HttpError(400, message);
  return n;
}

// ---------- Kiểm tra dữ liệu vào ----------
function validateCreateBody(body, today = getVietnamToday()) {
  assertObject(body, "Dữ liệu đơn xin nghỉ không hợp lệ!");
  if (Object.keys(body).some((key) => !CREATE_BODY.includes(key)))
    throw new HttpError(400, "Dữ liệu đơn xin nghỉ có trường không hợp lệ!");
  const leaveType = body.leave_type == null ? "PERSONAL" : body.leave_type;
  if (!LEAVE_TYPES.includes(leaveType))
    throw new HttpError(400, `Loại nghỉ phải là một trong: ${LEAVE_TYPES.join(", ")}!`);
  const { start_date: startDate, end_date: endDate } = body;
  if (!weeks.isValidDate(startDate) || !weeks.isValidDate(endDate))
    throw new HttpError(400, "Ngày nghỉ phải có định dạng YYYY-MM-DD hợp lệ!");
  if (startDate > endDate)
    throw new HttpError(400, "Ngày bắt đầu không được sau ngày kết thúc!");
  if (daysBetween(startDate, endDate) + 1 > MAX_LEAVE_DAYS)
    throw new HttpError(400, `Một đơn nghỉ không dài quá ${MAX_LEAVE_DAYS} ngày!`);
  if (daysBetween(startDate, today) > MAX_BACKDATE_DAYS)
    throw new HttpError(400, `Chỉ được xin nghỉ bù cho ngày đã qua trong vòng ${MAX_BACKDATE_DAYS} ngày!`);
  if (typeof body.reason !== "string" || !body.reason.trim())
    throw new HttpError(400, "Vui lòng nhập lý do xin nghỉ!");
  const reason = body.reason.trim();
  if (reason.length > 500)
    throw new HttpError(400, "Lý do không được vượt quá 500 ký tự!");
  return { leaveType, startDate, endDate, reason };
}

// Chuẩn hóa tham số lọc + phân trang cho GET /leaves. allowed: các tham số được phép.
function validateListQuery(query, allowed = LIST_QUERY) {
  if (!query || typeof query !== "object" || Object.keys(query).some((key) => !allowed.includes(key)))
    throw new HttpError(400, "Tham số lọc đơn nghỉ không hợp lệ!");
  const filters = {};
  if (query.status != null) {
    if (!LEAVE_STATUSES.includes(query.status))
      throw new HttpError(400, `Trạng thái phải là một trong: ${LEAVE_STATUSES.join(", ")}!`);
    filters.status = query.status;
  }
  for (const key of ["from", "to"]) {
    if (query[key] != null && !weeks.isValidDate(query[key]))
      throw new HttpError(400, "Ngày lọc phải có định dạng YYYY-MM-DD hợp lệ!");
  }
  if (query.from != null) filters.from = query.from;
  if (query.to != null) filters.to = query.to;
  if (filters.from && filters.to) {
    if (filters.from > filters.to)
      throw new HttpError(400, "Ngày bắt đầu không được sau ngày kết thúc!");
    if (daysBetween(filters.from, filters.to) >= MAX_RANGE_DAYS)
      throw new HttpError(400, `Khoảng ngày lọc không được vượt quá ${MAX_RANGE_DAYS} ngày!`);
  }
  if (query.intern_id != null)
    filters.internId = parsePositiveInt(query.intern_id, "ID thực tập sinh không hợp lệ!");
  const page = query.page == null ? 1 : parsePositiveInt(query.page, "Số trang phải là số nguyên dương!");
  const pageSize =
    query.page_size == null
      ? DEFAULT_PAGE_SIZE
      : parsePositiveInt(query.page_size, "Kích thước trang phải là số nguyên dương!");
  if (pageSize > MAX_PAGE_SIZE)
    throw new HttpError(400, `Kích thước trang tối đa là ${MAX_PAGE_SIZE}!`);
  return { filters, page, pageSize };
}

function parseLeaveId(rawId) {
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0 || String(rawId) !== String(id))
    throw new HttpError(400, "ID đơn nghỉ không hợp lệ!");
  return id;
}

function validateReviewBody(body) {
  assertObject(body, "Dữ liệu duyệt không hợp lệ!");
  if (Object.keys(body).some((key) => !REVIEW_BODY.includes(key)))
    throw new HttpError(400, "Dữ liệu duyệt có trường không hợp lệ!");
  if (body.decision !== "APPROVED" && body.decision !== "REJECTED")
    throw new HttpError(400, "Quyết định phải là APPROVED hoặc REJECTED!");
  if (body.note != null && typeof body.note !== "string")
    throw new HttpError(400, "Ghi chú phải là chuỗi!");
  const note = body.note == null ? "" : body.note.trim();
  if (note.length > 255)
    throw new HttpError(400, "Ghi chú không được vượt quá 255 ký tự!");
  if (body.decision === "REJECTED" && !note)
    throw new HttpError(400, "Vui lòng nhập lý do từ chối!");
  return { decision: body.decision, note };
}

// ---------- Định dạng kết quả ----------
function formatLeave(row) {
  return {
    id: row.id,
    internId: row.internId,
    fullName: row.fullName,
    studentCode: row.studentCode,
    leaveType: row.leaveType,
    startDate: row.startDate,
    endDate: row.endDate,
    totalDays: Number(row.totalDays),
    reason: row.reason,
    status: row.status,
    reviewedBy: row.reviewedBy ?? null,
    reviewedAt: row.reviewedAt ?? null,
    reviewNote: row.reviewNote ?? null,
    createdAt: row.createdAt,
  };
}
function buildPage(rows, total, page, pageSize) {
  return {
    items: rows.map(formatLeave),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}
async function runList(filters, page, pageSize, extra = {}) {
  const { rows, total } = await db.listLeaves({
    ...filters,
    ...extra,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  return buildPage(rows, total, page, pageSize);
}

// ---------- Thực tập sinh ----------
async function requireIntern(user) {
  const intern = user?.email ? await db.findInternProfileByEmail(user.email) : null;
  if (!intern) throw new HttpError(404, "Tài khoản chưa có hồ sơ thực tập sinh!");
  return intern;
}
async function createLeave(user, body) {
  const intern = await requireIntern(user);
  const input = validateCreateBody(body);
  await assertHasConfirmedContract(
    intern.id,
    "Bạn chưa có hợp đồng được xác nhận nên chưa thể xin nghỉ!",
  );
  if (await db.hasOverlappingLeave(intern.id, input.startDate, input.endDate))
    throw new HttpError(409, "Khoảng ngày này trùng với một đơn nghỉ đang chờ duyệt hoặc đã được duyệt!");
  return formatLeave(await db.insertLeave({ internId: intern.id, ...input }));
}
async function listMyLeaves(user, query) {
  const intern = await requireIntern(user);
  const { filters, page, pageSize } = validateListQuery(query, OWN_LIST_QUERY);
  return runList(filters, page, pageSize, { internId: intern.id });
}
async function cancelLeave(user, rawId) {
  const intern = await requireIntern(user);
  const id = parseLeaveId(rawId);
  const leave = await db.findLeaveById(id);
  if (!leave || Number(leave.internId) !== Number(intern.id))
    throw new HttpError(404, "Không tìm thấy đơn nghỉ!");
  if (leave.status !== "PENDING")
    throw new HttpError(409, "Chỉ hủy được đơn đang chờ duyệt!");
  if (!(await db.cancelLeave({ id, internId: intern.id })))
    throw new HttpError(409, "Đơn nghỉ đã được xử lý ở nơi khác!");
  return formatLeave(await db.findLeaveById(id));
}

// ---------- HR / Mentor ----------
// HR thấy mọi thực tập sinh; Mentor chỉ thấy thực tập sinh mình phụ trách.
async function resolveStaff(user) {
  if (user?.role === "HR") return { role: "HR", mentorId: null };
  const mentor =
    user?.role === "Mentor" && user.email ? await db.findMentorByEmail(user.email) : null;
  if (!mentor) throw new HttpError(403, "Tài khoản chưa có hồ sơ mentor để xem đơn nghỉ!");
  return { role: "Mentor", mentorId: mentor.id };
}
// GET /leaves — HR xem đơn của mọi thực tập sinh: lọc theo trạng thái, khoảng ngày, intern; phân trang.
async function listLeaves(user, query) {
  const { filters, page, pageSize } = validateListQuery(query);
  return runList(filters, page, pageSize);
}
// GET /leaves/pending — đơn chờ duyệt, cũ nhất lên trước.
async function listPendingLeaves(user, query) {
  const staff = await resolveStaff(user);
  const { filters, page, pageSize } = validateListQuery(query, ["from", "to", "intern_id", "page", "page_size"]);
  return runList({ ...filters, status: "PENDING" }, page, pageSize, {
    mentorId: staff.mentorId,
    order: "ASC",
  });
}
async function reviewLeave(user, rawId, body) {
  const staff = await resolveStaff(user);
  const id = parseLeaveId(rawId);
  const { decision, note } = validateReviewBody(body);
  const leave = await db.findLeaveById(id);
  if (!leave) throw new HttpError(404, "Không tìm thấy đơn nghỉ!");
  if (staff.role === "Mentor" && Number(leave.mentorId) !== Number(staff.mentorId))
    throw new HttpError(403, "Bạn chỉ duyệt được đơn nghỉ của thực tập sinh mình phụ trách!");
  if (leave.status !== "PENDING")
    throw new HttpError(409, "Đơn nghỉ này không còn ở trạng thái chờ duyệt!");
  const affected = await db.reviewLeave({ id, decision, userId: user.id || null, note });
  if (!affected) throw new HttpError(409, "Đơn nghỉ đã được xử lý ở nơi khác!");
  return formatLeave(await db.findLeaveById(id));
}

module.exports = {
  LEAVE_TYPES,
  LEAVE_STATUSES,
  validateCreateBody,
  validateListQuery,
  validateReviewBody,
  formatLeave,
  createLeave,
  listMyLeaves,
  cancelLeave,
  listLeaves,
  listPendingLeaves,
  reviewLeave,
};
