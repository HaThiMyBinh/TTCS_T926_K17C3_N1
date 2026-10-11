// Nghỉ phép: thực tập sinh xin nghỉ nguyên ngày, HR hoặc mentor phụ trách duyệt.
const db = require("../db");
const { HttpError } = require("../errors");
const weeks = require("../utils/weeks");
const { getVietnamToday } = require("../utils/date");
const { resolveStaff, assertCanAccess } = require("./attendance.service");
const { contractCovers, addDays } = require("./scheduleRules.service");

const LEAVE_TYPES = ["SICK", "PERSONAL", "EXAM", "OTHER"];
const LEAVE_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];
const MAX_LEAVE_DAYS = 30; // tối đa mỗi đơn
const BACKDATE_DAYS = 7; // được nộp bù tối đa

function parseId(value, message = "ID không hợp lệ!") {
  if (!/^[1-9]\d*$/.test(String(value))) throw new HttpError(400, message);
  return Number(value);
}
function countDays(from, to) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
}
async function currentIntern(user) {
  const intern = await db.findInternProfileByEmail(user.email);
  if (!intern) throw new HttpError(404, "Tài khoản chưa có hồ sơ thực tập sinh!");
  return intern;
}

function validate(body) {
  const allowed = ["leave_type", "from_date", "to_date", "reason"];
  if (!body || typeof body !== "object" || Object.keys(body).some((k) => !allowed.includes(k)))
    throw new HttpError(400, "Dữ liệu đơn nghỉ không hợp lệ!");
  if (!LEAVE_TYPES.includes(body.leave_type)) throw new HttpError(400, "Loại nghỉ không hợp lệ!");
  if (!weeks.isValidDate(body.from_date) || !weeks.isValidDate(body.to_date))
    throw new HttpError(400, "Ngày nghỉ không hợp lệ!");
  if (body.from_date > body.to_date) throw new HttpError(400, "Ngày bắt đầu không được sau ngày kết thúc!");
  const reason = String(body.reason || "").trim();
  if (!reason || reason.length > 500) throw new HttpError(400, "Lý do nghỉ phải từ 1 đến 500 ký tự!");
  if (countDays(body.from_date, body.to_date) > MAX_LEAVE_DAYS)
    throw new HttpError(400, `Mỗi đơn nghỉ không quá ${MAX_LEAVE_DAYS} ngày!`);
  return { leaveType: body.leave_type, fromDate: body.from_date, toDate: body.to_date, reason };
}
// Cả ngày bắt đầu và kết thúc phải nằm trong cùng một hợp đồng đã xác nhận.
function findCoveringContract(contracts, fromDate, toDate) {
  return contracts.find((c) => contractCovers(c, fromDate) && contractCovers(c, toDate)) || null;
}

// ---------- Thực tập sinh ----------
async function mine(user) {
  return db.listLeaves((await currentIntern(user)).id);
}
async function submit(user, body) {
  const intern = await currentIntern(user);
  const input = validate(body);
  const earliest = addDays(getVietnamToday(), -BACKDATE_DAYS);
  if (input.fromDate < earliest) throw new HttpError(400, `Chỉ được nộp bù tối đa ${BACKDATE_DAYS} ngày!`);
  const contracts = await db.listConfirmedContractsForInterns([intern.id]);
  if (!findCoveringContract(contracts, input.fromDate, input.toDate))
    throw new HttpError(409, "Khoảng nghỉ phải nằm trong hợp đồng đã xác nhận!");
  if ((await db.listAttendance(intern.id, input.fromDate, input.toDate)).length)
    throw new HttpError(409, "Không thể xin nghỉ cho ngày đã chấm công!");
  const overlapping = (await db.listLeaves(intern.id, input.fromDate, input.toDate)).some((l) =>
    ["PENDING", "APPROVED"].includes(l.status),
  );
  if (overlapping) throw new HttpError(409, "Đơn nghỉ bị chồng với đơn đang chờ hoặc đã duyệt!");
  return { id: await db.createLeave({ ...input, internId: intern.id }) };
}
async function cancel(user, rawId) {
  const intern = await currentIntern(user);
  if (!(await db.cancelLeave(parseId(rawId), intern.id, getVietnamToday())))
    throw new HttpError(409, "Chỉ hủy được đơn chờ duyệt, hoặc đơn đã duyệt mà chưa đến ngày nghỉ!");
  return null;
}

// ---------- HR / Mentor ----------
async function pending(user) {
  const staff = await resolveStaff(user);
  return db.listPendingLeaves(staff.mentorId);
}
// HR xem toàn bộ đơn (có lọc); route đã giới hạn vai trò HR.
async function list(query = {}) {
  const allowed = ["status", "intern_id", "from", "to"];
  if (Object.keys(query).some((k) => !allowed.includes(k))) throw new HttpError(400, "Tham số lọc không hợp lệ!");
  if (query.status && !LEAVE_STATUSES.includes(query.status)) throw new HttpError(400, "Trạng thái không hợp lệ!");
  for (const key of ["from", "to"])
    if (query[key] && !weeks.isValidDate(query[key])) throw new HttpError(400, "Ngày lọc không hợp lệ!");
  if (query.from && query.to && query.from > query.to) throw new HttpError(400, "Ngày bắt đầu không được sau ngày kết thúc!");
  return db.listLeavesForStaff({
    status: query.status || null,
    internId: query.intern_id ? parseId(query.intern_id, "ID thực tập sinh không hợp lệ!") : null,
    from: query.from || null,
    to: query.to || null,
  });
}
async function review(user, rawId, body) {
  const staff = await resolveStaff(user);
  if (!body || typeof body !== "object" || Object.keys(body).some((k) => !["decision", "note"].includes(k)))
    throw new HttpError(400, "Dữ liệu duyệt đơn không hợp lệ!");
  if (!["APPROVED", "REJECTED"].includes(body.decision)) throw new HttpError(400, "Quyết định không hợp lệ!");
  const note = String(body.note || "").trim();
  if (note.length > 500) throw new HttpError(400, "Ghi chú tối đa 500 ký tự!");
  if (body.decision === "REJECTED" && !note) throw new HttpError(400, "Vui lòng nhập lý do từ chối!");
  const leave = await db.findLeave(parseId(rawId));
  if (!leave) throw new HttpError(404, "Không tìm thấy đơn nghỉ!");
  assertCanAccess(staff, { mentorId: leave.mentorId });
  if (leave.status !== "PENDING") throw new HttpError(409, "Đơn nghỉ đã được xử lý!");
  if (!(await db.reviewLeave(leave.id, body.decision, user.id, note)))
    throw new HttpError(409, "Đơn nghỉ đã được xử lý ở nơi khác!");
  return null;
}

module.exports = { mine, submit, cancel, pending, list, review, validate, findCoveringContract, LEAVE_TYPES, LEAVE_STATUSES };
