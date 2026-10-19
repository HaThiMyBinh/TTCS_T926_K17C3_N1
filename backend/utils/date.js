// Tiện ích ngày giờ dùng chung. Mọi nghiệp vụ "hôm nay" phải tính theo giờ Việt Nam,
// không phụ thuộc múi giờ của máy chủ (VD: server đặt ở UTC).
const VIETNAM_TIME_ZONE = "Asia/Ho_Chi_Minh";
const VIETNAM_UTC_OFFSET = "+07:00";

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: VIETNAM_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  timeZone: VIETNAM_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

// Trả về ngày hiện tại theo giờ Việt Nam, định dạng YYYY-MM-DD.
function getVietnamToday(now = new Date()) {
  const fields = Object.fromEntries(
    dateFormatter.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  return `${fields.year}-${fields.month}-${fields.day}`;
}

// Định dạng thời điểm theo giờ Việt Nam để hiển thị (VD trong email).
function formatVietnamDateTime(value = new Date()) {
  return dateTimeFormatter.format(value);
}

// YYYY-MM-DD hợp lệ theo lịch (từ chối 2026-02-30, "2026-1-1", kiểu không phải chuỗi...).
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

// Cộng/trừ số ngày trên chuỗi YYYY-MM-DD (số học UTC, không phụ thuộc múi giờ máy chủ).
function addDays(value, days) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

module.exports = {
  VIETNAM_TIME_ZONE,
  VIETNAM_UTC_OFFSET,
  getVietnamToday,
  formatVietnamDateTime,
  isValidDate,
  addDays,
};
