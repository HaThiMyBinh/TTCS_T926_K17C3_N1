const db = require("../db");
const { HttpError } = require("../errors");
const rules = require("./meetingRules.service");
const events = require("./meetingEvents.service");
const emailQueue = require("./email/emailQueue");
async function context(user, staff = false) {
  if (!user) throw new HttpError(401, "Chưa đăng nhập!");
  if (!["HR", "Mentor", ...(staff ? [] : ["Intern"])].includes(user.role))
    throw new HttpError(403, "Không có quyền xem lịch họp!");
  const result = { role: user.role, userId: rules.id(user.id) };
  if (user.role === "Mentor") {
    const mentor = await db.findMentorByEmail(user.email);
    if (!mentor) throw new HttpError(403, "Chưa có hồ sơ mentor!");
    result.mentorId = Number(mentor.id);
  }
  if (user.role === "Intern") {
    const intern = await db.findInternProfileByEmail(user.email);
    if (!intern) throw new HttpError(403, "Chưa có hồ sơ thực tập sinh!");
    result.internId = Number(intern.id);
  }
  return result;
}
function kick() {
  emailQueue
    .dispatchMeetingJobs()
    .catch((err) => console.error("[MEETING-OUTBOX]", err));
}
async function list(user, query) {
  return db.listMeetings(await context(user), rules.validateQuery(query));
}
async function detail(user, rawId) {
  const value = await db.findMeetingScoped(
    rules.id(rawId),
    await context(user),
  );
  if (!value)
    throw new HttpError(
      404,
      "Không tìm thấy cuộc họp hoặc không có quyền truy cập!",
    );
  return value;
}
async function options(user, query = {}) {
  if (
    Object.keys(query).some((k) => k !== "q") ||
    (query.q != null && typeof query.q !== "string") ||
    (query.q || "").length > 100
  )
    throw new HttpError(400, "Bộ lọc người tham dự không hợp lệ!");
  const scope = await context(user, true);
  const result = await db.getMeetingOptions(scope, (query.q || "").trim());
  // Chỉ HR được tạo lịch theo chương trình/nhóm (mentor chỉ mời thực tập sinh của mình).
  if (scope.role === "HR") result.groups = await db.listProgramGroupOptions();
  return result;
}
async function save(user, rawId, body, cancel = false) {
  const scope = await context(user, true),
    id = rawId == null ? null : rules.id(rawId);
  if (cancel && Object.keys(body || {}).length)
    throw new HttpError(400, "Hủy lịch không nhận trường bổ sung!");
  const split = cancel ? { body, repeat: null } : rules.splitRecurrence(body);
  if (split.repeat && id != null)
    throw new HttpError(400, "Chỉ tạo lịch lặp lại khi tạo cuộc họp mới!");
  body = split.body;
  const value = cancel ? null : rules.validateInput(body);
  if (split.repeat) {
    // Mỗi buổi là một cuộc họp độc lập (mời/nhắc/hủy riêng), lưu lần lượt; request_key riêng giúp gửi lại không bị tạo trùng.
    const occurrences = rules.expandWeekly(value, split.repeat.until),
      created = [];
    try {
      for (const occurrence of occurrences)
        created.push(
          await db.saveMeetingAtomic({
            id: null,
            context: scope,
            value: occurrence,
            cancel: false,
            buildJobs: events.buildJobs,
            calendarChanged: events.calendarChanged,
          }),
        );
    } finally {
      if (created.length) kick();
    }
    return {
      ...created[0],
      occurrences: created.length,
      meetingIds: created.map((c) => c.id),
      meeting: await detail(user, created[0].id),
    };
  }
  const result = await db.saveMeetingAtomic({
    id,
    context: scope,
    value,
    cancel,
    buildJobs: events.buildJobs,
    calendarChanged: events.calendarChanged,
  });
  // The transaction already persisted each event; SMTP and notification work starts strictly after commit.
  kick();
  return { ...result, meeting: await detail(user, result.id) };
}
async function retry(user, rawId, rawLogId) {
  await context(user, true);
  const meeting = await detail(user, rawId),
    logId = rules.id(rawLogId);
  if (!meeting.emailLogs.some((log) => Number(log.id) === logId))
    throw new HttpError(404, "Không tìm thấy email của cuộc họp!");
  // Staff retry is background work too; it cannot hold an HTTP request open for SMTP timeouts.
  const result = await emailQueue.retryMeetingLog(logId);
  return result;
}
module.exports = { context, list, detail, options, save, retry };
