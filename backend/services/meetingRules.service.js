const { HttpError } = require("../errors");
const { isValidDate } = require("../utils/weeks");
const MAX_ATTENDEES = 200;
const SCOPE_TYPES = ["INDIVIDUAL", "PROGRAM", "GROUP"];
const MAX_DURATION_HOURS = 12;
const REMINDER_HOURS = [24, 1];
const EMAIL_TYPES = [
  "MEETING_INVITE",
  "MEETING_UPDATED",
  "MEETING_CANCELLED",
  "MEETING_REMINDER",
];
function id(value) {
  if (
    !["string", "number"].includes(typeof value) ||
    !/^[1-9]\d*$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new HttpError(400, "Mã không hợp lệ!");
  return Number(value);
}
function toDate(value) {
  return new Date(String(value).replace(" ", "T") + "+07:00");
}
function toSql(date) {
  return new Date(new Date(date).getTime() + 7 * 3600000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}
function parseTime(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|\+07:00)?$/.test(value) ||
    !isValidDate(value.slice(0, 10))
  )
    throw new HttpError(
      400,
      "Thời gian phải là ISO 8601 (giờ Việt Nam, +07:00 hoặc Z)!",
    );
  const [h, m, s = 0] = value
    .slice(11)
    .replace(/(?:Z|\+07:00)$/, " ")
    .trim()
    .split(":")
    .map(Number);
  if (h > 23 || m > 59 || s > 59)
    throw new HttpError(400, "Giờ họp không hợp lệ!");
  const date = new Date(
    /(?:Z|\+07:00)$/.test(value) ? value : value + "+07:00",
  );
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1000 ||
    new Date(date.getTime() + 7 * 3600000).getUTCFullYear() > 9999
  )
    throw new HttpError(400, "Thời gian không hợp lệ!");
  return date;
}
function validEmail(value) {
  return (
    typeof value === "string" &&
    value.length <= 150 &&
    /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)
  );
}
function validateInput(body, { now = new Date() } = {}) {
  const keys = [
    "title",
    "description",
    "start_at",
    "end_at",
    "location",
    "meeting_link",
    "program_id",
    "attendee_ids",
    "request_key",
    "scope_type",
    "group_id",
    "include_ids",
    "exclude_ids",
  ];
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !keys.includes(k))
  )
    throw new HttpError(400, "Dữ liệu lịch họp không hợp lệ!");
  const text = (key, max, required = false) => {
    if (body[key] != null && typeof body[key] !== "string")
      throw new HttpError(400, `Trường ${key} phải là chuỗi!`);
    const v = (body[key] || "").trim();
    if ((required && !v) || v.length > max || /\x00/.test(v))
      throw new HttpError(
        400,
        `Trường ${key} bắt buộc/hợp lệ tối đa ${max} ký tự!`,
      );
    return v;
  };
  const start = parseTime(body.start_at),
    end = parseTime(body.end_at);
  if (start <= now)
    throw new HttpError(400, "Cuộc họp phải bắt đầu trong tương lai!");
  if (end <= start || end - start > MAX_DURATION_HOURS * 3600000)
    throw new HttpError(
      400,
      `Giờ kết thúc phải sau giờ bắt đầu; tối đa ${MAX_DURATION_HOURS} giờ!`,
    );
  // Phạm vi lịch: INDIVIDUAL (chọn tay như trước), PROGRAM / GROUP (tự lấy từ quan hệ thành viên).
  const scopeType = body.scope_type == null ? "INDIVIDUAL" : body.scope_type;
  if (!SCOPE_TYPES.includes(scopeType))
    throw new HttpError(400, "Phạm vi lịch họp không hợp lệ!");
  const idList = (key) => {
    const raw = body[key];
    if (raw == null) return [];
    if (
      !Array.isArray(raw) ||
      raw.length > MAX_ATTENDEES ||
      raw.some((v) => typeof v !== "number")
    )
      throw new HttpError(400, `Trường ${key} phải là danh sách mã hợp lệ!`);
    const list = raw.map(id).sort((a, b) => a - b);
    if (new Set(list).size !== list.length)
      throw new HttpError(400, `Trường ${key} không được trùng!`);
    return list;
  };
  const groupId =
    body.group_id == null || body.group_id === "" ? null : id(body.group_id);
  const includeIds = idList("include_ids");
  const excludeIds = idList("exclude_ids");
  if (includeIds.some((x) => excludeIds.includes(x)))
    throw new HttpError(400, "Một người không thể vừa thêm vừa loại khỏi lịch!");
  let attendeeIds = [];
  if (scopeType === "INDIVIDUAL") {
    if (groupId != null || includeIds.length || excludeIds.length)
      throw new HttpError(
        400,
        "Nhóm và danh sách ngoại lệ chỉ dùng cho lịch theo chương trình hoặc nhóm!",
      );
    const attendees = body.attendee_ids;
    if (
      !Array.isArray(attendees) ||
      !attendees.length ||
      attendees.length > MAX_ATTENDEES ||
      attendees.some((v) => typeof v !== "number")
    )
      throw new HttpError(400, `Chọn từ 1 đến ${MAX_ATTENDEES} thực tập sinh!`);
    attendeeIds = attendees.map(id).sort((a, b) => a - b);
    if (new Set(attendeeIds).size !== attendeeIds.length)
      throw new HttpError(400, "Người tham dự không được trùng!");
  } else {
    if (Array.isArray(body.attendee_ids) ? body.attendee_ids.length : body.attendee_ids != null)
      throw new HttpError(
        400,
        "Lịch theo chương trình/nhóm tự lấy người tham dự; dùng include_ids / exclude_ids cho ngoại lệ!",
      );
    if (body.program_id == null || body.program_id === "")
      throw new HttpError(400, "Lịch theo chương trình/nhóm cần chọn chương trình!");
    if (scopeType === "PROGRAM" && (groupId != null || includeIds.length))
      throw new HttpError(
        400,
        "Lịch theo chương trình không có nhóm và không cần danh sách thêm người!",
      );
    if (scopeType === "GROUP" && groupId == null)
      throw new HttpError(400, "Lịch theo nhóm cần chọn nhóm!");
  }
  let meetingLink = text("meeting_link", 1000);
  if (meetingLink) {
    let url;
    try {
      url = new URL(meetingLink);
    } catch {
      throw new HttpError(400, "Liên kết họp không hợp lệ!");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new HttpError(
        400,
        "Liên kết chỉ nhận HTTP/HTTPS không chứa mật khẩu!",
      );
    meetingLink = url.href;
  }
  const requestKey = text("request_key", 64);
  if (requestKey && !/^[a-zA-Z0-9_-]{8,64}$/.test(requestKey))
    throw new HttpError(400, "Khóa tạo lịch không hợp lệ!");
  return {
    title: text("title", 200, true),
    description: text("description", 4000),
    startAt: toSql(start),
    endAt: toSql(end),
    location: text("location", 255),
    meetingLink,
    programId:
      body.program_id == null || body.program_id === ""
        ? null
        : id(body.program_id),
    attendeeIds,
    scopeType,
    groupId,
    includeIds,
    excludeIds,
    requestKey: requestKey || null,
  };
}
const MAX_WEEKLY_OCCURRENCES = 52;
// Lặp lại hằng tuần: tách hai trường lặp khỏi thân yêu cầu, phần còn lại vẫn đi qua validateInput như cũ.
function splitRecurrence(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    (body.repeat_weekly == null && body.repeat_until == null)
  )
    return { body, repeat: null };
  const { repeat_weekly, repeat_until, ...rest } = body;
  if (repeat_weekly == null || repeat_weekly === false) {
    if (repeat_until)
      throw new HttpError(400, "Chỉ nhập ngày kết thúc khi bật lặp lại hằng tuần!");
    return { body: rest, repeat: null };
  }
  if (repeat_weekly !== true)
    throw new HttpError(400, "Trường repeat_weekly phải là true/false!");
  if (typeof repeat_until !== "string" || !isValidDate(repeat_until))
    throw new HttpError(400, "Vui lòng chọn ngày kết thúc hợp lệ cho lịch lặp lại!");
  return { body: rest, repeat: { until: repeat_until } };
}
// Sinh các buổi họp cách nhau 7 ngày (giờ Việt Nam không có giờ mùa hè) từ buổi đầu đến hết ngày kết thúc.
function expandWeekly(value, until) {
  if (until < value.startAt.slice(0, 10))
    throw new HttpError(400, "Ngày kết thúc lặp lại không được trước ngày họp đầu tiên!");
  const start = toDate(value.startAt).getTime(),
    end = toDate(value.endAt).getTime(),
    week = 7 * 24 * 3600000,
    list = [];
  for (let k = 0; ; k++) {
    const startAt = toSql(start + k * week);
    if (startAt.slice(0, 10) > until) break;
    if (k >= MAX_WEEKLY_OCCURRENCES)
      throw new HttpError(
        400,
        `Lịch lặp lại tối đa ${MAX_WEEKLY_OCCURRENCES} buổi, vui lòng chọn ngày kết thúc sớm hơn!`,
      );
    list.push({
      ...value,
      startAt,
      endAt: toSql(end + k * week),
      requestKey: value.requestKey
        ? k === 0
          ? value.requestKey
          : `${value.requestKey.slice(0, 58)}-w${k}`
        : null,
    });
  }
  return list;
}
function validateQuery(query = {}) {
  for (const [key, v] of Object.entries(query))
    if (
      !["from", "to", "status", "page", "pageSize", "q"].includes(key) ||
      typeof v !== "string"
    )
      throw new HttpError(400, "Tham số lịch họp sai hoặc bị lặp!");
  for (const key of ["from", "to"])
    if (query[key] && !isValidDate(query[key]))
      throw new HttpError(400, "Ngày lọc không hợp lệ!");
  if (query.from && query.to && query.from > query.to)
    throw new HttpError(400, "Ngày bắt đầu không được sau ngày kết thúc!");
  if (query.status && !["SCHEDULED", "CANCELLED"].includes(query.status))
    throw new HttpError(400, "Trạng thái cuộc họp không hợp lệ!");
  if ((query.q || "").length > 100)
    throw new HttpError(400, "Từ khóa tối đa 100 ký tự!");
  const page = query.page ? id(query.page) : 1,
    pageSize = query.pageSize ? id(query.pageSize) : 20;
  if (page > 100000 || pageSize > 50)
    throw new HttpError(400, "Phân trang vượt giới hạn!");
  return {
    from: query.from || null,
    to: query.to || null,
    status: query.status || null,
    q: query.q?.trim() || "",
    page,
    pageSize,
  };
}
function needsUpdate(old, value) {
  return ["startAt", "endAt", "location", "meetingLink"].some(
    (key) => (old[key] || "") !== (value[key] || ""),
  );
}
function reminderKey(meeting, hours, internId) {
  return `meet:${meeting.id}:s${meeting.sequence}:rem${hours}:i${internId}`;
}
function eventKey(meeting, type, internId) {
  return `meet:${meeting.id}:s${meeting.sequence}:${type}:i${internId}`;
}
function reminderSlot(meeting, now = new Date()) {
  const remaining = (toDate(meeting.startAt) - now) / 3600000;
  // Reminder horizon is state based, not a fragile one-minute window. The nearest slot wins after downtime.
  if (remaining <= 0 || remaining > REMINDER_HOURS[0]) return null;
  return remaining <= REMINDER_HOURS[1] ? REMINDER_HOURS[1] : REMINDER_HOURS[0];
}
module.exports = {
  MAX_ATTENDEES,
  SCOPE_TYPES,
  MAX_DURATION_HOURS,
  REMINDER_HOURS,
  EMAIL_TYPES,
  id,
  toDate,
  toSql,
  parseTime,
  validEmail,
  validateInput,
  splitRecurrence,
  expandWeekly,
  MAX_WEEKLY_OCCURRENCES,
  validateQuery,
  needsUpdate,
  reminderKey,
  eventKey,
  reminderSlot,
};
