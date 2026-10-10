// Hàng đợi gửi email trong bộ nhớ (EventEmitter + setTimeout cho retry backoff).
// Nguồn sự thật là bảng email_logs trong MySQL; this.timers chỉ giữ các timer retry đang chờ.
// Nếu server tắt giữa chừng, loadPendingJobsFromDb() nạp lại các log dang dở khi khởi động.
const EventEmitter = require("events");
const db = require("../../db");
const smtpConfig = require("./smtpConfig");
const emailSender = require("./emailSender");
const templates = require("./templates");

// Lần gửi đầu chạy ngay; nếu lỗi tạm thời thì retry sau 5s / 15s / 45s (tối đa 4 lần gửi).
const RETRY_DELAYS_MS = [5000, 15000, 45000];
const MAX_ATTEMPTS = 1 + RETRY_DELAYS_MS.length; // 4

function formatFrom(config) {
  return `"${config.fromName || "Hệ thống Quản lý Thực tập sinh"}" <${config.fromEmail || config.user}>`;
}

class EmailQueue extends EventEmitter {
  constructor() {
    super();
    // logId -> timer retry đang chờ; hủy khi HR bấm "Gửi lại" để không gửi trùng
    this.timers = new Map();
  }

  // Ghi log PENDING rồi gửi nền; server.js gọi hàm này khi hồ sơ được duyệt/từ chối
  async enqueueReviewEmail({ application, action }) {
    const built =
      action === "APPROVED"
        ? templates.renderApprovedEmail(application)
        : templates.renderRejectedEmail(application);

    const logId = await db.insertEmailLog({
      applicationId: application.id,
      recipientEmail: application.email,
      recipientName: application.name,
      emailType: action, // 'APPROVED' | 'REJECTED'
      subject: built.subject,
    });

    this._process(
      logId,
      { to: application.email, name: application.name },
      built,
      0,
    ).catch((err) => {
      console.error(
        `[EMAIL] Lỗi không mong muốn khi xử lý log #${logId}:`,
        err,
      );
    });

    return logId;
  }

  // "Gửi thử" của Admin: gửi ngay, không ghi email_logs, không retry; lỗi ném thẳng ra controller
  async sendTestEmail(toEmail) {
    const config = smtpConfig.readConfig();
    if (!smtpConfig.isConfigured(config)) {
      const err = new Error(
        "Chưa cấu hình SMTP đầy đủ (SMTP server / port / email gửi / App Password)!",
      );
      err.classification = "PERMANENT";
      throw err;
    }
    const built = templates.renderTestEmail();
    const transporter = emailSender.buildTransporter(config);
    await emailSender.sendViaTransporter(transporter, {
      from: formatFrom(config),
      to: toEmail,
      subject: built.subject,
      html: built.html,
      text: built.text,
    });
  }

  // Gửi báo cáo cuối kỳ đã chốt kèm CSV: gửi ngay, không ghi email_logs, không retry; lỗi ném thẳng ra service
  async sendFinalReportEmail({ to, report, message, csv, filename }) {
    const config = smtpConfig.readConfig();
    if (!smtpConfig.isConfigured(config)) {
      const err = new Error(
        "Chưa cấu hình SMTP đầy đủ (SMTP server / port / email gửi / App Password)!",
      );
      err.classification = "PERMANENT";
      throw err;
    }
    const built = templates.renderFinalReportEmail({ report, message });
    const transporter = emailSender.buildTransporter(config);
    await emailSender.sendViaTransporter(transporter, {
      from: formatFrom(config),
      to,
      subject: built.subject,
      html: built.html,
      text: built.text,
      attachments: [
        { filename, content: Buffer.from(csv, "utf8"), contentType: "text/csv; charset=utf-8" },
      ],
    });
  }

  // Gọi 1 lần khi khởi động: nạp lại các log PENDING/RETRYING bị dang dở do server tắt/crash
  async loadPendingJobsFromDb() {
    const rows = await db.listPendingOrRetryingEmailLogs();
    for (const row of rows) {
      const { recipient, built } = await this._rebuildJob(row);
      this._process(row.id, recipient, built, row.attempts).catch((err) => {
        console.error(
          `[EMAIL] Lỗi khi nạp lại log #${row.id} lúc khởi động:`,
          err,
        );
      });
    }
    return rows.length;
  }

  // HR bấm "Gửi lại": gửi ngay (bỏ qua backoff và hạn mức tự động MAX_ATTEMPTS)
  async retryLog(logId) {
    const row = await db.findEmailLogById(logId);
    if (!row) {
      const err = new Error("Không tìm thấy nhật ký email!");
      err.status = 404;
      throw err;
    }
    if (row.status !== "FAILED" && row.status !== "RETRYING") {
      const err = new Error(
        'Chỉ có thể gửi lại email đang ở trạng thái "Thất bại" hoặc "Đang gửi lại"!',
      );
      err.status = 400;
      throw err;
    }

    const pendingTimer = this.timers.get(logId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.timers.delete(logId);
    }

    const { recipient, built } = await this._rebuildJob(row);
    await this._process(logId, recipient, built, row.attempts);
    return db.findEmailLogById(logId);
  }

  // Dựng lại người nhận + nội dung email từ 1 dòng log (dùng hồ sơ nếu còn, không thì dùng dữ liệu trong log)
  async _rebuildJob(row) {
    const application = row.applicationId
      ? await db.findApplicationById(row.applicationId)
      : null;
    const payload = application || {
      id: row.applicationId,
      name: row.recipientName,
      email: row.recipientEmail,
    };
    const built =
      row.emailType === "APPROVED"
        ? templates.renderApprovedEmail(payload)
        : templates.renderRejectedEmail(payload);
    return {
      recipient: { to: row.recipientEmail, name: row.recipientName },
      built,
    };
  }

  // Xử lý 1 lượt gửi và hẹn giờ retry nếu cần. priorAttempts: số lần đã thử trước đó.
  async _process(logId, recipient, built, priorAttempts) {
    const attemptNumber = priorAttempts + 1;
    const config = smtpConfig.readConfig();

    // Chưa cấu hình SMTP: FAILED ngay, không retry (thử lại cũng không khỏi)
    if (!smtpConfig.isConfigured(config)) {
      await db.updateEmailLog(logId, {
        status: "FAILED",
        attempts: attemptNumber,
        errorMessage:
          "Chưa cấu hình SMTP (thiếu SMTP server/port/email gửi/App Password). Vào trang Cấu hình Email để thiết lập.",
      });
      this.emit("email:failed", { logId });
      return;
    }

    await db.updateEmailLog(logId, {
      status: attemptNumber === 1 ? "PENDING" : "RETRYING",
      attempts: attemptNumber,
    });

    try {
      const transporter = emailSender.buildTransporter(config);
      await emailSender.sendViaTransporter(transporter, {
        from: formatFrom(config),
        to: recipient.to,
        subject: built.subject,
        html: built.html,
        text: built.text,
      });

      await db.updateEmailLog(logId, {
        status: "SENT",
        attempts: attemptNumber,
        errorMessage: null,
        sentAt: new Date(),
      });
      this.emit("email:sent", { logId });
    } catch (err) {
      const classification = emailSender.classifyError(err);
      const message = emailSender.getSafeErrorMessage(err);

      // Lỗi vĩnh viễn hoặc hết hạn mức retry: FAILED (HR vẫn có thể "Gửi lại" thủ công)
      if (classification === "PERMANENT" || attemptNumber >= MAX_ATTEMPTS) {
        await db.updateEmailLog(logId, {
          status: "FAILED",
          attempts: attemptNumber,
          errorMessage: message,
        });
        this.emit("email:failed", { logId });
        return;
      }

      // Lỗi tạm thời: RETRYING rồi hẹn giờ thử lại
      await db.updateEmailLog(logId, {
        status: "RETRYING",
        attempts: attemptNumber,
        errorMessage: message,
      });
      const delay = RETRY_DELAYS_MS[attemptNumber - 1];
      const timer = setTimeout(() => {
        this.timers.delete(logId);
        this._process(logId, recipient, built, attemptNumber).catch((e) => {
          console.error(
            `[EMAIL] Lỗi không mong muốn khi thử lại log #${logId}:`,
            e,
          );
        });
      }, delay);
      // unref: timer retry không giữ tiến trình Node sống
      if (typeof timer.unref === "function") timer.unref();
      this.timers.set(logId, timer);
    }
  }
}

module.exports = new EmailQueue(); // singleton dùng chung
module.exports.MAX_ATTEMPTS = MAX_ATTEMPTS;
module.exports.RETRY_DELAYS_MS = RETRY_DELAYS_MS;
