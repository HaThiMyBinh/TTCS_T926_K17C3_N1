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

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: VIETNAM_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

// Giờ hiện tại theo giờ Việt Nam, định dạng HH:MM:SS (24 giờ).
function getVietnamTime(now = new Date()) {
  const fields = Object.fromEntries(
    timeFormatter.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  return `${fields.hour}:${fields.minute}:${fields.second}`;
}

// Thời điểm theo giờ Việt Nam dạng "YYYY-MM-DD HH:MM:SS" để lưu vào cột DATETIME.
function getVietnamDateTime(now = new Date()) {
  return `${getVietnamToday(now)} ${getVietnamTime(now)}`;
}

// Định dạng thời điểm theo giờ Việt Nam để hiển thị (VD trong email).
function formatVietnamDateTime(value = new Date()) {
  return dateTimeFormatter.format(value);
}

module.exports = {
  VIETNAM_TIME_ZONE,
  VIETNAM_UTC_OFFSET,
  getVietnamToday,
  getVietnamTime,
  getVietnamDateTime,
  formatVietnamDateTime,
};
