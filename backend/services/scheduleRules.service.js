// Quy tắc lịch làm việc (dùng chung cho chấm công, nghỉ phép, báo cáo và quản lý lịch): kiểm tra dữ liệu, tính lịch áp dụng cho từng thực tập sinh và đánh giá chấm công theo lịch.
// Các hàm "thuần" (không gọi DB) được tách riêng để dễ kiểm thử; chỉ resolveScheduleForIntern đọc DB.
const db = require("../db");
const { HttpError } = require("../errors");
const weeks = require("../utils/weeks");

const TYPES = ["DEFAULT", "UNIVERSITY", "PROGRAM", "MENTOR", "INTERN"];
const MODES = ["FIXED", "FLEXIBLE"];
// Thứ tự ưu tiên khi một thực tập sinh khớp nhiều phạm vi (cụ thể nhất thắng).
const PRIORITY = ["INTERN", "PROGRAM", "MENTOR", "UNIVERSITY", "DEFAULT"];
const DEFAULT_SCHEDULE_ID = 1;
const DAY_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const idPattern = /^[1-9]\d*$/;
const FAR_FUTURE = "9999-12-31";

function assertId(value, message = "ID không hợp lệ!") {
  if (!idPattern.test(String(value))) throw new HttpError(400, message);
  return Number(value);
}
// "08:30" hoặc "08:30:00" -> số phút trong ngày; sai định dạng -> null.
function timeMinutes(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) return null;
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
function addDays(date, delta) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);
}

// ---------- Kiểm tra dữ liệu lịch ----------
// Kiểm tra tính nhất quán của một lịch đã chuẩn hóa (dùng cho cả tạo mới và sửa).
function assertScheduleConsistent(schedule) {
  const days = schedule.days || [];
  if (days.length !== 7) throw new HttpError(400, "Cần cấu hình đủ 7 ngày trong tuần!");
  const working = days.filter((d) => d.isWorking);
  if (!working.length) throw new HttpError(400, "Lịch phải có ít nhất một ngày làm việc!");
  if (schedule.mode === "FIXED") {
    for (const day of working) {
      const start = timeMinutes(day.startTime);
      const end = timeMinutes(day.endTime);
      if (start == null || end == null || end <= start)
        throw new HttpError(400, "Giờ bắt đầu/kết thúc của ngày làm việc không hợp lệ!");
    }
  }
  if (schedule.mode === "FLEXIBLE" && !(Number(schedule.minDailyMinutes) >= 30))
    throw new HttpError(400, "Lịch linh hoạt cần số phút tối thiểu mỗi ngày!");
}
function validateSchedule(input, partial = false) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new HttpError(400, "Dữ liệu lịch làm việc không hợp lệ!");
  const allowed = ["name", "description", "mode", "grace_minutes", "min_daily_minutes", "days"];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new HttpError(400, "Dữ liệu lịch làm việc có trường không hợp lệ!");
  if (partial && !Object.keys(input).length)
    throw new HttpError(400, "Cần gửi ít nhất một trường để cập nhật!");
  const out = {};
  if (Object.hasOwn(input, "name")) {
    out.name = String(input.name || "").trim();
    if (!out.name || out.name.length > 150) throw new HttpError(400, "Tên lịch phải từ 1 đến 150 ký tự!");
  }
  if (Object.hasOwn(input, "description")) {
    if (input.description != null && typeof input.description !== "string")
      throw new HttpError(400, "Mô tả phải là chuỗi!");
    out.description = String(input.description || "").trim().slice(0, 1000);
  }
  if (Object.hasOwn(input, "mode")) {
    if (!MODES.includes(input.mode)) throw new HttpError(400, "Chế độ lịch không hợp lệ!");
    out.mode = input.mode;
  }
  if (Object.hasOwn(input, "grace_minutes")) {
    out.graceMinutes = Number(input.grace_minutes);
    if (!Number.isInteger(out.graceMinutes) || out.graceMinutes < 0 || out.graceMinutes > 120)
      throw new HttpError(400, "Dung sai phải từ 0 đến 120 phút!");
  }
  if (Object.hasOwn(input, "min_daily_minutes") && input.min_daily_minutes != null && input.min_daily_minutes !== "") {
    out.minDailyMinutes = Number(input.min_daily_minutes);
    if (!Number.isInteger(out.minDailyMinutes) || out.minDailyMinutes < 30 || out.minDailyMinutes > 720)
      throw new HttpError(400, "Số phút tối thiểu phải từ 30 đến 720!");
  }
  if (Object.hasOwn(input, "days")) {
    if (!Array.isArray(input.days) || input.days.length !== 7)
      throw new HttpError(400, "Cần cấu hình đủ 7 ngày trong tuần!");
    const seen = new Set();
    out.days = input.days.map((day) => {
      const dayKeys = ["weekday", "is_working", "start_time", "end_time"];
      if (!day || typeof day !== "object" || Object.keys(day).some((key) => !dayKeys.includes(key)))
        throw new HttpError(400, "Cấu hình ngày làm việc không hợp lệ!");
      const weekday = Number(day.weekday);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7 || seen.has(weekday))
        throw new HttpError(400, "Thứ trong tuần không hợp lệ!");
      seen.add(weekday);
      return {
        weekday,
        isWorking: Boolean(day.is_working),
        startTime: typeof day.start_time === "string" && day.start_time ? day.start_time.slice(0, 5) : null,
        endTime: typeof day.end_time === "string" && day.end_time ? day.end_time.slice(0, 5) : null,
      };
    });
  }
  if (!partial) {
    if (!out.name || !out.mode || !out.days) throw new HttpError(400, "Thiếu thông tin bắt buộc của lịch làm việc!");
    assertScheduleConsistent({ ...out, mode: out.mode });
  }
  return out;
}

// ---------- Mô tả lịch ----------
// "T2–T6 08:30–17:30", "T2–T6 · tối thiểu 240 phút/ngày", hoặc "Giờ khác nhau theo ngày".
function summarizeSchedule(schedule) {
  const working = (schedule.days || []).filter((d) => d.isWorking).sort((a, b) => a.weekday - b.weekday);
  if (!working.length) return "Không có ngày làm việc";
  const ranges = [];
  for (const day of working) {
    const last = ranges[ranges.length - 1];
    if (last && day.weekday === last.to + 1) last.to = day.weekday;
    else ranges.push({ from: day.weekday, to: day.weekday });
  }
  const daysText = ranges
    .map((r) => (r.from === r.to ? DAY_LABELS[r.from - 1] : `${DAY_LABELS[r.from - 1]}–${DAY_LABELS[r.to - 1]}`))
    .join(", ");
  if (schedule.mode === "FLEXIBLE") return `${daysText} · linh hoạt, tối thiểu ${schedule.minDailyMinutes} phút/ngày`;
  const hours = new Set(working.map((d) => `${d.startTime}–${d.endTime}`));
  return hours.size === 1 ? `${daysText} ${[...hours][0]}` : `${daysText} · giờ khác nhau theo ngày`;
}

// ---------- Quy tắc của một ngày ----------
function getDayRule(schedule, date) {
  const weekday = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1; // 1 = Thứ 2 ... 7 = Chủ nhật
  const day = (schedule.days || []).find((x) => Number(x.weekday) === weekday);
  return {
    isWorkingDay: !!day?.isWorking,
    mode: schedule.mode,
    startTime: day?.startTime || null,
    endTime: day?.endTime || null,
    graceMinutes: Number(schedule.graceMinutes || 0),
    minDailyMinutes: schedule.mode === "FLEXIBLE" ? Number(schedule.minDailyMinutes) : null,
  };
}
// Cờ chấm công của một bản ghi theo quy tắc ngày (giờ trong bản ghi là giờ Việt Nam).
function evaluateAttendance(dayRule, record) {
  const flags = [];
  if (!record) return flags;
  if (!record.checkOutAt) {
    flags.push("MISSING_CHECKOUT");
    return flags;
  }
  if (dayRule.mode === "FIXED") {
    const start = timeMinutes(dayRule.startTime);
    const end = timeMinutes(dayRule.endTime);
    const inTime = timeMinutes(String(record.checkInAt).slice(11, 16));
    const outTime = timeMinutes(String(record.checkOutAt).slice(11, 16));
    if (start != null && inTime != null && inTime > start + dayRule.graceMinutes) flags.push("LATE");
    if (end != null && outTime != null && outTime < end - dayRule.graceMinutes) flags.push("EARLY_LEAVE");
  } else if (dayRule.mode === "FLEXIBLE") {
    const toMs = (text) => Date.parse(`${String(text).replace(" ", "T")}+07:00`);
    const minutes =
      record.durationMinutes ?? Math.max(0, Math.floor((toMs(record.checkOutAt) - toMs(record.checkInAt)) / 60000));
    if (minutes < dayRule.minDailyMinutes) flags.push("SHORT_HOURS");
  }
  return flags;
}

// ---------- Hợp đồng ----------
// Ngày bắt đầu/kết thúc có thể để trống = không giới hạn.
function contractCovers(contract, date) {
  return (!contract.startDate || contract.startDate <= date) && (!contract.endDate || contract.endDate >= date);
}
// Chương trình của hợp đồng xác nhận gần nhất bao phủ ngày đó (null nếu không có).
function findContractProgram(contracts, date) {
  const covering = contracts.filter((c) => contractCovers(c, date));
  if (!covering.length) return null;
  covering.sort((a, b) => String(b.confirmedAt || "").localeCompare(String(a.confirmedAt || "")) || b.id - a.id);
  return covering[0].programId == null ? null : Number(covering[0].programId);
}

// ---------- Lịch áp dụng ----------
function describeTarget(type, value, ctx) {
  if (type === "DEFAULT") return "Mặc định";
  if (type === "INTERN") return "Cá nhân";
  if (type === "UNIVERSITY") return `Trường: ${value}`;
  if (type === "PROGRAM") {
    const program = (ctx.programs || []).find((p) => String(p.id) === String(value));
    return `Chương trình: ${program ? program.name : `#${value}`}`;
  }
  const mentor = (ctx.mentors || []).find((m) => String(m.id) === String(value));
  return `Nhóm mentor: ${mentor ? mentor.name : `#${value}`}`;
}
// intern: { id, university, mentorId }. ctx: kết quả db.loadWorkScheduleContext().
function resolveScheduleFromContext(ctx, intern, date, programId = null) {
  const candidates = {
    INTERN: String(intern.id),
    PROGRAM: programId == null ? null : String(programId),
    MENTOR: intern.mentorId == null ? null : String(intern.mentorId),
    UNIVERSITY: intern.university || null,
    DEFAULT: "",
  };
  const byId = new Map(ctx.schedules.map((s) => [s.id, s]));
  for (const type of PRIORITY) {
    const value = candidates[type];
    if (value == null) continue;
    const match = ctx.assignments
      .filter(
        (a) =>
          a.targetType === type &&
          String(a.targetValue) === value &&
          a.effectiveFrom <= date &&
          (!a.effectiveTo || a.effectiveTo >= date),
      )
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.id - a.id)[0];
    const schedule = match && byId.get(Number(match.scheduleId));
    if (schedule) return { schedule, source: { type, value, label: describeTarget(type, value, ctx) } };
  }
  // Không có lịch gán nào còn hiệu lực: dùng lịch mặc định của hệ thống.
  const fallback = byId.get(DEFAULT_SCHEDULE_ID);
  return fallback ? { schedule: fallback, source: { type: "DEFAULT", value: "", label: "Mặc định" } } : null;
}
// Thực tập sinh có thuộc phạm vi (type, value) không? Dùng để xem trước số người bị ảnh hưởng.
function internMatchesTarget(intern, contracts, type, value) {
  if (type === "DEFAULT") return true;
  if (type === "INTERN") return String(intern.id) === String(value);
  if (type === "UNIVERSITY") return intern.university === value;
  if (type === "MENTOR") return String(intern.mentorId) === String(value);
  return contracts.some((c) => Number(c.internId) === Number(intern.id) && String(c.programId) === String(value));
}
// Kế hoạch khi thêm một lần áp dụng mới cho cùng phạm vi: tự đóng lần đang mở bắt đầu trước đó,
// và báo xung đột nếu khoảng ngày mới vẫn trùng với lần áp dụng khác.
function planAssignmentChange(existing, incoming) {
  const newTo = incoming.effectiveTo || FAR_FUTURE;
  const close = [];
  const remaining = [];
  for (const row of existing) {
    if (!row.effectiveTo && row.effectiveFrom < incoming.effectiveFrom) {
      close.push({ id: row.id, effectiveTo: addDays(incoming.effectiveFrom, -1) });
    } else {
      remaining.push(row);
    }
  }
  const conflict = remaining.some(
    (row) => row.effectiveFrom <= newTo && (row.effectiveTo || FAR_FUTURE) >= incoming.effectiveFrom,
  );
  return { conflict, close };
}

// Lịch áp dụng cho một thực tập sinh tại một ngày (đọc DB).
async function resolveScheduleForIntern(internId, date) {
  assertId(internId, "ID thực tập sinh không hợp lệ!");
  if (!weeks.isValidDate(date)) throw new HttpError(400, "Ngày không hợp lệ!");
  const intern = await db.findInternProfileById(Number(internId));
  if (!intern) throw new HttpError(404, "Không tìm thấy thực tập sinh!");
  const [contracts, ctx] = await Promise.all([
    db.listConfirmedContractsForInterns([intern.id]),
    db.loadWorkScheduleContext(),
  ]);
  const resolved = resolveScheduleFromContext(ctx, intern, date, findContractProgram(contracts, date));
  if (!resolved) throw new HttpError(404, "Chưa có lịch làm việc mặc định!");
  return resolved;
}

module.exports = {
  TYPES,
  MODES,
  PRIORITY,
  DEFAULT_SCHEDULE_ID,
  validateSchedule,
  assertScheduleConsistent,
  summarizeSchedule,
  getDayRule,
  evaluateAttendance,
  contractCovers,
  findContractProgram,
  describeTarget,
  resolveScheduleFromContext,
  internMatchesTarget,
  planAssignmentChange,
  resolveScheduleForIntern,
  assertId,
  timeMinutes,
  addDays,
};
