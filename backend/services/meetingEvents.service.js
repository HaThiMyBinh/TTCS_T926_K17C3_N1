const {
  validEmail,
  needsUpdate,
  eventKey,
  reminderKey,
} = require("./meetingRules.service");
const templates = require("./email/templates");
function calendarChanged(old, next, before, after) {
  return (
    needsUpdate(old, next) ||
    before
      .map((i) => Number(i.id))
      .sort((a, b) => a - b)
      .join(",") !==
      after
        .map((i) => Number(i.id))
        .sort((a, b) => a - b)
        .join(",")
  );
}
function buildJobs(
  meeting,
  before,
  after,
  { created = false, cancel = false, old = null, reminderHours = null } = {},
) {
  const events = [];
  const add = (intern, type, removed = false) => {
    const payload = {
      meeting,
      recipient: {
        id: Number(intern.id),
        name: intern.fullName,
        email: String(intern.email || "").trim(),
      },
      type,
      removed,
      reminderHours,
      issuedAt: new Date().toISOString(),
    };
    const built = templates.renderMeetingEmail(payload);
    const valid = validEmail(payload.recipient.email);
    events.push({
      internId: intern.id,
      recipientEmail: payload.recipient.email,
      recipientName: intern.fullName,
      emailType: type,
      subject: built.subject,
      payloadJson: JSON.stringify(payload),
      eventKey: reminderHours
        ? reminderKey(meeting, reminderHours, intern.id)
        : eventKey(meeting, type, intern.id),
      status: valid ? "PENDING" : "FAILED",
      errorMessage: valid
        ? null
        : "Email thực tập sinh thiếu hoặc không hợp lệ; chưa gửi.",
      notificationPending: 1,
    });
  };
  if (reminderHours) after.forEach((i) => add(i, "MEETING_REMINDER"));
  else if (created) after.forEach((i) => add(i, "MEETING_INVITE"));
  else if (cancel) before.forEach((i) => add(i, "MEETING_CANCELLED"));
  else {
    const oldIds = new Set(before.map((i) => Number(i.id))),
      newIds = new Set(after.map((i) => Number(i.id)));
    after.forEach((i) => {
      if (!oldIds.has(Number(i.id))) add(i, "MEETING_INVITE");
      else if (needsUpdate(old, meeting)) add(i, "MEETING_UPDATED");
    });
    before.forEach((i) => {
      if (!newIds.has(Number(i.id))) add(i, "MEETING_CANCELLED", true);
    });
  }
  return events;
}
module.exports = { buildJobs, calendarChanged };
