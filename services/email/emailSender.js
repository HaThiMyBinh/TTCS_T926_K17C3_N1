// Gửi email qua nodemailer và phân loại lỗi.
// sendViaTransporter nhận transporter bên ngoài để unit test có thể truyền transporter giả.
const nodemailer = require("nodemailer");

function buildTransporter(config) {
  return nodemailer.createTransport({
    host: config.host,
    port: Number(config.port) || 587,
    secure: !!config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

async function sendViaTransporter(transporter, mailOptions) {
  return transporter.sendMail(mailOptions);
}

// Phân loại lỗi để emailQueue quyết định retry hay báo FAILED ngay:
// - PERMANENT: sai tài khoản SMTP (EAUTH), địa chỉ bị từ chối (EENVELOPE), phản hồi SMTP 5xx
// - TEMPORARY: lỗi mạng/DNS/timeout, phản hồi SMTP 4xx
const PERMANENT_ERROR_CODES = new Set(["EAUTH", "EENVELOPE"]);
const TEMPORARY_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "ECONNECTION",
  "ECONNREFUSED",
  "ECONNRESET",
  "ESOCKET",
  "EDNS",
]);

function classifyError(err) {
  if (!err) return "TEMPORARY";
  // Lỗi tự tạo trong code (ví dụ "chưa cấu hình SMTP") có thể gắn sẵn classification
  if (
    err.classification === "PERMANENT" ||
    err.classification === "TEMPORARY"
  ) {
    return err.classification;
  }

  const code = err.code || "";
  if (PERMANENT_ERROR_CODES.has(code)) return "PERMANENT";
  if (TEMPORARY_ERROR_CODES.has(code)) return "TEMPORARY";

  // Mã phản hồi SMTP: 5xx = vĩnh viễn, 4xx = tạm thời
  const status = String(err.responseCode || "");
  if (status.startsWith("5")) return "PERMANENT";
  if (status.startsWith("4")) return "TEMPORARY";

  // Không rõ nguyên nhân: coi là tạm thời để còn được retry
  return "TEMPORARY";
}

// Cắt message còn tối đa 500 ký tự để ghi vào email_logs.error_message
function getSafeErrorMessage(err) {
  if (!err) return "Lỗi không xác định";
  return String(err.message || err).slice(0, 500);
}

module.exports = {
  buildTransporter,
  sendViaTransporter,
  classifyError,
  getSafeErrorMessage,
};
