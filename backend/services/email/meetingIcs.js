const { validEmail } = require("../meetingRules.service");
function escapeText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}
function foldLine(value) {
  const out = [];
  let line = "",
    bytes = 0;
  for (const ch of String(value)) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > 75) {
      out.push(line);
      line = " ";
      bytes = 1;
    }
    line += ch;
    bytes += n;
  }
  out.push(line);
  return out.join("\r\n");
}
const local = (value) =>
  String(value)
    .replace(/[- :]/g, "")
    .replace("T", "")
    .replace(/^(\d{8})(\d{6})$/, "$1T$2");
const param = (value) =>
  '"' +
  String(value ?? "")
    .replace(/\^/g, "^^")
    .replace(/[\r\n]+/g, "^n")
    .replace(/"/g, "^'") +
  '"';
function renderMeetingIcs({ meeting, recipient, type, issuedAt }) {
  const cancel = type === "MEETING_CANCELLED",
    method = cancel ? "CANCEL" : "REQUEST";
  const stamp = new Date(issuedAt || Date.now())
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Internship Management//Meetings//VI",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:" + method,
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Ho_Chi_Minh",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0700",
    "TZOFFSETTO:+0700",
    "TZNAME:ICT",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:meeting-${meeting.id}@internship.local`,
    `SEQUENCE:${Number(meeting.sequence) || 0}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Asia/Ho_Chi_Minh:${local(meeting.startAt)}`,
    `DTEND;TZID=Asia/Ho_Chi_Minh:${local(meeting.endAt)}`,
    "SUMMARY:" + escapeText(meeting.title),
    "DESCRIPTION:" +
      escapeText(
        [meeting.description, meeting.meetingLink].filter(Boolean).join("\n"),
      ),
    "LOCATION:" + escapeText(meeting.location),
    "STATUS:" + (cancel ? "CANCELLED" : "CONFIRMED"),
  ];
  if (validEmail(meeting.organizerEmail))
    lines.push(
      `ORGANIZER;CN=${param(meeting.organizerName)}:mailto:${encodeURIComponent(meeting.organizerEmail).replace(/%40/g, "@")}`,
    );
  if (validEmail(recipient.email))
    lines.push(
      `ATTENDEE;CN=${param(recipient.name)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${encodeURIComponent(recipient.email).replace(/%40/g, "@")}`,
    );
  if (meeting.meetingLink)
    lines.push("URL:" + String(meeting.meetingLink).replace(/[\r\n]/g, ""));
  lines.push("END:VEVENT", "END:VCALENDAR");
  return { method, content: lines.map(foldLine).join("\r\n") + "\r\n" };
}
module.exports = { escapeText, foldLine, renderMeetingIcs };
