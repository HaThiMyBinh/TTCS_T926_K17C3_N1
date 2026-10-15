// Tính tuần báo cáo (thứ Hai -> Chủ nhật) bằng chuỗi ngày YYYY-MM-DD.
// Chỉ dùng số học theo UTC trên ngày thuần, không phụ thuộc múi giờ máy chủ.
// "Hôm nay" luôn do bên gọi truyền vào (getVietnamToday), giờ Việt Nam.

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

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

function addDays(value, days) {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function isMonday(value) {
  return isValidDate(value) && parseDate(value).getUTCDay() === 1;
}

// Thứ Hai của tuần chứa ngày `value`.
function mondayOf(value) {
  const day = parseDate(value).getUTCDay(); // 0 = Chủ nhật
  return addDays(value, day === 0 ? -6 : 1 - day);
}

// Chủ nhật của tuần bắt đầu từ `weekStart` (cũng là hạn nộp, hết ngày này).
function weekEndOf(weekStart) {
  return addDays(weekStart, 6);
}

/**
 * Danh sách thứ Hai của các tuần phải nộp: từ tuần chứa `startDate` đến tuần
 * chứa min(today, endDate). `endDate` rỗng nghĩa là chưa có ngày kết thúc.
 * Trả về [] nếu kỳ thực tập chưa bắt đầu.
 */
function listRequiredWeeks({ startDate, endDate = null, today }) {
  const first = mondayOf(startDate);
  const limit = endDate && endDate < today ? endDate : today;
  const last = mondayOf(limit);
  const weeks = [];
  for (let week = first; week <= last; week = addDays(week, 7)) {
    weeks.push(week);
  }
  return weeks;
}

// Tuần có thuộc kỳ thực tập phải nộp báo cáo không.
function isWeekRequired(weekStart, { startDate, endDate = null }) {
  if (weekEndOf(weekStart) < startDate) return false;
  if (endDate && weekStart > endDate) return false;
  return true;
}

/**
 * Trạng thái một tuần của một thực tập sinh:
 * - SUBMITTED: đã nộp đúng hạn
 * - LATE_SUBMITTED: đã nộp sau hạn (nộp bù)
 * - MISSING: chưa nộp và đã quá hạn (sau Chủ nhật 23:59)
 * - UPCOMING: chưa nộp và chưa đến hạn (tuần hiện tại hoặc tương lai)
 */
function weekStatus({ weekStart, report = null, today }) {
  if (report) return report.isLate ? "LATE_SUBMITTED" : "SUBMITTED";
  return today > weekEndOf(weekStart) ? "MISSING" : "UPCOMING";
}

// Nộp vào ngày `today` cho tuần `weekStart` có trễ hạn không (trễ = sau Chủ nhật).
function isLateSubmission(weekStart, today) {
  return today > weekEndOf(weekStart);
}

module.exports = {
  isValidDate,
  addDays,
  isMonday,
  mondayOf,
  weekEndOf,
  listRequiredWeeks,
  isWeekRequired,
  weekStatus,
  isLateSubmission,
};
