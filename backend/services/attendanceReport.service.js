// Báo cáo chuyên cần (HR): tổng hợp đi làm, nghỉ phép, vắng, đi muộn theo lịch làm việc áp dụng.
// Dữ liệu được tải theo lô (không truy vấn theo từng ngày/từng người); phần tính toán là hàm thuần.
const db = require("../db");
const { HttpError } = require("../errors");
const weeks = require("../utils/weeks");
const { getVietnamToday } = require("../utils/date");
const w = require("./scheduleRules.service");
const { csvCell } = require("./finalReports.service");

const SCOPE_TYPES = ["ALL", "UNIVERSITY", "PROGRAM", "MENTOR"];
const GROUP_BY = ["NONE", "PROGRAM", "UNIVERSITY", "MENTOR"];
const MAX_RANGE_DAYS = 366;
const REQUIRED_STATUSES = ["PRESENT", "LEAVE", "ABSENT", "ABSENT_PENDING_LEAVE"];
const NOT_COUNTED = ["OUT_OF_CONTRACT", "UPCOMING"];

function dayDiff(from, to) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}
function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = w.addDays(d, 1)) out.push(d);
  return out;
}
// Tỷ lệ chuyên cần = có mặt / (ngày phải đi làm - nghỉ có phép); null nếu mẫu số bằng 0.
function attendanceRate(present, required, leave) {
  const base = required - leave;
  return base > 0 ? Number(((present * 100) / base).toFixed(1)) : null;
}

function validate(query = {}) {
  const allowed = ["from", "to", "scope_type", "scope_value", "intern_id", "group_by"];
  if (Object.keys(query).some((k) => !allowed.includes(k))) throw new HttpError(400, "Tham số báo cáo không hợp lệ!");
  const today = getVietnamToday();
  const from = query.from || `${today.slice(0, 8)}01`;
  const to = query.to || today;
  if (!weeks.isValidDate(from) || !weeks.isValidDate(to)) throw new HttpError(400, "Ngày báo cáo không hợp lệ!");
  if (from > to) throw new HttpError(400, "Ngày bắt đầu không được sau ngày kết thúc!");
  if (dayDiff(from, to) + 1 > MAX_RANGE_DAYS) throw new HttpError(400, `Khoảng ngày báo cáo tối đa ${MAX_RANGE_DAYS} ngày!`);
  const scopeType = query.scope_type || "ALL";
  if (!SCOPE_TYPES.includes(scopeType)) throw new HttpError(400, "Phạm vi báo cáo không hợp lệ!");
  let scopeValue = "";
  if (scopeType !== "ALL") {
    scopeValue = String(query.scope_value ?? "").trim();
    if (!scopeValue) throw new HttpError(400, "Vui lòng chọn giá trị phạm vi!");
    if (scopeType === "UNIVERSITY" && scopeValue.length > 255) throw new HttpError(400, "Tên trường quá dài!");
    if (scopeType !== "UNIVERSITY" && !/^[1-9]\d*$/.test(scopeValue)) throw new HttpError(400, "Giá trị phạm vi không hợp lệ!");
  }
  let internId = null;
  if (query.intern_id != null && query.intern_id !== "") {
    if (!/^[1-9]\d*$/.test(String(query.intern_id))) throw new HttpError(400, "ID thực tập sinh không hợp lệ!");
    internId = Number(query.intern_id);
  }
  const groupBy = query.group_by || "NONE";
  if (!GROUP_BY.includes(groupBy)) throw new HttpError(400, "Cách nhóm báo cáo không hợp lệ!");
  return { from, to, scopeType, scopeValue, internId, groupBy };
}

// Trạng thái của một ngày (xem bảng quy tắc trong tài liệu US7).
function classifyAttendanceDay({ date, today, inContract, isHoliday, dayRule, record, leave }) {
  if (date > today) return { status: "UPCOMING", flags: [] };
  if (!inContract) return { status: "OUT_OF_CONTRACT", flags: [] };
  if (isHoliday) return { status: "HOLIDAY", flags: [] };
  if (!dayRule.isWorkingDay) return { status: "DAY_OFF", flags: [] };
  if (record) {
    const evaluated = w.evaluateAttendance(dayRule, record);
    // Hôm nay chưa check-out là bình thường (còn đang làm việc), chỉ ngày đã qua mới là "thiếu check-out".
    const flags = date === today ? evaluated.filter((f) => f !== "MISSING_CHECKOUT") : [...evaluated];
    if (record.isAdjusted) flags.push("ADJUSTED");
    if (leave?.status === "APPROVED") flags.push("WORKED_DURING_LEAVE");
    return { status: "PRESENT", flags };
  }
  if (leave?.status === "APPROVED") return { status: "LEAVE", flags: [] };
  if (leave?.status === "PENDING") return { status: "ABSENT_PENDING_LEAVE", flags: [] };
  return { status: "ABSENT", flags: [] };
}

// Tính chuyên cần của một thực tập sinh trong khoảng ngày (hàm thuần).
function computeInternAttendance({ intern, contracts, records, leaves, ctx, holidays, from, to, today }) {
  const recordByDate = new Map(records.map((r) => [r.workDate, r]));
  const days = [];
  let lastSchedule = null;
  for (const date of dateRange(from, to)) {
    const inContract = contracts.some((c) => w.contractCovers(c, date));
    let dayRule = { isWorkingDay: false };
    let schedule = null;
    if (inContract) {
      const found = w.resolveScheduleFromContext(ctx, intern, date, w.findContractProgram(contracts, date));
      if (found) {
        dayRule = w.getDayRule(found.schedule, date);
        schedule = {
          id: found.schedule.id,
          name: found.schedule.name,
          mode: found.schedule.mode,
          startTime: dayRule.startTime,
          endTime: dayRule.endTime,
          sourceLabel: found.source.label,
        };
        if (date <= today) lastSchedule = schedule;
      }
    }
    const record = recordByDate.get(date) || null;
    const covering = leaves.filter((l) => l.fromDate <= date && l.toDate >= date);
    const leave = covering.find((l) => l.status === "APPROVED") || covering.find((l) => l.status === "PENDING") || null;
    const result = classifyAttendanceDay({
      date, today, inContract, isHoliday: holidays.has(date), dayRule, record, leave,
    });
    days.push({
      date,
      ...result,
      schedule,
      record: record && { checkInAt: record.checkInAt, checkOutAt: record.checkOutAt, durationMinutes: record.durationMinutes },
      leave: leave && { id: leave.id, status: leave.status, leaveType: leave.leaveType },
    });
  }
  const count = (status) => days.filter((d) => d.status === status).length;
  const flagCount = (flag) => days.filter((d) => d.flags.includes(flag)).length;
  const requiredDays = days.filter((d) => REQUIRED_STATUSES.includes(d.status)).length;
  const presentDays = count("PRESENT");
  const leaveDays = count("LEAVE");
  const overlapping = contracts
    .filter((c) => (!c.startDate || c.startDate <= to) && (!c.endDate || c.endDate >= from))
    .sort((a, b) => String(b.confirmedAt || "").localeCompare(String(a.confirmedAt || "")) || b.id - a.id);
  const program = overlapping[0] && (ctx.programs || []).find((p) => Number(p.id) === Number(overlapping[0].programId));
  const mentor = intern.mentorId == null ? null : (ctx.mentors || []).find((m) => Number(m.id) === Number(intern.mentorId));
  return {
    intern: {
      id: intern.id,
      fullName: intern.fullName,
      studentCode: intern.studentCode,
      university: intern.university,
      mentorId: intern.mentorId ?? null,
      mentorName: mentor ? mentor.name : intern.mentorName || null,
      programName: program ? program.name : null,
    },
    scheduleName: lastSchedule && lastSchedule.name,
    scheduleSource: lastSchedule && lastSchedule.sourceLabel,
    requiredDays,
    presentDays,
    leaveDays,
    absentDays: count("ABSENT"),
    pendingLeaveDays: count("ABSENT_PENDING_LEAVE"),
    lateCount: flagCount("LATE"),
    earlyLeaveCount: flagCount("EARLY_LEAVE"),
    shortHoursCount: flagCount("SHORT_HOURS"),
    missingCheckoutCount: flagCount("MISSING_CHECKOUT"),
    offScheduleDays: days.filter((d) => ["HOLIDAY", "DAY_OFF"].includes(d.status) && d.record).length,
    totalWorkMinutes: records.reduce((sum, r) => sum + Number(r.durationMinutes || 0), 0),
    attendanceRate: attendanceRate(presentDays, requiredDays, leaveDays),
    hasActivity: days.some((d) => !NOT_COUNTED.includes(d.status)),
    days,
  };
}

const SUM_FIELDS = [
  "requiredDays", "presentDays", "leaveDays", "absentDays", "pendingLeaveDays",
  "lateCount", "earlyLeaveCount", "shortHoursCount", "missingCheckoutCount", "totalWorkMinutes",
];
function sumReports(reports) {
  const total = { totalInterns: reports.length };
  for (const field of SUM_FIELDS) total[field] = reports.reduce((n, r) => n + r[field], 0);
  total.attendanceRate = attendanceRate(total.presentDays, total.requiredDays, total.leaveDays);
  return total;
}
function groupKey(report, groupBy) {
  if (groupBy === "PROGRAM") return report.intern.programName || "Chưa gán chương trình";
  if (groupBy === "UNIVERSITY") return report.intern.university || "Không rõ trường";
  return report.intern.mentorName || "Chưa phân công mentor";
}
function groupReports(reports, groupBy) {
  if (groupBy === "NONE") return [];
  const groups = new Map();
  for (const report of reports) {
    const key = groupKey(report, groupBy);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(report);
  }
  return [...groups.entries()]
    .map(([name, items]) => ({ name, ...sumReports(items) }))
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

// Tải dữ liệu theo lô và tính báo cáo cho các thực tập sinh thuộc phạm vi.
async function computeReports(range, { onlyIntern = null } = {}) {
  const today = getVietnamToday();
  let interns = onlyIntern ? [onlyIntern] : await db.getAllStudents();
  if (range.internId) interns = interns.filter((i) => Number(i.id) === range.internId);
  if (range.scopeType === "UNIVERSITY") interns = interns.filter((i) => i.university === range.scopeValue);
  if (range.scopeType === "MENTOR") interns = interns.filter((i) => String(i.mentorId) === range.scopeValue);
  const contracts = await db.listConfirmedContractsForInterns(interns.map((i) => i.id));
  const contractsOf = (id) => contracts.filter((c) => Number(c.internId) === Number(id));
  if (range.scopeType === "PROGRAM") {
    interns = interns.filter((i) =>
      contractsOf(i.id).some(
        (c) => String(c.programId) === range.scopeValue &&
          (!c.startDate || c.startDate <= range.to) && (!c.endDate || c.endDate >= range.from),
      ),
    );
  }
  const ids = interns.map((i) => i.id);
  const [records, leaves, ctx, holidayRows] = await Promise.all([
    db.listAttendanceForInterns(ids, range.from, range.to),
    db.listLeavesForInterns(ids, range.from, range.to),
    db.loadWorkScheduleContext(),
    db.listWorkHolidays(),
  ]);
  const holidays = new Set(holidayRows.map((h) => h.holidayDate));
  return interns
    .map((intern) =>
      computeInternAttendance({
        intern,
        contracts: contractsOf(intern.id),
        records: records.filter((r) => Number(r.internId) === Number(intern.id)),
        leaves: leaves.filter((l) => Number(l.internId) === Number(intern.id)),
        ctx, holidays, from: range.from, to: range.to, today,
      }),
    )
    .sort((a, b) => a.intern.fullName.localeCompare(b.intern.fullName, "vi"));
}
function stripDays({ days, hasActivity, ...rest }) {
  return rest;
}

async function report(query) {
  const range = validate(query);
  const reports = (await computeReports(range)).filter((r) => r.hasActivity);
  const pendingLeaveRequests = (await db.listPendingLeaves(null)).length;
  return {
    range: { from: range.from, to: range.to },
    scope: { type: range.scopeType, value: range.scopeValue },
    summary: { ...sumReports(reports), pendingLeaveRequests },
    groups: groupReports(reports, range.groupBy),
    interns: reports.map(stripDays),
  };
}
async function detail(rawId, query) {
  if (!/^[1-9]\d*$/.test(String(rawId))) throw new HttpError(400, "ID thực tập sinh không hợp lệ!");
  const range = validate({ from: query?.from, to: query?.to });
  const intern = await db.findInternProfileById(Number(rawId));
  if (!intern) throw new HttpError(404, "Không tìm thấy thực tập sinh!");
  const [result] = await computeReports(range, { onlyIntern: intern });
  const { hasActivity, ...rest } = result;
  return rest;
}
async function exportCsv(query) {
  const range = validate(query);
  const reports = (await computeReports(range)).filter((r) => r.hasActivity);
  const header = [
    "Họ tên", "Mã sinh viên", "Trường", "Chương trình", "Mentor", "Lịch áp dụng",
    "Ngày phải đi làm", "Có mặt", "Nghỉ phép", "Vắng không phép", "Chờ duyệt nghỉ",
    "Đi muộn", "Về sớm", "Thiếu giờ", "Thiếu check-out", "Làm ngoài lịch",
    "Tổng giờ làm", "Tỷ lệ chuyên cần (%)",
  ];
  const rows = reports.map((r) => [
    r.intern.fullName, r.intern.studentCode, r.intern.university, r.intern.programName, r.intern.mentorName,
    r.scheduleSource ? `${r.scheduleName} (${r.scheduleSource})` : "",
    r.requiredDays, r.presentDays, r.leaveDays, r.absentDays, r.pendingLeaveDays,
    r.lateCount, r.earlyLeaveCount, r.shortHoursCount, r.missingCheckoutCount, r.offScheduleDays,
    (r.totalWorkMinutes / 60).toFixed(1), r.attendanceRate == null ? "" : r.attendanceRate,
  ]);
  return {
    filename: `bao-cao-chuyen-can_${range.from}_${range.to}.csv`,
    content: [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n"),
  };
}

module.exports = {
  validate, classifyAttendanceDay, computeInternAttendance, sumReports, groupReports, attendanceRate,
  report, detail, exportCsv,
};
