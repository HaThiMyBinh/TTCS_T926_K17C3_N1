const db = require("../db");
const { HttpError } = require("../errors");
const weeks = require("../utils/weeks");
const { getVietnamToday } = require("../utils/date");
const { assertHasConfirmedContract } = require("./contractGate");
const BODY_CHECK_IN = ["note"];
const QUERY_FIELDS = ["from", "to"];
// Một ca làm việc kéo dài tối đa chừng này giờ; quá mức đó mà chưa check-out thì coi là quên check-out.
const MAX_SHIFT_HOURS = 16;
// Chỉ được đề nghị bổ sung check-out cho ngày quên trong vòng chừng này ngày.
const CORRECTION_WINDOW_DAYS = 30;
const CORRECTION_BODY = ["check_out_at", "reason"];
const REVIEW_BODY = ["decision", "note"];
const DATETIME_PATTERN = /^(\d{4}-\d{2}-\d{2})[T ]([01]\d|2[0-3]):([0-5]\d)$/;
function assertObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, message);
}
function validateCheckInBody(body = {}) {
  assertObject(body, "Dữ liệu check-in không hợp lệ!");
  if (Object.keys(body).some((key) => !BODY_CHECK_IN.includes(key)))
    throw new HttpError(400, "Dữ liệu check-in có trường không hợp lệ!");
  if (body.note != null && typeof body.note !== "string")
    throw new HttpError(400, "Ghi chú phải là chuỗi!");
  const note = body.note == null ? null : body.note.trim();
  if (note && note.length > 255)
    throw new HttpError(400, "Ghi chú không được vượt quá 255 ký tự!");
  return note || null;
}
function validateEmptyBody(body = {}) {
  assertObject(body, "Dữ liệu check-out không hợp lệ!");
  if (Object.keys(body).length)
    throw new HttpError(400, "Check-out không nhận trường dữ liệu nào!");
}
function validateHistoryQuery(query, today = getVietnamToday()) {
  if (!query || Object.keys(query).some((key) => !QUERY_FIELDS.includes(key)))
    throw new HttpError(400, "Tham số lịch sử chấm công không hợp lệ!");
  const [year, month] = today.split("-");
  const from = query.from ?? `${year}-${month}-01`;
  const to = query.to ?? today;
  if (
    typeof from !== "string" ||
    typeof to !== "string" ||
    !weeks.isValidDate(from) ||
    !weeks.isValidDate(to)
  )
    throw new HttpError(400, "Ngày phải có định dạng YYYY-MM-DD hợp lệ!");
  if (from > to)
    throw new HttpError(400, "Ngày bắt đầu không được sau ngày kết thúc!");
  if (
    Math.floor(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86400000,
    ) > 365
  )
    throw new HttpError(400, "Khoảng ngày không được vượt quá 366 ngày!");
  return { from, to };
}
// "YYYY-MM-DD HH:mm:ss" (giờ Việt Nam) -> mili giây UTC.
function parseSqlDateTime(value) {
  if (!value) return null;
  const ms = Date.parse(
    `${String(value).replace(" ", "T").slice(0, 19)}+07:00`,
  );
  return Number.isNaN(ms) ? null : ms;
}
// nowMs (tùy chọn): ca qua đêm còn trong hạn MAX_SHIFT_HOURS vẫn là "đang làm việc", chưa phải quên check-out.
function classifyStatus(row, today, nowMs = null) {
  if (row.checkOutAt) return "COMPLETED";
  if (row.workDate >= today) return "WORKING";
  const checkInMs = parseSqlDateTime(row.checkInAt);
  if (
    nowMs != null &&
    checkInMs != null &&
    nowMs - checkInMs < MAX_SHIFT_HOURS * 3600000
  )
    return "WORKING";
  return "MISSING_CHECKOUT";
}
function durationMinutes(checkIn, checkOut) {
  if (!checkIn || !checkOut) return null;
  const delta = Math.floor(
    (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 60000,
  );
  return Math.max(0, delta);
}
function daysBetween(fromDate, toDate) {
  return Math.floor(
    (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) /
      86400000,
  );
}
function formatRow(row, today, nowMs = null) {
  const status = classifyStatus(row, today, nowMs);
  const correctionStatus = row.correctionStatus || null;
  return {
    ...row,
    isAdjusted: !!Number(row.isAdjusted || 0),
    correctionStatus,
    status,
    canRequestCorrection:
      status === "MISSING_CHECKOUT" &&
      correctionStatus !== "PENDING" &&
      daysBetween(row.workDate, today) <= CORRECTION_WINDOW_DAYS,
    durationMinutes:
      row.durationMinutes == null
        ? row.checkOutAt
          ? durationMinutes(row.checkInAt, row.checkOutAt)
          : null
        : Number(row.durationMinutes),
  };
}
async function requireIntern(user) {
  const intern = user?.email
    ? await db.findInternProfileByEmail(user.email)
    : null;
  if (!intern)
    throw new HttpError(404, "Tài khoản chưa có hồ sơ thực tập sinh!");
  return intern;
}
// Ca đang mở của thực tập sinh: ca qua đêm còn trong hạn, hoặc bản ghi của hôm nay.
async function findCurrentRecord(internId, today) {
  return (
    (await db.findOpenAttendance(internId, MAX_SHIFT_HOURS)) ||
    (await db.findAttendanceByInternDate(internId, today))
  );
}
// Lý do không thể check-in vào ngày `date` (null nếu được phép).
async function checkInBlockReason(internId, date) {
  if (!(await db.hasConfirmedContract(internId)))
    return "Bạn chưa có hợp đồng được xác nhận nên chưa thể check-in!";
  if (!(await db.hasConfirmedContractOn(internId, date)))
    return "Hôm nay không nằm trong kỳ của hợp đồng thực tập đã xác nhận nào!";
  return null;
}
async function getToday(user) {
  const intern = await requireIntern(user);
  const today = getVietnamToday();
  const row = await findCurrentRecord(intern.id, today);
  const status = !row
    ? "NOT_CHECKED_IN"
    : row.checkOutAt
      ? "CHECKED_OUT"
      : "CHECKED_IN";
  const reason = row ? null : await checkInBlockReason(intern.id, today);
  const canCheckIn = !row && !reason;
  const canCheckOut = !!row && !row.checkOutAt;
  const serverNow = await db.getServerDateTime();
  const record = row
    ? formatRow(row, today, parseSqlDateTime(serverNow))
    : null;
  return {
    status,
    record,
    serverNow,
    server_now: serverNow,
    workDate: today,
    work_date: today,
    canCheckIn,
    can_check_in: canCheckIn,
    canCheckOut,
    can_check_out: canCheckOut,
    reason,
  };
}
async function checkPeriod(internId, today) {
  await assertHasConfirmedContract(
    internId,
    "Bạn chưa có hợp đồng được xác nhận nên chưa thể check-in!",
  );
  if (!(await db.hasConfirmedContractOn(internId, today)))
    throw new HttpError(
      409,
      "Hôm nay không nằm trong kỳ của hợp đồng thực tập đã xác nhận nào!",
    );
}
async function checkIn(user, body) {
  const intern = await requireIntern(user);
  const note = validateCheckInBody(body);
  const today = getVietnamToday();
  await checkPeriod(intern.id, today);
  const open = await db.findOpenAttendance(intern.id, MAX_SHIFT_HOURS);
  if (open && open.workDate !== today) {
    throw new HttpError(
      409,
      `Bạn còn ca làm việc ngày ${open.workDate} chưa check-out, vui lòng check-out trước!`,
    );
  }
  const result = await db.insertAttendance({
    internId: intern.id,
    workDate: today,
    note,
  });
  if (result === "DUPLICATE") {
    const existing = await db.findAttendanceByInternDate(intern.id, today);
    throw new HttpError(
      409,
      `Hôm nay bạn đã check-in lúc ${existing?.checkInAt ? String(existing.checkInAt).slice(11, 16) : ""}!`,
    );
  }
  return result;
}
async function checkOut(user, body) {
  const intern = await requireIntern(user);
  validateEmptyBody(body);
  const today = getVietnamToday();
  const row = await findCurrentRecord(intern.id, today);
  if (!row) throw new HttpError(409, "Bạn chưa check-in hôm nay!");
  if (row.checkOutAt) throw new HttpError(409, "Hôm nay bạn đã check-out rồi!");
  const updated = await db.checkOutAttendance(row.id);
  if (!updated)
    throw new HttpError(409, "Yêu cầu check-out đã được xử lý ở nơi khác!");
  return updated;
}
async function buildHistory(internId, query) {
  const range = validateHistoryQuery(query);
  const today = getVietnamToday();
  const nowMs = parseSqlDateTime(await db.getServerDateTime());
  const rows = (await db.listAttendance(internId, range.from, range.to)).map(
    (row) => formatRow(row, today, nowMs),
  );
  const totalMinutes = rows.reduce(
    (s, r) =>
      s + (r.status === "COMPLETED" ? Number(r.durationMinutes || 0) : 0),
    0,
  );
  const daysWorked = rows.filter((r) => r.status === "COMPLETED").length;
  const missingCheckoutDays = rows.filter(
    (r) => r.status === "MISSING_CHECKOUT",
  ).length;
  const adjustedDays = rows.filter((r) => r.isAdjusted).length;
  const pendingCorrections = rows.filter(
    (r) => r.correctionStatus === "PENDING",
  ).length;
  return {
    records: rows,
    summary: {
      totalMinutes,
      total_minutes: totalMinutes,
      daysWorked,
      days_worked: daysWorked,
      missingCheckoutDays,
      missing_checkout_days: missingCheckoutDays,
      adjustedDays,
      pendingCorrections,
    },
  };
}
async function getHistory(user, query) {
  const intern = await requireIntern(user);
  return buildHistory(intern.id, query);
}
// ---------- Bổ sung check-out khi quên ----------
function validateCorrectionBody(body) {
  assertObject(body, "Dữ liệu đề nghị bổ sung không hợp lệ!");
  if (Object.keys(body).some((key) => !CORRECTION_BODY.includes(key)))
    throw new HttpError(400, "Dữ liệu đề nghị bổ sung có trường không hợp lệ!");
  if (typeof body.check_out_at !== "string")
    throw new HttpError(400, "Vui lòng nhập giờ check-out (YYYY-MM-DD HH:mm)!");
  const match = DATETIME_PATTERN.exec(body.check_out_at.trim());
  if (!match || !weeks.isValidDate(match[1]))
    throw new HttpError(
      400,
      "Giờ check-out phải có định dạng YYYY-MM-DD HH:mm hợp lệ!",
    );
  if (typeof body.reason !== "string" || !body.reason.trim())
    throw new HttpError(400, "Vui lòng nhập lý do quên check-out!");
  const reason = body.reason.trim();
  if (reason.length > 255)
    throw new HttpError(400, "Lý do không được vượt quá 255 ký tự!");
  return { checkOutAt: `${match[1]} ${match[2]}:${match[3]}:00`, reason };
}
function parseRecordId(rawId) {
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0 || String(rawId) !== String(id))
    throw new HttpError(400, "ID bản ghi chấm công không hợp lệ!");
  return id;
}
async function requestCorrection(user, rawId, body) {
  const intern = await requireIntern(user);
  const id = parseRecordId(rawId);
  const input = validateCorrectionBody(body);
  const record = await db.findAttendanceById(id);
  if (!record || Number(record.internId) !== Number(intern.id))
    throw new HttpError(404, "Không tìm thấy bản ghi chấm công!");
  const today = getVietnamToday();
  const nowMs = parseSqlDateTime(await db.getServerDateTime());
  const formatted = formatRow(record, today, nowMs);
  if (formatted.status !== "MISSING_CHECKOUT")
    throw new HttpError(
      409,
      "Chỉ bổ sung check-out cho ngày đã quên check-out!",
    );
  if (formatted.correctionStatus === "PENDING")
    throw new HttpError(409, "Đề nghị bổ sung của ngày này đang chờ duyệt!");
  if (!formatted.canRequestCorrection)
    throw new HttpError(
      409,
      `Chỉ được đề nghị bổ sung trong vòng ${CORRECTION_WINDOW_DAYS} ngày!`,
    );
  const requestedMs = parseSqlDateTime(input.checkOutAt);
  const checkInMs = parseSqlDateTime(record.checkInAt);
  if (requestedMs <= checkInMs)
    throw new HttpError(400, "Giờ check-out phải sau giờ check-in!");
  if (requestedMs - checkInMs > MAX_SHIFT_HOURS * 3600000)
    throw new HttpError(
      400,
      `Một ca làm việc không dài quá ${MAX_SHIFT_HOURS} giờ!`,
    );
  if (requestedMs > nowMs)
    throw new HttpError(400, "Giờ check-out không được ở tương lai!");
  const affected = await db.requestAttendanceCorrection({
    id,
    internId: intern.id,
    checkOutAt: input.checkOutAt,
    reason: input.reason,
  });
  if (!affected)
    throw new HttpError(409, "Đề nghị bổ sung đã được xử lý ở nơi khác!");
  return formatRow(await db.findAttendanceById(id), today, nowMs);
}
// ---------- HR / Mentor xem và duyệt ----------
async function resolveStaff(user) {
  if (user?.role === "HR") return { role: "HR", mentorId: null };
  const mentor =
    user?.role === "Mentor" && user.email
      ? await db.findMentorByEmail(user.email)
      : null;
  if (!mentor)
    throw new HttpError(
      403,
      "Tài khoản chưa có hồ sơ mentor để xem chấm công!",
    );
  return { role: "Mentor", mentorId: mentor.id };
}
function assertCanAccess(staff, intern) {
  if (
    staff.role === "Mentor" &&
    Number(intern.mentorId) !== Number(staff.mentorId)
  ) {
    throw new HttpError(
      403,
      "Bạn chỉ xem được chấm công của thực tập sinh mình phụ trách!",
    );
  }
}
async function getInternAttendance(user, rawInternId, query) {
  const staff = await resolveStaff(user);
  const internId = Number(rawInternId);
  if (
    !Number.isSafeInteger(internId) ||
    internId <= 0 ||
    String(rawInternId) !== String(internId)
  )
    throw new HttpError(400, "ID thực tập sinh không hợp lệ!");
  const intern = await db.findInternProfileById(internId);
  if (!intern) throw new HttpError(404, "Không tìm thấy thực tập sinh!");
  assertCanAccess(staff, intern);
  const history = await buildHistory(internId, query);
  return {
    intern: {
      id: intern.id,
      fullName: intern.fullName,
      studentCode: intern.studentCode,
    },
    ...history,
  };
}
async function listPendingCorrections(user) {
  const staff = await resolveStaff(user);
  const today = getVietnamToday();
  const nowMs = parseSqlDateTime(await db.getServerDateTime());
  const rows = await db.listPendingAttendanceCorrections(staff.mentorId);
  return rows.map((row) => formatRow(row, today, nowMs));
}
async function reviewCorrection(user, rawId, body) {
  const staff = await resolveStaff(user);
  const id = parseRecordId(rawId);
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
  const record = await db.findAttendanceById(id);
  if (!record) throw new HttpError(404, "Không tìm thấy bản ghi chấm công!");
  const intern = await db.findInternProfileById(record.internId);
  if (!intern) throw new HttpError(404, "Không tìm thấy thực tập sinh!");
  assertCanAccess(staff, intern);
  if (record.correctionStatus !== "PENDING")
    throw new HttpError(
      409,
      "Bản ghi này không có đề nghị nào đang chờ duyệt!",
    );
  const affected = await db.reviewAttendanceCorrection({
    id,
    decision: body.decision,
    userId: user.id || null,
    note,
  });
  if (!affected) throw new HttpError(409, "Đề nghị đã được xử lý ở nơi khác!");
  return formatRow(
    await db.findAttendanceById(id),
    getVietnamToday(),
    parseSqlDateTime(await db.getServerDateTime()),
  );
}
module.exports = {
  validateCheckInBody,
  validateEmptyBody,
  validateHistoryQuery,
  validateCorrectionBody,
  classifyStatus,
  durationMinutes,
  formatRow,
  parseSqlDateTime,
  MAX_SHIFT_HOURS,
  getToday,
  checkIn,
  checkOut,
  getHistory,
  requestCorrection,
  getInternAttendance,
  listPendingCorrections,
  reviewCorrection,
};
