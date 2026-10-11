// Unit test (không cần DB): lịch làm việc, tính lịch áp dụng, kế hoạch gán lịch, đánh giá chấm công.
const assert = require("assert");
const w = require("../services/scheduleRules.service");
const { classifyAttendanceDay, attendanceRate } = require("../services/attendanceReport.service");

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${name}\n`, err.message);
    process.exitCode = 1;
  }
}
const throwsStatus = (fn, status) => assert.throws(fn, (e) => e.status === status);

const days = Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, is_working: i < 5, start_time: "08:30", end_time: "17:30" }));
const fixed = w.validateSchedule({ name: "Cố định", mode: "FIXED", grace_minutes: 15, days });
const flexible = w.validateSchedule({
  name: "Linh hoạt", mode: "FLEXIBLE", min_daily_minutes: 240,
  days: days.map((d) => ({ weekday: d.weekday, is_working: d.is_working })),
});

// ---------- validateSchedule ----------
check("validateSchedule: lịch hợp lệ", () => {
  assert.equal(fixed.days.length, 7);
  assert.equal(fixed.graceMinutes, 15);
  assert.equal(flexible.minDailyMinutes, 240);
});
check("validateSchedule: từ chối dữ liệu sai", () => {
  throwsStatus(() => w.validateSchedule({ name: "x", mode: "FIXED", days, extra: 1 }), 400);
  throwsStatus(() => w.validateSchedule({ name: "", mode: "FIXED", days }), 400);
  throwsStatus(() => w.validateSchedule({ name: "x", mode: "KHAC", days }), 400);
  throwsStatus(() => w.validateSchedule({ name: "x", mode: "FIXED", days: days.slice(0, 6) }), 400);
  throwsStatus(() => w.validateSchedule({ name: "x", mode: "FIXED", grace_minutes: 121, days }), 400);
  throwsStatus(() => w.validateSchedule({ name: "x", mode: "FIXED", days: days.map((d) => ({ ...d, is_working: false })) }), 400);
  throwsStatus(() => w.validateSchedule({ name: "x", mode: "FIXED", days: days.map((d) => ({ ...d, end_time: "08:00" })) }), 400);
  throwsStatus(() => w.validateSchedule({ name: "x", mode: "FLEXIBLE", days: days.map((d) => ({ weekday: d.weekday, is_working: true })) }), 400);
  throwsStatus(() => w.validateSchedule({ name: "x", mode: "FLEXIBLE", min_daily_minutes: 10, days: days.map((d) => ({ weekday: d.weekday, is_working: true })) }), 400);
  throwsStatus(() => w.validateSchedule({ name: "x", mode: "FIXED", days: [...days.slice(0, 6), { ...days[0] }] }), 400);
});
check("assertScheduleConsistent: bắt lịch FIXED thiếu giờ khi cập nhật từng phần", () => {
  const merged = { mode: "FIXED", days: flexible.days.map((d) => ({ ...d })) }; // FLEXIBLE -> FIXED không có giờ
  throwsStatus(() => w.assertScheduleConsistent(merged), 400);
});

// ---------- summarizeSchedule ----------
check("summarizeSchedule", () => {
  assert.equal(w.summarizeSchedule(fixed), "T2–T6 08:30–17:30");
  assert.equal(w.summarizeSchedule(flexible), "T2–T6 · linh hoạt, tối thiểu 240 phút/ngày");
  const split = { ...fixed, days: fixed.days.map((d) => (d.weekday === 3 ? { ...d, isWorking: false } : d)) };
  assert.equal(w.summarizeSchedule(split), "T2–T3, T5–T6 08:30–17:30"); // bỏ thứ 4
  const single = { ...fixed, days: fixed.days.map((d) => ({ ...d, isWorking: d.weekday === 2 })) };
  assert.equal(w.summarizeSchedule(single), "T3 08:30–17:30");
});

// ---------- getDayRule ----------
check("getDayRule: thứ trong tuần", () => {
  assert.equal(w.getDayRule(fixed, "2026-10-12").isWorkingDay, true); // Thứ 2
  assert.equal(w.getDayRule(fixed, "2026-10-17").isWorkingDay, false); // Thứ 7
  assert.equal(w.getDayRule(fixed, "2026-10-18").isWorkingDay, false); // Chủ nhật
  assert.equal(w.getDayRule(flexible, "2026-10-12").minDailyMinutes, 240);
});

// ---------- evaluateAttendance ----------
check("evaluateAttendance: biên dung sai (FIXED, 08:30-17:30, dung sai 15)", () => {
  const rule = w.getDayRule(fixed, "2026-10-12");
  const flags = (inAt, outAt) => w.evaluateAttendance(rule, { checkInAt: `2026-10-12 ${inAt}`, checkOutAt: outAt && `2026-10-12 ${outAt}` });
  assert.deepEqual(flags("08:45:00", "17:15:00"), []);
  assert.deepEqual(flags("08:46:00", "17:15:00"), ["LATE"]);
  assert.deepEqual(flags("08:30:00", "17:14:00"), ["EARLY_LEAVE"]);
  assert.deepEqual(flags("08:46:00", "17:00:00"), ["LATE", "EARLY_LEAVE"]);
  assert.deepEqual(flags("08:46:00", null), ["MISSING_CHECKOUT"]);
});
check("evaluateAttendance: FLEXIBLE thiếu giờ", () => {
  const rule = w.getDayRule(flexible, "2026-10-12");
  const at = (inAt, outAt, minutes) => w.evaluateAttendance(rule, { checkInAt: `2026-10-12 ${inAt}`, checkOutAt: `2026-10-12 ${outAt}`, durationMinutes: minutes });
  assert.deepEqual(at("09:00:00", "12:59:00", 239), ["SHORT_HOURS"]);
  assert.deepEqual(at("09:00:00", "13:00:00", 240), []);
  assert.deepEqual(w.evaluateAttendance(rule, { checkInAt: "2026-10-12 09:00:00", checkOutAt: "2026-10-12 11:00:00" }), ["SHORT_HOURS"]);
});

// ---------- hợp đồng ----------
check("contractCovers: ngày bắt đầu/kết thúc để trống", () => {
  assert.equal(w.contractCovers({ startDate: null, endDate: null }, "2026-10-12"), true);
  assert.equal(w.contractCovers({ startDate: "2026-10-13", endDate: null }, "2026-10-12"), false);
  assert.equal(w.contractCovers({ startDate: null, endDate: "2026-10-11" }, "2026-10-12"), false);
  assert.equal(w.contractCovers({ startDate: "2026-10-12", endDate: "2026-10-12" }, "2026-10-12"), true);
});
check("findContractProgram: lấy hợp đồng xác nhận gần nhất", () => {
  const contracts = [
    { id: 1, programId: 3, confirmedAt: "2026-01-01 00:00:00", startDate: null, endDate: null },
    { id: 2, programId: 4, confirmedAt: "2026-06-01 00:00:00", startDate: "2026-09-01", endDate: "2026-12-31" },
  ];
  assert.equal(w.findContractProgram(contracts, "2026-10-12"), 4);
  assert.equal(w.findContractProgram(contracts, "2026-08-01"), 3);
  assert.equal(w.findContractProgram([{ id: 1, programId: null, startDate: null, endDate: null }], "2026-10-12"), null);
  assert.equal(w.findContractProgram([{ id: 1, programId: 3, startDate: "2027-01-01", endDate: null }], "2026-10-12"), null);
});

// ---------- lịch áp dụng ----------
const sched = (id) => ({ id, name: `Lịch ${id}`, mode: "FIXED", graceMinutes: 15, days: fixed.days });
const ctx = {
  schedules: [sched(1), sched(2), sched(3), sched(4), sched(5), sched(6)],
  programs: [{ id: 3, name: "Hè 2026" }],
  mentors: [{ id: 5, name: "Mentor Năm" }],
  assignments: [
    { id: 1, scheduleId: 1, targetType: "DEFAULT", targetValue: "", effectiveFrom: "1970-01-01", effectiveTo: null },
    { id: 2, scheduleId: 2, targetType: "UNIVERSITY", targetValue: "ĐH X", effectiveFrom: "2026-01-01", effectiveTo: null },
    { id: 3, scheduleId: 3, targetType: "MENTOR", targetValue: "5", effectiveFrom: "2026-01-01", effectiveTo: null },
    { id: 4, scheduleId: 4, targetType: "PROGRAM", targetValue: "3", effectiveFrom: "2026-01-01", effectiveTo: "2026-10-31" },
    { id: 5, scheduleId: 5, targetType: "INTERN", targetValue: "1", effectiveFrom: "2026-10-20", effectiveTo: null },
    { id: 6, scheduleId: 6, targetType: "PROGRAM", targetValue: "3", effectiveFrom: "2026-11-01", effectiveTo: null },
  ],
};
const intern = { id: 1, university: "ĐH X", mentorId: 5 };
const pick = (date, programId = 3, who = intern) => w.resolveScheduleFromContext(ctx, who, date, programId);
check("resolveScheduleFromContext: độ ưu tiên cá nhân > chương trình > mentor > trường > mặc định", () => {
  assert.equal(pick("2026-10-12").schedule.id, 4); // chương trình
  assert.equal(pick("2026-10-12", null).schedule.id, 3); // không có chương trình -> mentor
  assert.equal(pick("2026-10-12", null, { ...intern, mentorId: null }).schedule.id, 2); // -> trường
  assert.equal(pick("2026-10-12", null, { id: 9, university: "ĐH Z", mentorId: null }).schedule.id, 1); // -> mặc định
  assert.equal(pick("2026-10-25").schedule.id, 5); // cá nhân thắng
});
check("resolveScheduleFromContext: hiệu lực theo ngày và nhãn nguồn", () => {
  assert.equal(pick("2026-10-31", 3, { ...intern, id: 7 }).schedule.id, 4);
  assert.equal(pick("2026-11-01", 3, { ...intern, id: 7 }).schedule.id, 6);
  assert.equal(pick("2026-10-12").source.label, "Chương trình: Hè 2026");
  assert.equal(pick("2026-10-12", null).source.label, "Nhóm mentor: Mentor Năm");
  assert.equal(pick("2026-10-12", null, { id: 9, university: "ĐH X", mentorId: null }).source.label, "Trường: ĐH X");
});
check("resolveScheduleFromContext: lịch mặc định là phương án cuối", () => {
  const noAssign = { ...ctx, assignments: [] };
  assert.equal(w.resolveScheduleFromContext(noAssign, intern, "2026-10-12", 3).schedule.id, 1);
  assert.equal(w.resolveScheduleFromContext({ ...noAssign, schedules: [] }, intern, "2026-10-12", 3), null);
});
check("internMatchesTarget", () => {
  const contracts = [{ internId: 1, programId: 3 }];
  assert.equal(w.internMatchesTarget(intern, contracts, "DEFAULT", ""), true);
  assert.equal(w.internMatchesTarget(intern, contracts, "UNIVERSITY", "ĐH X"), true);
  assert.equal(w.internMatchesTarget(intern, contracts, "UNIVERSITY", "ĐH Y"), false);
  assert.equal(w.internMatchesTarget(intern, contracts, "MENTOR", "5"), true);
  assert.equal(w.internMatchesTarget(intern, contracts, "PROGRAM", "3"), true);
  assert.equal(w.internMatchesTarget(intern, contracts, "PROGRAM", "4"), false);
  assert.equal(w.internMatchesTarget(intern, contracts, "INTERN", "1"), true);
});

// ---------- kế hoạch gán lịch ----------
check("planAssignmentChange: tự đóng lần đang mở và phát hiện trùng", () => {
  const open = { id: 1, effectiveFrom: "2026-01-01", effectiveTo: null };
  assert.deepEqual(w.planAssignmentChange([open], { effectiveFrom: "2026-11-01", effectiveTo: null }), {
    conflict: false, close: [{ id: 1, effectiveTo: "2026-10-31" }],
  });
  assert.deepEqual(w.planAssignmentChange([], { effectiveFrom: "2026-11-01", effectiveTo: null }), { conflict: false, close: [] });
  // cùng ngày bắt đầu với lần đang mở -> trùng
  assert.equal(w.planAssignmentChange([open], { effectiveFrom: "2026-01-01", effectiveTo: null }).conflict, true);
  // lần đã đóng chồng với khoảng mới
  const closed = { id: 2, effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" };
  assert.equal(w.planAssignmentChange([closed], { effectiveFrom: "2026-06-01", effectiveTo: "2026-12-31" }).conflict, true);
  assert.equal(w.planAssignmentChange([closed], { effectiveFrom: "2026-07-01", effectiveTo: null }).conflict, false);
  // lần tương lai: khoảng mới phải kết thúc trước nó
  const future = { id: 3, effectiveFrom: "2026-12-01", effectiveTo: null };
  assert.equal(w.planAssignmentChange([future], { effectiveFrom: "2026-10-01", effectiveTo: null }).conflict, true);
  assert.equal(w.planAssignmentChange([future], { effectiveFrom: "2026-10-01", effectiveTo: "2026-11-30" }).conflict, false);
});

// ---------- phân loại ngày & tỷ lệ ----------
check("classifyAttendanceDay: đủ các trạng thái", () => {
  const rule = w.getDayRule(fixed, "2026-10-12");
  const base = { date: "2026-10-12", today: "2026-10-12", inContract: true, isHoliday: false, dayRule: rule, record: null, leave: null };
  const status = (o) => classifyAttendanceDay({ ...base, ...o }).status;
  assert.equal(status({}), "ABSENT");
  assert.equal(status({ leave: { status: "APPROVED" } }), "LEAVE");
  assert.equal(status({ leave: { status: "PENDING" } }), "ABSENT_PENDING_LEAVE");
  assert.equal(status({ isHoliday: true }), "HOLIDAY");
  assert.equal(status({ inContract: false }), "OUT_OF_CONTRACT");
  assert.equal(status({ date: "2026-10-13" }), "UPCOMING");
  assert.equal(status({ date: "2026-10-17", dayRule: w.getDayRule(fixed, "2026-10-17"), today: "2026-10-20" }), "DAY_OFF");
  const present = classifyAttendanceDay({ ...base, record: { checkInAt: "2026-10-12 09:00:00", checkOutAt: "2026-10-12 17:30:00" }, leave: { status: "APPROVED" } });
  assert.equal(present.status, "PRESENT");
  assert.deepEqual(present.flags, ["LATE", "WORKED_DURING_LEAVE"]);
});
check("classifyAttendanceDay: hôm nay chưa check-out không bị tính thiếu check-out, ngày đã qua thì có", () => {
  const rule = w.getDayRule(fixed, "2026-10-12");
  const open = { checkInAt: "2026-10-12 08:30:00", checkOutAt: null };
  const base = { date: "2026-10-12", inContract: true, isHoliday: false, dayRule: rule, record: open, leave: null };
  assert.deepEqual(classifyAttendanceDay({ ...base, today: "2026-10-12" }), { status: "PRESENT", flags: [] });
  assert.deepEqual(classifyAttendanceDay({ ...base, today: "2026-10-13" }), { status: "PRESENT", flags: ["MISSING_CHECKOUT"] });
});
check("attendanceRate", () => {
  assert.equal(attendanceRate(2, 4, 1), 66.7);
  assert.equal(attendanceRate(0, 3, 3), null);
  assert.equal(attendanceRate(5, 5, 0), 100);
});

if (!process.exitCode) console.log(`[PASS] work schedule unit checks (${passed})`);
