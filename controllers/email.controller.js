// Cấu hình SMTP và nhật ký gửi email
const db = require("../db");
const smtpConfig = require("../services/email/smtpConfig");
const emailQueue = require("../services/email/emailQueue");
const emailSender = require("../services/email/emailSender");
const { HttpError } = require("../errors");

// Nhận mọi lỗi có err.status (HttpError hoặc lỗi từ emailQueue)
function sendError(res, err) {
  if (err && typeof err.status === "number") {
    return res
      .status(err.status)
      .json({ success: false, message: err.message });
  }
  console.error("[EMAIL]", err);
  return res
    .status(500)
    .json({ success: false, message: "Lỗi server, vui lòng thử lại sau!" });
}

const PORT_MIN = 1;
const PORT_MAX = 65535;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/email/config
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

// PUT /api/email/config - bỏ trống "pass" thì giữ mật khẩu cũ
async function updateConfig(req, res) {
  try {
    const { host, port, secure, user, pass, fromName, fromEmail } =
      req.body || {};

    if (typeof host !== "string" || !host.trim()) {
      throw new HttpError(400, "Vui lòng nhập SMTP server (host)!");
    }
    const portNum = Number(port);
    if (
      !Number.isInteger(portNum) ||
      portNum < PORT_MIN ||
      portNum > PORT_MAX
    ) {
      throw new HttpError(400, "Cổng (port) không hợp lệ!");
    }
    if (typeof user !== "string" || !user.trim()) {
      throw new HttpError(400, "Vui lòng nhập email gửi (tài khoản SMTP)!");
    }
    if (
      fromEmail &&
      (typeof fromEmail !== "string" || !EMAIL_REGEX.test(fromEmail.trim()))
    ) {
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

// POST /api/email/config/test - gửi email thử, không ghi log, không retry
async function testConfig(req, res) {
  try {
    const { to } = req.body || {};
    if (typeof to !== "string" || !EMAIL_REGEX.test(to.trim())) {
      throw new HttpError(
        400,
        "Vui lòng nhập một địa chỉ email hợp lệ để gửi thử!",
      );
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
    // Lỗi từ sendTestEmail (chưa cấu hình hoặc gửi thất bại): trả 400 kèm thông báo rút gọn
    const message =
      err.classification === "PERMANENT" && !err.code
        ? err.message
        : `Gửi email thử nghiệm thất bại: ${emailSender.getSafeErrorMessage(err)}`;
    return res.status(400).json({ success: false, message });
  }
}

// GET /api/email/logs?status=&type=&search=&page=&pageSize=
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

// POST /api/email/logs/:id/retry
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
