// Hàng đợi gửi email trong bộ nhớ (EventEmitter + setTimeout cho retry backoff).
// Nguồn sự thật là bảng email_logs trong MySQL; this.timers chỉ giữ các timer retry đang chờ.
// Nếu server tắt giữa chừng, loadPendingJobsFromDb() nạp lại các log dang dở khi khởi động.
const EventEmitter = require("events");
const { HttpError } = require("../../errors");
const meetingRules = require("../meetingRules.service");
const internNotify = require("../internNotify.service");
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
    const renderer = new Map([
      ["APPROVED", templates.renderApprovedEmail],
      ["REJECTED", templates.renderRejectedEmail],
    ]).get(action);
    if (!renderer)
      throw new HttpError(400, "Loại email xét duyệt không được hỗ trợ!");
    const built = renderer(application);

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
        {
          filename,
          content: Buffer.from(csv, "utf8"),
          contentType: "text/csv; charset=utf-8",
        },
      ],
    });
  }

  // Báo HR có đơn nghỉ phép mới: gửi ngay, không ghi email_logs, không retry; lỗi ném ra cho service tự xử lý
  async sendLeaveNotificationEmail({ to, intern, leave }) {
    const config = smtpConfig.readConfig();
    if (!smtpConfig.isConfigured(config)) {
      const err = new Error("Chưa cấu hình SMTP đầy đủ!");
      err.classification = "PERMANENT";
      throw err;
    }
    const built = templates.renderLeaveRequestEmail({ intern, leave });
    const transporter = emailSender.buildTransporter(config);
    await emailSender.sendViaTransporter(transporter, {
      from: formatFrom(config),
      to,
      subject: built.subject,
      html: built.html,
      text: built.text,
    });
  }

  // Gọi 1 lần khi khởi động: nạp lại các log PENDING/RETRYING bị dang dở do server tắt/crash
  async loadPendingJobsFromDb() {
    const rows = await db.listPendingOrRetryingEmailLogs();
    for (const row of rows) {
      try {
        const { recipient, built } = await this._rebuildJob(row);
        this._process(row.id, recipient, built, row.attempts).catch((err) =>
          console.error(`[EMAIL] Không nạp lại được log #${row.id}:`, err),
        );
      } catch (err) {
        await db.updateEmailLog(row.id, {
          status: "FAILED",
          errorMessage: "Loại email hoặc dữ liệu dựng lại không hợp lệ.",
        });
        console.error(`[EMAIL] Không dựng được log #${row.id}:`, err);
      }
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
    if (row.meetingId) return this.retryMeetingLog(logId);
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
    if (meetingRules.EMAIL_TYPES.includes(row.emailType)) {
      const payload = await db.findMeetingEmailPayload(row.id);
      if (
        payload.type !== row.emailType ||
        Number(payload.meeting?.id) !== Number(row.meetingId) ||
        payload.recipient?.email !== row.recipientEmail
      )
        throw new HttpError(400, "Snapshot email lịch họp không khớp!");
      return {
        recipient: { to: row.recipientEmail, name: row.recipientName },
        built: templates.renderMeetingEmail(payload),
      };
    }
    const renderer = new Map([
      ["APPROVED", templates.renderApprovedEmail],
      ["REJECTED", templates.renderRejectedEmail],
    ]).get(row.emailType);
    if (!renderer)
      throw new HttpError(400, "Loại email không được hỗ trợ; không gửi!");
    const application = row.applicationId
      ? await db.findApplicationById(row.applicationId)
      : null;
    const payload = application || {
      id: row.applicationId,
      name: row.recipientName,
      email: row.recipientEmail,
    };
    return {
      recipient: { to: row.recipientEmail, name: row.recipientName },
      built: renderer(payload),
    };
  }

  async retryMeetingLog(logId) {
    const row = await db.findEmailLogById(logId);
    if (!row?.meetingId)
      throw new HttpError(404, "Không tìm thấy email lịch họp!");
    if (!["FAILED", "RETRYING"].includes(row.status))
      throw new HttpError(400, "Chỉ gửi lại email thất bại hoặc đang thử lại!");
    const { recipient, built } = await this._rebuildJob(row);
    if (!meetingRules.validEmail(recipient.to))
      throw new HttpError(400, "Email người nhận thiếu hoặc không hợp lệ!");
    if (!(await db.meetingEmailIsCurrent(built.meeting)))
      throw new HttpError(
        409,
        "Sự kiện lịch họp đã cũ hoặc người tham dự đã thay đổi; không gửi lại!",
      );
    const timer = this.timers.get(logId);
    if (timer) clearTimeout(timer);
    this.timers.delete(logId);
    if (!(await db.prepareMeetingRetry(logId)))
      throw new HttpError(
        409,
        "Email đang được xử lý hoặc trạng thái đã thay đổi!",
      );
    this._process(logId, recipient, built, row.attempts, true).catch((err) =>
      console.error("[MEETING-RETRY]", err),
    );
    return db.findEmailLogById(logId);
  }

  async dispatchMeetingJobs() {
    if (this.meetingDispatchRunning) return 0;
    this.meetingDispatchRunning = true;
    let count = 0;
    try {
      for (const row of await db.listMeetingNotificationJobs()) {
        try {
          const payload = JSON.parse(row.payloadJson);
          if (!(await db.meetingEmailIsCurrent(payload))) {
            await db.discardMeetingNotification(row.id);
            continue;
          }
          const labels = {
            MEETING_INVITE: "Lịch họp mới",
            MEETING_UPDATED: "Lịch họp đã cập nhật",
            MEETING_CANCELLED: "Lịch họp đã hủy / đổi người tham dự",
            MEETING_REMINDER: "Sắp đến giờ họp",
          };
          await internNotify.toInterns([row.internId], {
            type: payload.type,
            title: labels[payload.type],
            message:
              `${payload.meeting.title} — ${internNotify.viDate(payload.meeting.startAt)} ${payload.meeting.startAt.slice(11, 16)} (giờ Việt Nam)`.slice(
                0,
                500,
              ),
            targetTab: "tab-my-meetings",
            refId: payload.meeting.id,
            dedupeKey: row.eventKey,
          });
          await db.acknowledgeMeetingNotification(row.id, row.eventKey);
        } catch (err) {
          console.error("[MEETING-NOTIFY]", err);
        }
      }
      while (true) {
        const rows = (await db.listMeetingEmailJobs()).filter(
          (row) => !this.timers.has(row.id),
        );
        if (!rows.length) break;
        let index = 0;
        const worker = async () => {
          while (index < rows.length) {
            const row = rows[index++];
            try {
              const { recipient, built } = await this._rebuildJob(row);
              await this._process(row.id, recipient, built, row.attempts);
              count++;
            } catch (err) {
              console.error("[MEETING-JOB]", err);
              await db.updateEmailLog(row.id, {
                status: "FAILED",
                errorMessage: "Không dựng được dữ liệu email lịch họp.",
              });
            }
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(5, rows.length) }, worker),
        );
      }
      return count;
    } finally {
      this.meetingDispatchRunning = false;
    }
  }

  async _process(logId, recipient, built, priorAttempts, manual = false) {
    if (!built.meeting)
      return this._deliver(logId, recipient, built, priorAttempts);
    const claim = await db.claimMeetingEmail(logId, manual);
    if (!claim) return;
    try {
      if (
        !meetingRules.validEmail(recipient.to) ||
        !(await db.meetingEmailIsCurrent(built.meeting))
      ) {
        await db.updateEmailLog(
          logId,
          {
            status: "FAILED",
            errorMessage:
              "Email không hợp lệ hoặc sự kiện lịch họp đã cũ; không gửi.",
          },
          claim.token,
        );
        return;
      }
      if (!manual && claim.attempts >= MAX_ATTEMPTS) {
        await db.updateEmailLog(
          logId,
          {
            status: "FAILED",
            errorMessage: "Đã hết lượt thử tự động; có thể gửi lại thủ công.",
          },
          claim.token,
        );
        return;
      }
      return await this._deliver(
        logId,
        recipient,
        built,
        claim.attempts,
        claim.token,
      );
    } finally {
      await db.releaseMeetingEmail(logId, claim.token);
    }
  }

  // Xử lý 1 lượt gửi và hẹn giờ retry nếu cần. priorAttempts: số lần đã thử trước đó.
  async _deliver(logId, recipient, built, priorAttempts, claimToken = null) {
    const updateLog = (fields) => db.updateEmailLog(logId, fields, claimToken);
    const attemptNumber = priorAttempts + 1;
    const config = smtpConfig.readConfig();

    // Chưa cấu hình SMTP: FAILED ngay, không retry (thử lại cũng không khỏi)
    if (!smtpConfig.isConfigured(config)) {
      await updateLog({
        status: "FAILED",
        attempts: attemptNumber,
        ...(claimToken ? { nextAttemptAt: null } : {}),
        errorMessage:
          "Chưa cấu hình SMTP (thiếu SMTP server/port/email gửi/App Password). Vào trang Cấu hình Email để thiết lập.",
      });
      this.emit("email:failed", { logId });
      return;
    }

    await updateLog({
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
        ...(built.meeting
          ? {
              messageId: `<meeting-email-${logId}@internship.local>`,
              icalEvent: {
                filename: `lich-hop-${built.meeting.meeting.id}.ics`,
                method: built.icsMethod,
                content: built.ics,
              },
            }
          : {}),
      });

      await updateLog({
        status: "SENT",
        attempts: attemptNumber,
        ...(claimToken ? { nextAttemptAt: null } : {}),
        errorMessage: null,
        sentAt: new Date(),
      });
      this.emit("email:sent", { logId });
    } catch (err) {
      const classification = emailSender.classifyError(err);
      const message = emailSender.getSafeErrorMessage(err);

      // Lỗi vĩnh viễn hoặc hết hạn mức retry: FAILED (HR vẫn có thể "Gửi lại" thủ công)
      if (classification === "PERMANENT" || attemptNumber >= MAX_ATTEMPTS) {
        await updateLog({
          status: "FAILED",
          attempts: attemptNumber,
          ...(claimToken ? { nextAttemptAt: null } : {}),
          errorMessage: message,
        });
        this.emit("email:failed", { logId });
        return;
      }

      // Lỗi tạm thời: RETRYING rồi hẹn giờ thử lại
      const delay = RETRY_DELAYS_MS[attemptNumber - 1];
      await updateLog({
        status: "RETRYING",
        attempts: attemptNumber,
        ...(claimToken
          ? {
              nextAttemptAt: new Date(Date.now() + delay)
                .toISOString()
                .slice(0, 19)
                .replace("T", " "),
            }
          : {}),
        errorMessage: message,
      });
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
