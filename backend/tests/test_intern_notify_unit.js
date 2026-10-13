// Unit test US12 (thực tập sinh): thông báo trong app về lịch trình + nhắc lịch (không cần MySQL).
const assert = require("assert");
const db = require("../db");
const { toInterns, viDate } = require("../services/internNotify.service");
const { runReminders } = require("../services/reminders.service");
const schedule = require("../services/schedule.service");
const tasks = require("../services/tasks.service");
const workSchedules = require("../services/workSchedules.service");

const saved = {};
const stub = (over) => { for (const k of Object.keys(over)) { if (!(k in saved)) saved[k] = db[k]; db[k] = over[k]; } };
const quiet = console.error; console.error = () => {};

const pushed = []; // mọi thông báo đã tạo: { userIds, ...payload }
const base = {
  findUserIdsByInternIds: async (ids) => ids.map((id) => ({ internId: id, userId: 1000 + id })),
  createNotifications: async (userIds, n) => { pushed.push({ userIds, ...n }); return userIds.length; },
};
const last = () => pushed.at(-1);

(async () => {
  stub(base);

  // ---- viDate / toInterns ----
  assert.strictEqual(viDate("2026-10-12"), "12/10/2026");
  assert.strictEqual(viDate("2026-10-12 08:00:00"), "12/10/2026");
  assert.strictEqual(await toInterns([1, 2, 2, "x", 0], { type: "T", title: "a", message: "b" }), 2);
  assert.deepStrictEqual(last().userIds, [1001, 1002]);
  assert.strictEqual(await toInterns([], { type: "T" }), 0);
  stub({ findUserIdsByInternIds: async () => { throw new Error("db lỗi"); } });
  assert.strictEqual(await toInterns([1], { type: "T" }), 0, "lỗi bị nuốt");
  stub(base);

  // ---- nhắc lịch ----
  const calls = [];
  const dedupe = new Set();
  stub({
    listMilestonesStartingBetween: async (from, to) => { calls.push(["ms", from, to]); return [{ id: 7, internId: 1, title: "Onboarding", startDate: "2026-10-13" }, { id: 8, internId: 2, title: "Dự án", startDate: "2026-10-12" }]; },
    listTasksDueBetween: async (from, to) => { calls.push(["task", from, to]); return [{ id: 3, internId: 1, title: "Báo cáo tuần", dueDate: "2026-10-13" }]; },
    // mô phỏng khóa chống trùng của DB: cùng (user, dedupeKey) chỉ tạo một lần
    createNotifications: async (userIds, n) => { const fresh = userIds.filter((u) => !dedupe.has(`${u}|${n.dedupeKey}`)); fresh.forEach((u) => dedupe.add(`${u}|${n.dedupeKey}`)); if (fresh.length) pushed.push({ userIds: fresh, ...n }); return fresh.length; },
  });
  pushed.length = 0;
  assert.deepStrictEqual(await runReminders({ today: "2026-10-12" }), { milestones: 2, tasks: 1 });
  assert.deepStrictEqual(calls, [["ms", "2026-10-12", "2026-10-13"], ["task", "2026-10-12", "2026-10-13"]]);
  const byRef = Object.fromEntries(pushed.map((p) => [p.type + p.refId, p]));
  assert.match(byRef.SCHEDULE_REMINDER7.message, /"Onboarding" bắt đầu ngày mai \(13\/10\/2026\)/);
  assert.match(byRef.SCHEDULE_REMINDER8.message, /"Dự án" bắt đầu hôm nay/);
  assert.match(byRef.TASK_REMINDER3.message, /đến hạn ngày mai/);
  assert.strictEqual(byRef.SCHEDULE_REMINDER7.dedupeKey, "ms-start:7:2026-10-13:D1");
  assert.strictEqual(byRef.TASK_REMINDER3.targetTab, "tab-my-tasks");
  assert.deepStrictEqual(await runReminders({ today: "2026-10-12" }), { milestones: 0, tasks: 0 }, "chạy lại không lặp");
  // sang ngày hôm sau: mốc ngày 13 nhắc thêm một lần "hôm nay"
  stub({ listMilestonesStartingBetween: async () => [{ id: 7, internId: 1, title: "Onboarding", startDate: "2026-10-13" }], listTasksDueBetween: async () => [] });
  assert.deepStrictEqual(await runReminders({ today: "2026-10-13" }), { milestones: 1, tasks: 0 });
  assert.match(last().message, /bắt đầu hôm nay/);
  stub(base);

  // ---- mốc lịch thực tập (HR/mentor sửa) -> báo thực tập sinh ----
  const intern = { id: 5, fullName: "An", mentorId: 9 };
  const hr = { role: "HR", id: 1 };
  let milestones = [];
  stub({
    findInternProfileById: async () => intern,
    listContractsByInternId: async () => [{ confirmationStatus: "CONFIRMED", startDate: "2026-09-01", endDate: "2026-12-31", confirmedAt: "2026-08-01 00:00:00", id: 1 }],
    insertScheduleMilestone: async () => 1,
    updateScheduleMilestone: async () => 1,
    findMilestoneById: async () => ({ id: 4, internId: 5, title: "Dự án", startDate: "2026-10-01", endDate: "2026-10-31" }),
    deleteScheduleMilestone: async () => 1,
    listScheduleMilestones: async () => milestones,
  });
  pushed.length = 0;
  await schedule.manageMilestones(hr, "5", "create", null, { title: "Onboarding", start_date: "2026-09-01", end_date: "2026-09-07", phase_order: 1 });
  assert.strictEqual(last().type, "SCHEDULE_CHANGED");
  assert.deepStrictEqual(last().userIds, [1005]);
  assert.strictEqual(last().targetTab, "tab-my-schedule");
  assert.match(last().message, /Đã thêm mốc "Onboarding" \(01\/09\/2026 – 07\/09\/2026\)/);
  await schedule.manageMilestones(hr, "5", "update", "4", { start_date: "2026-10-02" });
  assert.match(last().message, /"Dự án" vừa được cập nhật \(có thay đổi ngày\)/);
  await schedule.manageMilestones(hr, "5", "delete", "4");
  assert.match(last().message, /"Dự án" đã được xóa/);
  assert.strictEqual(pushed.length, 3);
  // lỗi tạo thông báo không làm hỏng việc sửa lịch
  stub({ createNotifications: async () => { throw new Error("db lỗi"); } });
  await schedule.manageMilestones(hr, "5", "delete", "4");
  stub(base);
  // sai quyền / dữ liệu sai -> không có thông báo nào
  pushed.length = 0;
  await assert.rejects(schedule.manageMilestones({ role: "Intern" }, "5", "create", null, {}), (e) => e.status === 403);
  assert.strictEqual(pushed.length, 0);

  // ---- giao nhiệm vụ -> báo thực tập sinh ----
  stub({
    findMentorByEmail: async () => ({ id: 9 }),
    hasConfirmedContract: async () => true,
    insertInternTask: async () => 77,
    findInternTaskById: async () => null,
  });
  pushed.length = 0;
  await tasks.createTask({ role: "Mentor", email: "m@x.vn" }, { intern_id: 5, title: "Làm slide", due_date: "2099-01-31" });
  assert.strictEqual(last().type, "TASK_ASSIGNED");
  assert.deepStrictEqual(last().userIds, [1005]);
  assert.match(last().message, /"Làm slide" – hạn 31\/01\/2099/);
  assert.strictEqual(last().refId, 77);
  await tasks.createTask({ role: "Mentor", email: "m@x.vn" }, { intern_id: 5, title: "Không hạn" });
  assert.match(last().message, /^Mentor giao: "Không hạn"\.$/);

  // ---- ngày nghỉ chung -> báo mọi thực tập sinh đang thực tập ----
  stub({
    addWorkHoliday: async () => 1,
    getAllStudents: async () => [{ id: 5 }, { id: 6 }, { id: 7 }],
    listConfirmedContractsForInterns: async () => [{ internId: 5, startDate: "2026-01-01", endDate: "2099-12-31" }, { internId: 6, startDate: "2026-01-01", endDate: "2099-12-31" }, { internId: 7, startDate: "2020-01-01", endDate: "2020-02-01" }],
    listProgramMembershipsForInterns: async () => [],
    loadWorkScheduleContext: async () => ({ schedules: [], assignments: [], programs: [], mentors: [] }),
    listWorkHolidays: async () => [{ id: 2, holidayDate: "2026-09-02", name: "Quốc khánh" }],
    deleteWorkHoliday: async () => 1,
  });
  pushed.length = 0;
  await workSchedules.addHoliday({ holiday_date: "2026-09-02", name: "Quốc khánh" });
  assert.deepStrictEqual(last().userIds, [1005, 1006], "người đã hết hợp đồng không nhận");
  assert.strictEqual(last().type, "WORK_SCHEDULE_CHANGED");
  assert.match(last().message, /02\/09\/2026 là ngày nghỉ chung: Quốc khánh/);
  await workSchedules.removeHoliday("2");
  assert.match(last().message, /Quốc khánh\) đã được hủy/);

  // ---- áp dụng / gỡ lịch làm việc -> chỉ báo người thật sự bị ảnh hưởng ----
  const w = require("../services/scheduleRules.service");
  const days = Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, is_working: i < 5, start_time: "08:30", end_time: "17:30" }));
  const fixed = { id: 1, ...w.validateSchedule({ name: "Mặc định", mode: "FIXED", grace_minutes: 15, days }) };
  const part = { id: 2, ...w.validateSchedule({ name: "Giờ chiều", mode: "FIXED", grace_minutes: 15, days: days.map((d) => ({ ...d, start_time: "13:00", end_time: "17:00" })) }) };
  const ctxWith = (assignments) => ({ schedules: [fixed, part], assignments, programs: [], mentors: [] });
  const dflt = { id: 1, scheduleId: 1, targetType: "DEFAULT", targetValue: "", effectiveFrom: "1970-01-01", effectiveTo: null };
  const interns = [
    { id: 5, fullName: "An", university: "ĐH X", mentorId: null },
    { id: 6, fullName: "Bình", university: "ĐH X", mentorId: null }, // có lịch riêng -> bị ghi đè
    { id: 8, fullName: "Chi", university: "ĐH Y", mentorId: null },
  ];
  const personal = { id: 9, scheduleId: 2, targetType: "INTERN", targetValue: "6", effectiveFrom: "2026-01-01", effectiveTo: null };
  stub({
    getAllStudents: async () => interns,
    listConfirmedContractsForInterns: async () => interns.map((i) => ({ internId: i.id, startDate: "2026-01-01", endDate: "2099-12-31" })),
    listProgramMembershipsForInterns: async () => [],
    loadWorkScheduleContext: async () => ctxWith([dflt, personal]),
    findWorkSchedule: async () => part,
    workScheduleTargetExists: async () => true,
    createWorkScheduleAssignment: async () => ({ id: 31 }),
    listWorkScheduleAssignments: async () => [{ id: 31, scheduleId: 2, scheduleName: "Giờ chiều", targetType: "UNIVERSITY", targetValue: "ĐH X" }],
    deleteWorkScheduleAssignment: async () => 1,
  });
  pushed.length = 0;
  await workSchedules.assign({ id: 1 }, { schedule_id: 2, target_type: "UNIVERSITY", target_value: "ĐH X", effective_from: "2026-10-20" });
  assert.deepStrictEqual(last().userIds, [1005], "Bình đã có lịch riêng, Chi khác trường -> không báo");
  assert.match(last().message, /"Giờ chiều" được áp dụng cho bạn từ 20\/10\/2026/);
  await workSchedules.removeAssignment("31");
  assert.deepStrictEqual(last().userIds, [1005]);
  assert.match(last().message, /"Giờ chiều" không còn áp dụng cho bạn/);
  // áp dụng không ảnh hưởng ai (không ai thuộc phạm vi) -> không tạo thông báo
  pushed.length = 0;
  await workSchedules.assign({ id: 1 }, { schedule_id: 2, target_type: "UNIVERSITY", target_value: "ĐH Z", effective_from: "2026-10-20" });
  assert.strictEqual(pushed.length, 0);

  console.error = quiet;
  console.log("INTERN NOTIFY UNIT: events/reminders/dedupe/hooks PASS");
})().catch((err) => { console.error = quiet; console.error(err); process.exit(1); }).finally(() => Object.assign(db, saved));
