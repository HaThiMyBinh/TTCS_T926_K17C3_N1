// Nghiệp vụ chấm công: thực tập sinh check-in tối đa 1 lần mỗi ngày (giờ Việt Nam),
// giờ lấy từ server (không nhận từ client), check-in sau giờ quy định thì gắn nhãn đi muộn.
const db = require("../db");
const { HttpError } = require("../errors");
const { assertHasConfirmedContract } = require("./contractGate");
const { getVietnamToday, getVietnamTime } = require("../utils/date");

// Giờ bắt đầu làm việc (HH:MM hoặc HH:MM:SS, giờ VN). Check-in sau mốc này là đi muộn.
// Có thể đổi bằng biến môi trường ATTENDANCE_LATE_AFTER.
const DEFAULT_LATE_AFTER = "08:30:00";

function normalizeTime(value) {
  const text = String(value || "").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(text)) return null;
  return text.length === 5 ? `${text}:00` : text;
}

function getLateAfter() {
  return normalizeTime(process.env.ATTENDANCE_LATE_AFTER) || DEFAULT_LATE_AFTER;
}

// Đúng giờ = check-in đến hết mốc; chỉ muộn khi sau mốc (so sánh chuỗi HH:MM:SS là đủ).
function isLateCheckIn(timeOfDay, lateAfter = getLateAfter()) {
  return timeOfDay > lateAfter;
}

function toDateString(value) {
  if (!value) return null;
  if (value instanceof Date) return getVietnamToday(value);
  return String(value).slice(0, 10);
}

function toDateTimeString(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return `${getVietnamToday(value)} ${getVietnamTime(value)}`;
  }
  return String(value).slice(0, 19).replace("T", " ");
}

function toAttendanceDto(row) {
  return {
    id: Number(row.id),
    intern_id: Number(row.internId),
    work_date: toDateString(row.workDate),
    check_in_at: toDateTimeString(row.checkInAt),
    is_late: Boolean(Number(row.isLate)),
  };
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

// Check-in hôm nay. `now` chỉ để test; production luôn dùng giờ server.
async function checkIn(user, { now = new Date() } = {}) {
  const intern = await requireInternProfile(user);
  await assertHasConfirmedContract(
    intern.id,
    "Bạn cần xác nhận hợp đồng thực tập trước khi chấm công!",
  );

  const workDate = getVietnamToday(now);
  const time = getVietnamTime(now);
  const alreadyMessage = "Bạn đã check-in hôm nay rồi!";

  if (await db.findAttendanceByDate(intern.id, workDate)) {
    throw new HttpError(409, alreadyMessage);
  }

  const result = await db.insertAttendanceLog({
    internId: intern.id,
    workDate,
    checkInAt: `${workDate} ${time}`,
    isLate: isLateCheckIn(time),
  });
  // Hai request cùng lúc: UNIQUE (intern_id, work_date) chặn request đến sau.
  if (result.duplicate) throw new HttpError(409, alreadyMessage);

  return toAttendanceDto(result.log);
}

module.exports = {
  DEFAULT_LATE_AFTER,
  normalizeTime,
  getLateAfter,
  isLateCheckIn,
  toAttendanceDto,
  checkIn,
};
