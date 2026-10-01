// controllers/email.controller.js - Cấu hình SMTP & Nhật ký gửi email (US8)
// Cùng phong cách với controllers/applications.controller.js: nhận request, gọi
// service/module nghiệp vụ, định dạng response { success, message, data }.
const db = require("../db");
const smtpConfig = require("../services/email/smtpConfig");
const emailQueue = require("../services/email/emailQueue");
const emailSender = require("../services/email/emailSender");
const { HttpError } = require("../errors");

// Dùng chung 1 kiểu kiểm tra lỗi (err.status) cho MỌI lỗi có thể ném tới đây,
// dù lỗi đó được tạo bằng HttpError ở file này hay ném từ emailQueue.js (db.js).
function sendError(res, err) {
  if (err && typeof err.status === "number") {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  console.error("[EMAIL]", err);
  return res
    .status(500)
    .json({ success: false, message: "Lỗi server, vui lòng thử lại sau!" });
}

const PORT_MIN = 1;
const PORT_MAX = 65535;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/email/config - trả cấu hình SMTP nhưng KHÔNG BAO GIỜ trả mật khẩu thật về client
async function getConfig(req, res) {
  try {
    const config = smtpConfig.readConfig();
    res.json({
      success: true,
      message: "Lấy cấu hình email thành công!",
      data: smtpConfig.toPublicView(config),
    });
  } catch (err) {
    sendError(res, err);
  }
}

// PUT /api/email/config - lưu cấu hình; nếu KHÔNG gửi "pass" (hoặc gửi rỗng) thì giữ nguyên
// mật khẩu cũ, vì giao diện không bao giờ hiển thị mật khẩu thật nên người dùng thường chỉ
// sửa các trường khác (ví dụ đổi "Tên người gửi") mà không gõ lại mật khẩu mỗi lần lưu.
async function updateConfig(req, res) {
  try {
    const { host, port, secure, user, pass, fromName, fromEmail } = req.body || {};

    if (typeof host !== "string" || !host.trim()) {
      throw new HttpError(400, "Vui lòng nhập SMTP server (host)!");
    }
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < PORT_MIN || portNum > PORT_MAX) {
      throw new HttpError(400, "Cổng (port) không hợp lệ!");
    }
    if (typeof user !== "string" || !user.trim()) {
      throw new HttpError(400, "Vui lòng nhập email gửi (tài khoản SMTP)!");
    }
    if (fromEmail && (typeof fromEmail !== "string" || !EMAIL_REGEX.test(fromEmail.trim()))) {
      throw new HttpError(400, "Email hiển thị (From) không hợp lệ!");
    }

    const partial = {
      host: host.trim(),
      port: portNum,
      secure: !!secure,
      user: user.trim(),
      fromName: typeof fromName === "string" ? fromName.trim() : undefined,
      fromEmail: typeof fromEmail === "string" ? fromEmail.trim() : undefined,
    };
    if (typeof pass === "string" && pass.trim() !== "") {
      partial.pass = pass.trim();
    }

    const saved = smtpConfig.writeConfig(partial);
    res.json({
      success: true,
      message: "Lưu cấu hình email thành công!",
      data: smtpConfig.toPublicView(saved),
    });
  } catch (err) {
    sendError(res, err);
  }
}

// POST /api/email/config/test - gửi 1 email thử tới địa chỉ chỉ định, không ghi vào email_logs,
// không tự động thử lại - trả lỗi ngay để Admin biết cấu hình có đúng hay không.
async function testConfig(req, res) {
  try {
    const { to } = req.body || {};
    if (typeof to !== "string" || !EMAIL_REGEX.test(to.trim())) {
      throw new HttpError(400, "Vui lòng nhập một địa chỉ email hợp lệ để gửi thử!");
    }
    await emailQueue.sendTestEmail(to.trim());
    res.json({
      success: true,
      message: `Đã gửi email thử nghiệm tới ${to.trim()} thành công!`,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return sendError(res, err);
    }
    // Lỗi từ emailQueue.sendTestEmail (chưa cấu hình SMTP, hoặc gửi thật thất bại)
    // đều trả 400 kèm thông báo lỗi rút gọn, an toàn (không lộ mật khẩu SMTP).
    const message =
      err.classification === "PERMANENT" && !err.code
        ? err.message
        : `Gửi email thử nghiệm thất bại: ${emailSender.getSafeErrorMessage(err)}`;
    return res.status(400).json({ success: false, message });
  }
}

// GET /api/email/logs?status=&type=&search=&page=&pageSize= - danh sách nhật ký, có lọc + phân trang
async function listLogs(req, res) {
  try {
    const { status, type, search, page, pageSize } = req.query;
    const result = await db.listEmailLogs({
      status: status || undefined,
      emailType: type || undefined,
      search: search || undefined,
      page,
      pageSize,
    });
    res.json({
      success: true,
      message: "Lấy nhật ký email thành công!",
      data: result.rows,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
      },
      meta: { maxAttempts: emailQueue.MAX_ATTEMPTS },
    });
  } catch (err) {
    sendError(res, err);
  }
}

// POST /api/email/logs/:id/retry - gửi lại 1 email đang Thất bại / Đang gửi lại
async function retryLog(req, res) {
  try {
    if (!/^\d+$/.test(String(req.params.id))) {
      throw new HttpError(400, "ID nhật ký không hợp lệ!");
    }
    const updated = await emailQueue.retryLog(Number(req.params.id));
    res.json({ success: true, message: "Đã gửi lại email!", data: updated });
  } catch (err) {
    sendError(res, err);
  }
}

module.exports = { getConfig, updateConfig, testConfig, listLogs, retryLog };
