// Quản lý lịch làm việc (HR): mẫu lịch, gán lịch cho nhóm, ngày nghỉ chung, và lịch của thực tập sinh.
// Quy tắc tính toán thuần (kiểm tra dữ liệu, tìm lịch áp dụng, đánh giá chấm công) nằm ở scheduleRules.service.js.
const db = require("../db");
const { HttpError } = require("../errors");
const weeks = require("../utils/weeks");
const { getVietnamToday } = require("../utils/date");
const w = require("./scheduleRules.service");

function requireDate(value, message = "Ngày không hợp lệ!") {
  if (typeof value !== "string" || !weeks.isValidDate(value)) throw new HttpError(400, message);
  return value;
}
function withSummary(schedule) {
  return { ...schedule, summary: w.summarizeSchedule(schedule) };
}
function isForeignKeyError(err) {
  return err && (err.code === "ER_ROW_IS_REFERENCED_2" || err.code === "ER_ROW_IS_REFERENCED");
}

// ---------- Mẫu lịch ----------
async function list() {
  return (await db.listWorkSchedules()).map(withSummary);
}
async function get(rawId) {
  const schedule = await db.findWorkSchedule(w.assertId(rawId));
  if (!schedule) throw new HttpError(404, "Không tìm thấy lịch làm việc!");
  return withSummary(schedule);
}
async function create(body) {
  const input = w.validateSchedule(body);
  try {
    return withSummary(await db.saveWorkSchedule(null, input));
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") throw new HttpError(409, "Tên lịch làm việc đã tồn tại!");
    throw err;
  }
}
async function update(rawId, body) {
  const current = await get(rawId);
  const input = w.validateSchedule(body, true);
  const merged = { ...current, ...input, days: input.days || current.days };
  if (merged.mode === "FIXED" && !input.days && current.mode !== "FIXED")
    throw new HttpError(400, "Đổi sang giờ cố định cần nhập lại giờ làm việc từng ngày!");
  w.assertScheduleConsistent(merged);
  try {
    return withSummary(await db.saveWorkSchedule(current.id, merged));
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") throw new HttpError(409, "Tên lịch làm việc đã tồn tại!");
    throw err;
  }
}
async function remove(rawId) {
  const id = w.assertId(rawId);
  if (id === w.DEFAULT_SCHEDULE_ID) throw new HttpError(409, "Không thể xóa lịch mặc định!");
  try {
    if (!(await db.deleteWorkSchedule(id)))
      throw new HttpError(409, "Không thể xóa lịch đang được áp dụng cho nhóm nào đó hoặc lịch không tồn tại!");
  } catch (err) {
    if (isForeignKeyError(err)) throw new HttpError(409, "Không thể xóa lịch đang được áp dụng cho nhóm nào đó!");
    throw err;
  }
  return null;
}

// ---------- Gán lịch cho nhóm ----------
function validateTarget(type, rawValue) {
  if (!w.TYPES.includes(type)) throw new HttpError(400, "Loại phạm vi không hợp lệ!");
  if (type === "DEFAULT") return "";
  const value = String(rawValue ?? "").trim();
  if (!value) throw new HttpError(400, "Thiếu giá trị phạm vi!");
  if (type === "UNIVERSITY" && value.length > 255) throw new HttpError(400, "Tên trường quá dài!");
  if (type !== "UNIVERSITY" && !/^[1-9]\d*$/.test(value)) throw new HttpError(400, "Giá trị phạm vi không hợp lệ!");
  return value;
}
async function assignments() {
  const [rows, ctx] = await Promise.all([db.listWorkScheduleAssignments(), db.loadWorkScheduleContext()]);
  const summaries = new Map(ctx.schedules.map((s) => [s.id, w.summarizeSchedule(s)]));
  return rows.map((row) => ({
    ...row,
    targetLabel: w.describeTarget(row.targetType, row.targetValue, ctx),
    scheduleSummary: summaries.get(Number(row.scheduleId)) || "",
  }));
}
async function assign(user, body) {
  const allowed = ["schedule_id", "target_type", "target_value", "effective_from", "effective_to"];
  if (!body || typeof body !== "object" || Object.keys(body).some((k) => !allowed.includes(k)))
    throw new HttpError(400, "Dữ liệu áp dụng lịch có trường không hợp lệ!");
  const scheduleId = w.assertId(body.schedule_id, "Vui lòng chọn lịch làm việc!");
  if (!(await db.findWorkSchedule(scheduleId))) throw new HttpError(404, "Không tìm thấy lịch làm việc!");
  const targetValue = validateTarget(body.target_type, body.target_value);
  if (body.target_type !== "DEFAULT" && !(await db.workScheduleTargetExists(body.target_type, targetValue)))
    throw new HttpError(404, "Không tìm thấy trường/chương trình/mentor/thực tập sinh được chọn!");
  const effectiveFrom = requireDate(body.effective_from, "Ngày hiệu lực không hợp lệ!");
  const hasTo = body.effective_to != null && body.effective_to !== "";
  const effectiveTo = hasTo ? requireDate(body.effective_to, "Ngày kết thúc không hợp lệ!") : null;
  if (effectiveTo && effectiveTo < effectiveFrom) throw new HttpError(400, "Ngày kết thúc không được trước ngày hiệu lực!");
  let result;
  try {
    result = await db.createWorkScheduleAssignment(
      { scheduleId, targetType: body.target_type, targetValue, effectiveFrom, effectiveTo, createdBy: user?.id },
      (existing) => w.planAssignmentChange(existing, { effectiveFrom, effectiveTo }),
    );
  } catch (err) {
    if (err.code !== "ER_DUP_ENTRY") throw err;
    result = { conflict: true }; // hai yêu cầu cùng lúc gán cùng ngày hiệu lực
  }
  if (result.conflict)
    throw new HttpError(409, "Phạm vi này đã có lịch áp dụng trùng khoảng ngày. Hãy chọn ngày hiệu lực khác hoặc xóa lịch cũ trước!");
  return { id: result.id };
}
async function removeAssignment(rawId) {
  if (!(await db.deleteWorkScheduleAssignment(w.assertId(rawId))))
    throw new HttpError(404, "Không tìm thấy lần áp dụng lịch hoặc đây là lịch mặc định (không xóa được)!");
  return null;
}

// ---------- Ngày nghỉ chung ----------
async function holidays() {
  return db.listWorkHolidays();
}
async function addHoliday(body) {
  if (!body || typeof body !== "object" || Object.keys(body).some((k) => !["holiday_date", "name"].includes(k)))
    throw new HttpError(400, "Dữ liệu ngày nghỉ không hợp lệ!");
  const holidayDate = requireDate(body.holiday_date);
  const name = String(body.name || "").trim();
  if (!name || name.length > 255) throw new HttpError(400, "Tên ngày nghỉ phải từ 1 đến 255 ký tự!");
  try {
    return { id: await db.addWorkHoliday(holidayDate, name) };
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") throw new HttpError(409, "Ngày nghỉ này đã tồn tại!");
    throw err;
  }
}
async function removeHoliday(rawId) {
  if (!(await db.deleteWorkHoliday(w.assertId(rawId)))) throw new HttpError(404, "Không tìm thấy ngày nghỉ!");
  return null;
}

// ---------- Lịch của thực tập sinh ----------
async function mine(user) {
  const intern = await db.findInternProfileByEmail(user.email);
  if (!intern) throw new HttpError(404, "Tài khoản chưa có hồ sơ thực tập sinh!");
  const today = getVietnamToday();
  const resolved = await w.resolveScheduleForIntern(intern.id, today);
  const holidays = await db.listWorkHolidays();
  const holiday = holidays.find((h) => h.holidayDate === today) || null;
  return {
    ...resolved,
    schedule: withSummary(resolved.schedule),
    today: { date: today, rule: w.getDayRule(resolved.schedule, today), holiday: holiday && holiday.name },
  };
}
// Thực tập sinh đang hoặc sắp thực tập (có hợp đồng xác nhận chưa kết thúc) kèm lịch áp dụng.
async function loadActiveInterns() {
  const today = getVietnamToday();
  const interns = await db.getAllStudents();
  const contracts = await db.listConfirmedContractsForInterns(interns.map((i) => i.id));
  const active = [];
  for (const intern of interns) {
    const own = contracts.filter((c) => Number(c.internId) === Number(intern.id) && (!c.endDate || c.endDate >= today));
    if (!own.length) continue;
    const date = own.some((c) => w.contractCovers(c, today))
      ? today
      : own.map((c) => c.startDate).filter(Boolean).sort()[0] || today;
    active.push({ intern, date, contracts: own });
  }
  return { active, contracts, ctx: await db.loadWorkScheduleContext() };
}
async function resolved() {
  const { active, ctx } = await loadActiveInterns();
  return active.map(({ intern, date, contracts }) => {
    const found = w.resolveScheduleFromContext(ctx, intern, date, w.findContractProgram(contracts, date));
    return {
      intern: { id: intern.id, fullName: intern.fullName, studentCode: intern.studentCode, university: intern.university },
      date,
      schedule: found && { id: found.schedule.id, name: found.schedule.name, mode: found.schedule.mode, summary: w.summarizeSchedule(found.schedule) },
      source: found && found.source,
    };
  });
}
// Danh sách cho các ô chọn phạm vi (trường, chương trình, mentor, thực tập sinh).
async function options() {
  const [filters, mentors, interns] = await Promise.all([
    db.getFinalReportFilterOptions(),
    db.getAllMentors(),
    db.getAllStudents(),
  ]);
  return {
    universities: filters.universities.map((u) => (typeof u === "string" ? u : u.value)),
    programs: filters.programs.map((p) => ({ id: p.id, name: p.name })),
    mentors: mentors.map((m) => ({ id: m.id, name: m.fullName })),
    interns: interns.map((i) => ({ id: i.id, name: i.fullName, studentCode: i.studentCode })),
  };
}
async function preview(query = {}) {
  if (Object.keys(query).some((k) => !["target_type", "target_value"].includes(k)))
    throw new HttpError(400, "Tham số xem trước không hợp lệ!");
  const value = validateTarget(query.target_type, query.target_value);
  const { active, contracts, ctx } = await loadActiveInterns();
  const rank = (type) => w.PRIORITY.indexOf(type);
  const members = active.filter(({ intern }) => w.internMatchesTarget(intern, contracts, query.target_type, value));
  // "Bị ghi đè": thực tập sinh đang dùng lịch của phạm vi cụ thể hơn nên lần áp dụng này không có tác dụng với họ.
  const overridden = members.filter(({ intern, date, contracts: own }) => {
    const found = w.resolveScheduleFromContext(ctx, intern, date, w.findContractProgram(own, date));
    return found && rank(found.source.type) < rank(query.target_type);
  });
  return {
    count: members.length,
    overriddenCount: overridden.length,
    interns: members.map(({ intern }) => ({ id: intern.id, fullName: intern.fullName, studentCode: intern.studentCode })),
  };
}

module.exports = {
  list, get, create, update, remove,
  assignments, assign, removeAssignment,
  holidays, addHoliday, removeHoliday,
  mine, resolved, preview, options,
};
