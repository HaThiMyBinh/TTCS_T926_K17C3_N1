// services/email/emailSender.js - Gửi email qua SMTP thật (nodemailer) + phân loại lỗi (US8)
//
// Tách riêng "tạo transporter" và "gửi qua 1 transporter cho sẵn" để test_email_unit.js
// có thể tiêm (inject) một transporter giả (chỉ cần có hàm sendMail) mà KHÔNG cần cấu hình
// SMTP thật, không cần mạng - đúng yêu cầu "test unit không cần mạng/MySQL".
const nodemailer = require("nodemailer");

function buildTransporter(config) {
  return nodemailer.createTransport({
    host: config.host,
    port: Number(config.port) || 587,
    secure: !!config.secure, // true: SSL cổng 465 | false: STARTTLS cổng 587 (nodemailer tự nâng cấp)
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10000, // 10s - đủ để phát hiện "mất mạng"/server không phản hồi
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

async function sendViaTransporter(transporter, mailOptions) {
  return transporter.sendMail(mailOptions);
}

// ----------------------------------------------------------------------------
// PHÂN LOẠI LỖI: quyết định emailQueue có nên thử lại hay báo FAILED ngay
// ----------------------------------------------------------------------------
// PERMANENT (thử lại vô ích, vì lỗi do CẤU HÌNH/DỮ LIỆU sai, không tự khỏi):
//   - EAUTH: sai user/mật khẩu ứng dụng SMTP
//   - EENVELOPE: địa chỉ người gửi/người nhận bị SMTP server từ chối thẳng
//   - Mã phản hồi SMTP 5xx (ví dụ 550 "mailbox không tồn tại", 553 "địa chỉ không hợp lệ")
// TEMPORARY (nên thử lại, vì thường tự khỏi sau vài giây/phút):
//   - ETIMEDOUT/ECONNREFUSED/ECONNRESET/ESOCKET/EDNS: mất mạng, DNS lỗi, server không phản hồi kịp
//   - Mã phản hồi SMTP 4xx (ví dụ 421 "server đang quá tải", 450 "hộp thư tạm khóa")
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
  // Lỗi tự tạo trong code (ví dụ: "chưa cấu hình SMTP") có thể tự gắn sẵn classification
  if (err.classification === "PERMANENT" || err.classification === "TEMPORARY") {
    return err.classification;
  }

  const code = err.code || "";
  if (PERMANENT_ERROR_CODES.has(code)) return "PERMANENT";
  if (TEMPORARY_ERROR_CODES.has(code)) return "TEMPORARY";

  // responseCode do chính server SMTP trả về theo chuẩn SMTP (RFC 5321): 5xx = vĩnh viễn, 4xx = tạm thời
  const status = String(err.responseCode || "");
  if (status.startsWith("5")) return "PERMANENT";
  if (status.startsWith("4")) return "TEMPORARY";

  // Không rõ nguyên nhân -> mặc định coi là tạm thời để hệ thống còn cơ hội tự thử lại,
  // tránh việc 1 lỗi lạ, hiếm gặp làm mất hẳn cơ hội gửi thành công.
  return "TEMPORARY";
}

// Rút gọn message để ghi vào email_logs.error_message - nodemailer không nhét mật khẩu
// vào err.message nên không cần lọc riêng, nhưng vẫn giới hạn độ dài để tránh log quá dài.
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
