const { sendError } = require("./endpoint");
// Cấu hình SMTP và nhật ký gửi email
const db = require("../db");
const smtpConfig = require("../services/email/smtpConfig");
const emailQueue = require("../services/email/emailQueue");
const { HttpError } = require("../errors");

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
    sendError(res, err, "EMAIL");
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
    sendError(res, err, "EMAIL");
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
    if (!smtpConfig.isConfigured(smtpConfig.readConfig())) {
      throw new HttpError(
        400,
        "Chưa cấu hình SMTP đầy đủ (SMTP server / port / email gửi / App Password)!",
      );
    }
    await emailQueue.sendTestEmail(to.trim());
    res.json({
      success: true,
      message: `Đã gửi email thử nghiệm tới ${to.trim()} thành công!`,
    });
  } catch (err) {
    return sendError(res, err, "EMAIL");
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
    sendError(res, err, "EMAIL");
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
    sendError(res, err, "EMAIL");
  }
}

module.exports = { getConfig, updateConfig, testConfig, listLogs, retryLog };
