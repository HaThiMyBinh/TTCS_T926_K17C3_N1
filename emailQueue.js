// services/email/emailQueue.js - Hàng đợi gửi email trong bộ nhớ (US8)
//
// KHÔNG dùng RabbitMQ/Redis theo đúng yêu cầu đề bài: đây là một EventEmitter đóng vai trò
// "producer/consumer" nội bộ, kết hợp setTimeout để lùi thời gian thử lại (retry backoff).
// Mọi trạng thái xử lý (PENDING/RETRYING/SENT/FAILED, attempts, error_message) được ghi liên
// tục vào bảng email_logs trong MySQL - hàng đợi trong bộ nhớ chỉ giữ các setTimeout đang chờ
// (this.timers), KHÔNG phải nguồn sự thật (source of truth); nếu server tắt giữa chừng, các
// timer trong RAM sẽ mất, nhưng dữ liệu trạng thái vẫn còn nguyên trong DB để loadPendingJobsFromDb()
// nạp lại và tiếp tục xử lý khi khởi động lại (xem hàm bên dưới).
const EventEmitter = require("events");
const db = require("../../db");
const smtpConfig = require("./smtpConfig");
const emailSender = require("./emailSender");
const templates = require("./templates");

// "Retry tối đa 3 lần (5s, 15s, 45s)": lần gửi đầu tiên luôn chạy ngay (không tính là 1 lần retry),
// nếu thất bại tạm thời thì lần lượt chờ 5s / 15s / 45s rồi thử lại - tối đa 3 lần thử lại đó,
// tức tổng cộng tối đa 4 lần GỬI THẬT (1 lần đầu + 3 lần retry).
const RETRY_DELAYS_MS = [5000, 15000, 45000];
const MAX_ATTEMPTS = 1 + RETRY_DELAYS_MS.length; // 4

class EmailQueue extends EventEmitter {
  constructor() {
    super();
    // logId -> Timeout đang chờ để thử lại; dùng để hủy khi người dùng bấm "Gửi lại" thủ công,
    // tránh gửi trùng 2 email cho cùng 1 log (1 lần tự động + 1 lần thủ công cùng lúc).
    this.timers = new Map();
  }

  // ---------------------------------------------------------------------------
  // US8 - luồng chính: HR duyệt/từ chối -> applications.service phát sự kiện
  // "application.reviewed" -> server.js gọi hàm này (xem server.js) để xếp hàng gửi email.
  // Hàm này KHÔNG được throw ra ngoài một cách bất ngờ đối với luồng duyệt hồ sơ (server.js
  // đã .catch() khi gọi), vì lỗi gửi mail không được phép làm hỏng việc duyệt hồ sơ đã thành công.
  // ---------------------------------------------------------------------------
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

    // Không await: để hàm enqueue trả về ngay (đã ghi log PENDING), việc gửi thật chạy nền.
    this._process(logId, { to: application.email, name: application.name }, built, 0).catch(
      (err) => {
        console.error(`[EMAIL] Lỗi không mong muốn khi xử lý log #${logId}:`, err);
      },
    );

    return logId;
  }

  // Admin bấm "Gửi thử" ở trang Cấu hình Email - gửi ngay, KHÔNG ghi vào email_logs
  // (đây là thao tác kiểm tra cấu hình, không phải thông báo cho ứng viên nào), và
  // KHÔNG tự động thử lại - lỗi được ném thẳng ra cho controller trả về cho Admin xem ngay.
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
      from: `"${config.fromName || "Hệ thống"}" <${config.fromEmail || config.user}>`,
      to: toEmail,
      subject: built.subject,
      html: built.html,
      text: built.text,
    });
  }

  // Gọi 1 lần lúc server khởi động: các log còn PENDING/RETRYING (ví dụ server bị tắt/crash
  // giữa chừng khi đang gửi hoặc đang chờ retry) được coi như vừa thất bại 1 lần và nạp lại
  // vào hàng đợi để tiếp tục xử lý, thay vì "mồ côi" mãi mãi ở trạng thái dang dở.
  async loadPendingJobsFromDb() {
    const rows = await db.listPendingOrRetryingEmailLogs();
    for (const row of rows) {
      let application = null;
      if (row.applicationId) {
        application = await db.findApplicationById(row.applicationId);
      }
      const payload = application || {
        id: row.applicationId,
        name: row.recipientName,
        email: row.recipientEmail,
      };
      const built =
        row.emailType === "APPROVED"
          ? templates.renderApprovedEmail(payload)
          : templates.renderRejectedEmail(payload);

      this._process(
        row.id,
        { to: row.recipientEmail, name: row.recipientName },
        built,
        row.attempts,
      ).catch((err) => {
        console.error(`[EMAIL] Lỗi khi nạp lại log #${row.id} lúc khởi động:`, err);
      });
    }
    return rows.length;
  }

  // HR bấm nút "Gửi lại" ở trang Nhật ký Email - luôn thực hiện NGAY một lượt gửi thật
  // (không đợi backoff), bất kể log đã hết hạn mức tự động (MAX_ATTEMPTS) hay chưa; đây là
  // hành động chủ động của con người nên được ưu tiên thực thi ngay khi được yêu cầu.
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

    // Hủy timer tự động đang chờ (nếu có) để tránh gửi trùng khi người dùng chủ động bấm "Gửi lại"
    const pendingTimer = this.timers.get(logId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.timers.delete(logId);
    }

    let application = null;
    if (row.applicationId) {
      application = await db.findApplicationById(row.applicationId);
    }
    const payload = application || {
      id: row.applicationId,
      name: row.recipientName,
      email: row.recipientEmail,
    };
    const built =
      row.emailType === "APPROVED"
        ? templates.renderApprovedEmail(payload)
        : templates.renderRejectedEmail(payload);

    await this._process(
      logId,
      { to: row.recipientEmail, name: row.recipientName },
      built,
      row.attempts,
    );
    return db.findEmailLogById(logId);
  }

  // ---------------------------------------------------------------------------
  // Lõi xử lý 1 lượt gửi + tự lên lịch lượt tiếp theo nếu cần retry.
  // priorAttempts: số lần ĐÃ thử trước đó (0 nếu đây là lần đầu tiên).
  // ---------------------------------------------------------------------------
  async _process(logId, recipient, built, priorAttempts) {
    const attemptNumber = priorAttempts + 1;
    const config = smtpConfig.readConfig();

    // Chưa cấu hình SMTP -> ghi FAILED ngay, không thử gửi, không lên lịch retry
    // (thử lại cũng vô ích vì lỗi nằm ở việc THIẾU cấu hình, không tự khỏi theo thời gian).
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
        from: `"${config.fromName || "Hệ thống Quản lý Thực tập sinh"}" <${
          config.fromEmail || config.user
        }>`,
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

      // Lỗi vĩnh viễn (sai mật khẩu SMTP, email nhận sai...), hoặc đã hết hạn mức thử tự động
      // -> dừng lại, ghi FAILED. Người dùng vẫn có thể chủ động bấm "Gửi lại" sau đó (retryLog).
      if (classification === "PERMANENT" || attemptNumber >= MAX_ATTEMPTS) {
        await db.updateEmailLog(logId, {
          status: "FAILED",
          attempts: attemptNumber,
          errorMessage: message,
        });
        this.emit("email:failed", { logId });
        return;
      }

      // Lỗi tạm thời và còn hạn mức -> ghi RETRYING rồi hẹn giờ thử lại theo backoff
      await db.updateEmailLog(logId, {
        status: "RETRYING",
        attempts: attemptNumber,
        errorMessage: message,
      });
      const delay = RETRY_DELAYS_MS[attemptNumber - 1];
      const timer = setTimeout(() => {
        this.timers.delete(logId);
        this._process(logId, recipient, built, attemptNumber).catch((e) => {
          console.error(`[EMAIL] Lỗi không mong muốn khi thử lại log #${logId}:`, e);
        });
      }, delay);
      // unref(): không giữ tiến trình Node sống chỉ vì còn 1 timer retry đang chờ
      // (ví dụ khi test hoặc khi server đang tắt), tránh treo tiến trình.
      if (typeof timer.unref === "function") timer.unref();
      this.timers.set(logId, timer);
    }
  }
}

// Singleton dùng chung cho toàn bộ ứng dụng (server.js, controller...) - giống cách
// db.js export 1 pool kết nối dùng chung, ở đây có 1 hàng đợi dùng chung.
module.exports = new EmailQueue();
// Vẫn export class để test có thể tự khởi tạo instance riêng, độc lập với singleton.
module.exports.EmailQueue = EmailQueue;
module.exports.MAX_ATTEMPTS = MAX_ATTEMPTS;
module.exports.RETRY_DELAYS_MS = RETRY_DELAYS_MS;
