// Test mức service (không cần MySQL): thay các hàm DB bằng dữ liệu giả để kiểm tra
// báo cáo chuyên cần, nghỉ phép và quản lý lịch làm việc.
const assert = require("assert");
const db = require("../db");
const w = require("../services/scheduleRules.service");
const { addDays } = w;
const { getVietnamToday } = require("../utils/date");
const report = require("../services/attendanceReport.service");
const leaves = require("../services/leaves.service");
const schedules = require("../services/workSchedules.service");

const calls = [];
const original = { ...db };
function useDb(fakes) {
  Object.assign(db, original, fakes);
}
const throwsStatus = async (promise, status, label) => {
  try {
    await promise;
  } catch (e) {
    assert.equal(e.status, status, `${label}: mã lỗi ${e.status} (${e.message})`);
    return;
  }
  assert.fail(`${label}: phải bị từ chối`);
};

// ---------- Dữ liệu giả ----------
const days = Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, is_working: i < 5, start_time: "08:30", end_time: "17:30" }));
const fixed = { id: 1, ...w.validateSchedule({ name: "Mặc định", mode: "FIXED", grace_minutes: 15, days }) };
const flexible = { id: 2, ...w.validateSchedule({ name: "Linh hoạt", mode: "FLEXIBLE", min_daily_minutes: 240, days: days.map((d) => ({ weekday: d.weekday, is_working: d.is_working })) }) };
const ctx = {
  schedules: [fixed, flexible],
  assignments: [
    { id: 1, scheduleId: 1, targetType: "DEFAULT", targetValue: "", effectiveFrom: "1970-01-01", effectiveTo: null },
    { id: 2, scheduleId: 2, targetType: "PROGRAM", targetValue: "4", effectiveFrom: "2026-01-01", effectiveTo: null },
  ],
  programs: [{ id: 3, name: "Hè 2026" }, { id: 4, name: "Thu 2026" }],
  mentors: [{ id: 5, name: "Mentor Năm" }, { id: 6, name: "Mentor Sáu" }],
};
const internA = { id: 1, fullName: "An", studentCode: "SV1", university: "ĐH X", mentorId: 5 };
const internB = { id: 2, fullName: "Bình", studentCode: "SV2", university: "ĐH Y", mentorId: 6 };
const contracts = [
  { id: 1, internId: 1, programId: 3, startDate: "2026-09-01", endDate: "2026-12-31", confirmedAt: "2026-08-20 00:00:00" },
  { id: 2, internId: 2, programId: 4, startDate: null, endDate: "2026-09-09", confirmedAt: "2026-08-21 00:00:00" }, // thiếu ngày bắt đầu
];
const rec = (internId, date, inAt, outAt, minutes) => ({
  internId, workDate: date, checkInAt: `${date} ${inAt}`, checkOutAt: outAt && `${date} ${outAt}`, durationMinutes: minutes, isAdjusted: 0,
});
// Tuần 07/09/2026 (Thứ 2) - 13/09/2026 (Chủ nhật), đều đã qua so với thời điểm chạy test.
const records = [
  rec(1, "2026-09-07", "08:20:00", "17:40:00", 560),
  rec(1, "2026-09-08", "08:50:00", "17:30:00", 520),
  rec(1, "2026-09-12", "09:00:00", "12:00:00", 180), // làm ngoài lịch (thứ 7)
  rec(2, "2026-09-07", "09:00:00", "11:00:00", 120),
];
const leaveRows = [
  { id: 10, internId: 1, status: "APPROVED", leaveType: "SICK", fromDate: "2026-09-10", toDate: "2026-09-10" },
  { id: 11, internId: 1, status: "PENDING", leaveType: "PERSONAL", fromDate: "2026-09-11", toDate: "2026-09-11" },
];
const inRange = (d, from, to) => d >= from && d <= to;
const reportDb = {
  getAllStudents: async () => [internA, internB],
  findInternProfileById: async (id) => [internA, internB].find((i) => i.id === id) || null,
  listConfirmedContractsForInterns: async (ids) => contracts.filter((c) => ids.includes(c.internId)),
  listAttendanceForInterns: async (ids, from, to) => records.filter((r) => ids.includes(r.internId) && inRange(r.workDate, from, to)),
  listLeavesForInterns: async (ids) => leaveRows.filter((l) => ids.includes(l.internId)),
  loadWorkScheduleContext: async () => ctx,
  listWorkHolidays: async () => [{ id: 1, holidayDate: "2026-09-09", name: "Nghỉ lễ" }],
  listPendingLeaves: async () => [{ id: 11 }],
};
const Q = { from: "2026-09-07", to: "2026-09-13" };

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------- Báo cáo chuyên cần ----------
test("report: số liệu từng người và tổng hợp", async () => {
  useDb(reportDb);
  const r = await report.report(Q);
  const a = r.interns.find((x) => x.intern.id === 1);
  const b = r.interns.find((x) => x.intern.id === 2);
  assert.deepEqual([a.requiredDays, a.presentDays, a.leaveDays, a.absentDays, a.pendingLeaveDays], [4, 2, 1, 0, 1]);
  assert.deepEqual([a.lateCount, a.earlyLeaveCount, a.offScheduleDays], [1, 0, 1]);
  assert.equal(a.attendanceRate, 66.7);
  assert.equal(a.totalWorkMinutes, 560 + 520 + 180);
  assert.equal(a.intern.programName, "Hè 2026");
  assert.equal(a.intern.mentorName, "Mentor Năm");
  assert.equal(a.scheduleName, "Mặc định");
  // Bình: hợp đồng thiếu ngày bắt đầu, kết thúc 09/09; lịch linh hoạt (chương trình 4); 09/09 là ngày lễ
  assert.deepEqual([b.requiredDays, b.presentDays, b.absentDays, b.shortHoursCount], [2, 1, 1, 1]);
  assert.equal(b.attendanceRate, 50);
  assert.equal(b.scheduleName, "Linh hoạt");
  assert.equal(r.summary.totalInterns, 2);
  assert.equal(r.summary.requiredDays, 6);
  assert.equal(r.summary.attendanceRate, 60);
  assert.equal(r.summary.pendingLeaveRequests, 1);
  assert.deepEqual(r.groups, []);
  assert.ok(!("days" in a), "danh sách không kèm chi tiết từng ngày");
});
test("report: lọc theo phạm vi và thực tập sinh", async () => {
  useDb(reportDb);
  const names = async (extra) => (await report.report({ ...Q, ...extra })).interns.map((x) => x.intern.fullName);
  assert.deepEqual(await names({ scope_type: "UNIVERSITY", scope_value: "ĐH Y" }), ["Bình"]);
  assert.deepEqual(await names({ scope_type: "MENTOR", scope_value: "5" }), ["An"]);
  assert.deepEqual(await names({ scope_type: "PROGRAM", scope_value: "4" }), ["Bình"]);
  assert.deepEqual(await names({ scope_type: "PROGRAM", scope_value: "99" }), []);
  assert.deepEqual(await names({ intern_id: "1" }), ["An"]);
});
test("report: nhóm theo chương trình / trường / mentor", async () => {
  useDb(reportDb);
  const byProgram = (await report.report({ ...Q, group_by: "PROGRAM" })).groups;
  assert.deepEqual(byProgram.map((g) => [g.name, g.totalInterns, g.presentDays]), [["Hè 2026", 1, 2], ["Thu 2026", 1, 1]]);
  const byUni = (await report.report({ ...Q, group_by: "UNIVERSITY" })).groups;
  assert.deepEqual(byUni.map((g) => g.name), ["ĐH X", "ĐH Y"]);
  assert.equal((await report.report({ ...Q, group_by: "MENTOR" })).groups.length, 2);
});
test("report: bỏ qua người không có ngày nào trong khoảng", async () => {
  useDb(reportDb);
  const r = await report.report({ from: "2026-07-01", to: "2026-07-31" }); // trước hợp đồng của An, Bình vẫn trong hợp đồng
  assert.deepEqual(r.interns.map((x) => x.intern.fullName), ["Bình"]);
});
test("report: kiểm tra tham số", async () => {
  useDb(reportDb);
  for (const bad of [
    { intern_id: "abc" }, { from: "2026-09-10", to: "2026-09-01" }, { from: "x" }, { scope_type: "KHAC" },
    { scope_type: "PROGRAM" }, { scope_type: "PROGRAM", scope_value: "abc" }, { group_by: "KHAC" },
    { foo: "bar" }, { from: "2025-01-01", to: "2026-12-31" },
  ]) await throwsStatus(report.report(bad), 400, JSON.stringify(bad));
});
test("detail: từng ngày của một thực tập sinh", async () => {
  useDb(reportDb);
  const d = await report.detail("1", Q);
  assert.deepEqual(d.days.map((x) => x.status), ["PRESENT", "PRESENT", "HOLIDAY", "LEAVE", "ABSENT_PENDING_LEAVE", "DAY_OFF", "DAY_OFF"]);
  assert.deepEqual(d.days[1].flags, ["LATE"]);
  assert.equal(d.days[0].schedule.sourceLabel, "Mặc định");
  await throwsStatus(report.detail("abc", Q), 400, "id sai");
  await throwsStatus(report.detail("99", Q), 404, "không tồn tại");
});
test("detail: dữ liệu tải theo lô, không truy vấn theo từng ngày", async () => {
  let queries = 0;
  const counted = Object.fromEntries(Object.entries(reportDb).map(([k, fn]) => [k, async (...a) => { queries += 1; return fn(...a); }]));
  useDb(counted);
  await report.report({ from: "2026-01-01", to: "2026-12-31" });
  assert.ok(queries <= 8, `số truy vấn ${queries}`);
});
test("exportCsv: BOM không nằm trong nội dung, có tiêu đề và chống CSV injection", async () => {
  useDb({ ...reportDb, getAllStudents: async () => [{ ...internA, fullName: "=cmd|calc" }, internB] });
  const { filename, content } = await report.exportCsv(Q);
  assert.equal(filename, "bao-cao-chuyen-can_2026-09-07_2026-09-13.csv");
  const lines = content.split("\r\n");
  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith('"Họ tên"'));
  assert.ok(lines.some((l) => l.startsWith(`"'=cmd|calc"`)));
  assert.ok(lines.some((l) => l.includes('"66.7"')));
});

// ---------- Nghỉ phép ----------
const today = getVietnamToday();
const user = { email: "an@x.vn", id: 7 };
const leaveDb = (over = {}) => ({
  findInternProfileByEmail: async () => internA,
  listConfirmedContractsForInterns: async () => [{ id: 1, internId: 1, programId: 3, startDate: null, endDate: null }],
  listAttendance: async () => [],
  listLeaves: async () => [],
  createLeave: async (input) => { calls.push(input); return 99; },
  ...over,
});
const body = (o = {}) => ({ leave_type: "SICK", from_date: addDays(today, 2), to_date: addDays(today, 3), reason: "Ốm", ...o });
test("leaves.submit: đơn hợp lệ (kể cả hợp đồng thiếu ngày)", async () => {
  useDb(leaveDb());
  assert.deepEqual(await leaves.submit(user, body()), { id: 99 });
  assert.equal(calls.pop().internId, 1);
});
test("leaves.submit: các trường hợp bị từ chối", async () => {
  useDb(leaveDb());
  await throwsStatus(leaves.submit(user, body({ from_date: addDays(today, 3), to_date: addDays(today, 2) })), 400, "từ > đến");
  await throwsStatus(leaves.submit(user, body({ reason: "  " })), 400, "thiếu lý do");
  await throwsStatus(leaves.submit(user, body({ leave_type: "X" })), 400, "loại sai");
  await throwsStatus(leaves.submit(user, { ...body(), extra: 1 }), 400, "trường lạ");
  await throwsStatus(leaves.submit(user, body({ to_date: addDays(today, 40) })), 400, "quá 30 ngày");
  await throwsStatus(leaves.submit(user, body({ from_date: addDays(today, -8), to_date: addDays(today, -7) })), 400, "nộp bù quá 7 ngày");
  assert.deepEqual(await leaves.submit(user, body({ from_date: addDays(today, -7), to_date: addDays(today, -7) })), { id: 99 });
  calls.pop();
  useDb(leaveDb({ listConfirmedContractsForInterns: async () => [{ id: 1, internId: 1, startDate: null, endDate: addDays(today, 2) }] }));
  await throwsStatus(leaves.submit(user, body()), 409, "ngoài hợp đồng");
  useDb(leaveDb({ listAttendance: async () => [{ id: 1 }] }));
  await throwsStatus(leaves.submit(user, body()), 409, "đã chấm công");
  useDb(leaveDb({ listLeaves: async () => [{ status: "PENDING" }] }));
  await throwsStatus(leaves.submit(user, body()), 409, "chồng đơn");
  useDb(leaveDb({ listLeaves: async () => [{ status: "REJECTED" }, { status: "CANCELLED" }] }));
  assert.deepEqual(await leaves.submit(user, body()), { id: 99 }); // đơn bị từ chối/hủy không tính là chồng
  calls.pop();
  useDb(leaveDb({ findInternProfileByEmail: async () => null }));
  await throwsStatus(leaves.submit(user, body()), 404, "chưa có hồ sơ");
});
test("leaves.cancel", async () => {
  useDb(leaveDb({ cancelLeave: async (id, internId, d) => (id === 5 && internId === 1 && d === today ? 1 : 0) }));
  assert.equal(await leaves.cancel(user, "5"), null);
  await throwsStatus(leaves.cancel(user, "6"), 409, "không hủy được");
  await throwsStatus(leaves.cancel(user, "abc"), 400, "id sai");
});
const hr = { role: "HR", id: 1, email: "hr@x.vn" };
const mentor5 = { role: "Mentor", id: 2, email: "m5@x.vn" };
const mentor6 = { role: "Mentor", id: 3, email: "m6@x.vn" };
const reviewDb = (leave) => ({
  findLeave: async (id) => (id === 10 ? leave : null),
  findMentorByEmail: async (email) => (email === "m5@x.vn" ? { id: 5 } : email === "m6@x.vn" ? { id: 6 } : null),
  reviewLeave: async (id, decision, uid, note) => { calls.push({ id, decision, uid, note }); return 1; },
});
test("leaves.review: HR và mentor phụ trách duyệt, mentor khác bị chặn", async () => {
  const pendingLeave = { id: 10, internId: 1, mentorId: 5, status: "PENDING" };
  useDb(reviewDb(pendingLeave));
  assert.equal(await leaves.review(hr, "10", { decision: "APPROVED" }), null);
  assert.deepEqual(calls.pop(), { id: 10, decision: "APPROVED", uid: 1, note: "" });
  assert.equal(await leaves.review(mentor5, "10", { decision: "REJECTED", note: "Trùng lịch bảo vệ" }), null);
  calls.pop();
  await throwsStatus(leaves.review(mentor6, "10", { decision: "APPROVED" }), 403, "mentor khác");
  await throwsStatus(leaves.review(hr, "10", { decision: "REJECTED" }), 400, "từ chối thiếu lý do");
  await throwsStatus(leaves.review(hr, "10", { decision: "MAYBE" }), 400, "quyết định sai");
  await throwsStatus(leaves.review(hr, "11", { decision: "APPROVED" }), 404, "không tồn tại");
  useDb(reviewDb({ ...pendingLeave, status: "APPROVED" }));
  await throwsStatus(leaves.review(hr, "10", { decision: "APPROVED" }), 409, "đã xử lý");
  useDb({ ...reviewDb(pendingLeave), reviewLeave: async () => 0 });
  await throwsStatus(leaves.review(hr, "10", { decision: "APPROVED" }), 409, "xử lý đồng thời");
});
test("leaves.list: kiểm tra bộ lọc", async () => {
  useDb({ listLeavesForStaff: async (f) => [f] });
  assert.deepEqual(await leaves.list({ status: "PENDING", intern_id: "3", from: "2026-09-01", to: "2026-09-30" }), [{
    status: "PENDING", internId: 3, from: "2026-09-01", to: "2026-09-30",
  }]);
  for (const bad of [{ status: "X" }, { intern_id: "0" }, { from: "xx" }, { from: "2026-09-30", to: "2026-09-01" }, { foo: 1 }])
    await throwsStatus(leaves.list(bad), 400, JSON.stringify(bad));
});

// ---------- Quản lý lịch làm việc ----------
const mgmtDb = (over = {}) => ({
  findWorkSchedule: async (id) => [fixed, flexible].find((s) => s.id === id) || null,
  workScheduleTargetExists: async (type, value) => value !== "999",
  createWorkScheduleAssignment: async (input, plan) => {
    const result = plan(over.existing || []);
    if (result.conflict) return { conflict: true };
    calls.push({ input, close: result.close });
    return { id: 50 };
  },
  ...over,
});
const assignBody = (o = {}) => ({ schedule_id: 2, target_type: "PROGRAM", target_value: "3", effective_from: "2026-11-01", ...o });
test("workSchedules.assign: kiểm tra đầu vào và trùng khoảng ngày", async () => {
  useDb(mgmtDb({ existing: [{ id: 8, effectiveFrom: "2026-01-01", effectiveTo: null }] }));
  assert.deepEqual(await schedules.assign(hr, assignBody()), { id: 50 });
  const call = calls.pop();
  assert.equal(call.input.createdBy, 1);
  assert.deepEqual(call.close, [{ id: 8, effectiveTo: "2026-10-31" }]);
  await throwsStatus(schedules.assign(hr, assignBody({ target_value: "999" })), 404, "phạm vi không tồn tại");
  await throwsStatus(schedules.assign(hr, assignBody({ schedule_id: 77 })), 404, "lịch không tồn tại");
  await throwsStatus(schedules.assign(hr, assignBody({ target_type: "X" })), 400, "loại sai");
  await throwsStatus(schedules.assign(hr, assignBody({ target_value: "abc" })), 400, "id phạm vi sai");
  await throwsStatus(schedules.assign(hr, assignBody({ effective_from: "2026-13-01" })), 400, "ngày sai");
  await throwsStatus(schedules.assign(hr, assignBody({ effective_to: "2026-10-01" })), 400, "kết thúc trước hiệu lực");
  await throwsStatus(schedules.assign(hr, { ...assignBody(), extra: 1 }), 400, "trường lạ");
  useDb(mgmtDb({ existing: [{ id: 8, effectiveFrom: "2026-11-01", effectiveTo: null }] }));
  await throwsStatus(schedules.assign(hr, assignBody()), 409, "trùng ngày bắt đầu");
  useDb(mgmtDb({ createWorkScheduleAssignment: async () => { const e = new Error("dup"); e.code = "ER_DUP_ENTRY"; throw e; } }));
  await throwsStatus(schedules.assign(hr, assignBody()), 409, "vi phạm khóa duy nhất khi hai yêu cầu cùng lúc");
  useDb(mgmtDb());
  assert.deepEqual(await schedules.assign(hr, { schedule_id: 1, target_type: "DEFAULT", effective_from: "2026-11-01" }), { id: 50 });
  assert.equal(calls.pop().input.targetValue, "");
  assert.deepEqual(await schedules.assign(hr, assignBody({ target_type: "UNIVERSITY", target_value: "ĐH Thái Nguyên" })), { id: 50 });
  calls.pop();
});
test("workSchedules.update/remove", async () => {
  const saved = [];
  useDb({ findWorkSchedule: mgmtDb().findWorkSchedule, saveWorkSchedule: async (id, input) => { saved.push(input); return { ...input, id }; }, deleteWorkSchedule: async (id) => (id === 3 ? 1 : 0) });
  await throwsStatus(schedules.update("1", { days: days.map((d) => ({ ...d, end_time: "08:00" })) }), 400, "giờ sai khi chỉ sửa ngày");
  await throwsStatus(schedules.update("2", { mode: "FIXED" }), 400, "đổi sang FIXED không có giờ");
  await throwsStatus(schedules.update("1", { mode: "FLEXIBLE" }), 400, "đổi sang FLEXIBLE thiếu số phút");
  assert.equal((await schedules.update("1", { name: "Tên mới" })).name, "Tên mới");
  assert.equal((await schedules.update("1", { mode: "FLEXIBLE", min_daily_minutes: 300 })).minDailyMinutes, 300);
  await throwsStatus(schedules.update("55", { name: "x" }), 404, "không tồn tại");
  await throwsStatus(schedules.remove("1"), 409, "xóa lịch mặc định");
  await throwsStatus(schedules.remove("4"), 409, "lịch đang dùng/không tồn tại");
  assert.equal(await schedules.remove("3"), null);
  useDb({ deleteWorkSchedule: async () => { const e = new Error("fk"); e.code = "ER_ROW_IS_REFERENCED_2"; throw e; } });
  await throwsStatus(schedules.remove("4"), 409, "ràng buộc khóa ngoại");
});
test("workSchedules.options: danh sách cho ô chọn phạm vi", async () => {
  useDb({
    getFinalReportFilterOptions: async () => ({ universities: ["ĐH X", { value: "ĐH Y" }], programs: [{ id: 3, name: "Hè", extra: 1 }] }),
    getAllMentors: async () => [{ id: 5, fullName: "Mentor Năm", email: "m@x.vn" }],
    getAllStudents: async () => [internA],
  });
  assert.deepEqual(await schedules.options(), {
    universities: ["ĐH X", "ĐH Y"],
    programs: [{ id: 3, name: "Hè" }],
    mentors: [{ id: 5, name: "Mentor Năm" }],
    interns: [{ id: 1, name: "An", studentCode: "SV1" }],
  });
});
test("workSchedules.preview/resolved", async () => {
  useDb({
    getAllStudents: async () => [internA, internB, { id: 3, fullName: "Chi", university: "ĐH X", mentorId: null }],
    listConfirmedContractsForInterns: async () => [
      { id: 1, internId: 1, programId: 4, startDate: null, endDate: null, confirmedAt: "2026-01-01" },
      { id: 2, internId: 2, programId: 4, startDate: null, endDate: "2000-01-01", confirmedAt: "2026-01-01" }, // đã kết thúc
    ],
    loadWorkScheduleContext: async () => ctx,
  });
  const resolved = await schedules.resolved();
  assert.deepEqual(resolved.map((r) => r.intern.fullName), ["An"], "chỉ người đang/sắp thực tập");
  assert.equal(resolved[0].schedule.name, "Linh hoạt");
  assert.equal(resolved[0].source.label, "Chương trình: Thu 2026");
  // An (ĐH X) đang dùng lịch của chương trình nên lần áp dụng theo trường bị chương trình ghi đè.
  // Chi cùng trường nhưng chưa có hợp đồng, Bình đã hết hợp đồng: cả hai không tính.
  const byUniversity = await schedules.preview({ target_type: "UNIVERSITY", target_value: "ĐH X" });
  assert.deepEqual([byUniversity.count, byUniversity.overriddenCount], [1, 1]);
  assert.deepEqual(byUniversity.interns.map((i) => i.fullName), ["An"]);
  const byProgram = await schedules.preview({ target_type: "PROGRAM", target_value: "4" });
  assert.deepEqual([byProgram.count, byProgram.overriddenCount], [1, 0]);
  assert.deepEqual((await schedules.preview({ target_type: "DEFAULT" })).count, 1);
  assert.deepEqual((await schedules.preview({ target_type: "INTERN", target_value: "2" })).count, 0);
  await throwsStatus(schedules.preview({ target_type: "X" }), 400, "loại sai");
  await throwsStatus(schedules.preview({ target_type: "PROGRAM" }), 400, "thiếu giá trị");
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`[FAIL] ${name}\n  ${err.message}`);
    }
  }
  if (failed) process.exit(1);
  console.log(`[PASS] attendance report / leaves / work schedules service checks (${tests.length})`);
})();
