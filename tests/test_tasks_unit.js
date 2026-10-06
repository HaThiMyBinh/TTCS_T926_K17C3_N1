// Unit test nghiệp vụ giao nhiệm vụ: không cần MySQL, dùng db giả trong bộ nhớ.
const assert = require("assert");

// ---------- DB giả (thay thế ../db trước khi nạp service) ----------
const lower = (value) => String(value).toLowerCase();
const mentors = [
  { id: 1, fullName: "Mentor Một", email: "mentor1@test.local" },
  { id: 2, fullName: "Mentor Hai", email: "mentor2@test.local" },
];
const interns = [
  {
    id: 10,
    fullName: "Intern A",
    email: "a@test.local",
    studentCode: "SV10",
    mentorId: 1,
  },
  {
    id: 11,
    fullName: "Intern B",
    email: "b@test.local",
    studentCode: "SV11",
    mentorId: 2,
  },
  {
    id: 12,
    fullName: "Intern C",
    email: "c@test.local",
    studentCode: "SV12",
    mentorId: null,
  },
];
let tasks = [];
let nextTaskId = 1;

function joinTask(task) {
  const intern = interns.find((i) => i.id === task.internId);
  const mentor = mentors.find((m) => m.id === intern.mentorId);
  return {
    ...task,
    internName: intern.fullName,
    studentCode: intern.studentCode,
    internMentorId: intern.mentorId,
    mentorName: mentor ? mentor.fullName : null,
  };
}

const fakeDb = {
  findMentorByEmail: async (email) => {
    return mentors.find((m) => lower(m.email) === lower(email)) || null;
  },
  findInternProfileById: async (id) => {
    return interns.find((i) => i.id === id) || null;
  },
  findInternProfileByEmail: async (email) => {
    return interns.find((i) => lower(i.email) === lower(email)) || null;
  },
  insertInternTask: async (task) => {
    const row = {
      id: nextTaskId++,
      internId: task.internId,
      createdByMentorId: task.createdByMentorId,
      title: task.title,
      description: task.description || null,
      dueDate: task.dueDate || null,
      priority: task.priority || "MEDIUM",
      status: "TODO",
      createdAt: "2026-01-01 00:00:00",
      updatedAt: "2026-01-01 00:00:00",
    };
    tasks.push(row);
    return row.id;
  },
  findInternTaskById: async (id) => {
    const task = tasks.find((t) => t.id === id);
    return task ? joinTask(task) : null;
  },
  listInternTasksForMentor: async (mentorId, { internId = null } = {}) => {
    return tasks
      .map(joinTask)
      .filter((t) => t.internMentorId === mentorId)
      .filter((t) => !internId || t.internId === internId);
  },
  listInternTasksForIntern: async (internId) => {
    return tasks.filter((t) => t.internId === internId).map(joinTask);
  },
  updateInternTask: async (id, fields) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return 0;
    Object.assign(task, fields);
    return 1;
  },
  deleteInternTask: async (id) => {
    const before = tasks.length;
    tasks = tasks.filter((t) => t.id !== id);
    return before - tasks.length;
  },
};

const dbPath = require.resolve("../db");
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: fakeDb,
  children: [],
  paths: [],
};

const service = require("../services/tasks.service");
const { getVietnamToday } = require("../utils/date");

// ---------- Tiện ích ----------
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
const today = getVietnamToday();
const tomorrow = addDays(today, 1);
const yesterday = addDays(today, -1);
const is400 = (e) => e.status === 400;

async function rejects(promise, status, label) {
  try {
    await promise;
  } catch (err) {
    const got = `nhận ${err.status} (${err.message})`;
    assert.strictEqual(err.status, status, `${label}: cần ${status}, ${got}`);
    return;
  }
  assert.fail(`${label}: mong đợi lỗi HTTP ${status} nhưng không có lỗi`);
}

const mentor1 = { id: 101, email: "mentor1@test.local", role: "Mentor" };
const mentor2 = { id: 102, email: "mentor2@test.local", role: "Mentor" };
const internUser = (email) => ({ email, role: "Intern" });

const validate = (input, opts) =>
  service.validateTaskInput(input, { today, ...opts });
const throws400 = (input, opts) =>
  assert.throws(() => validate(input, opts), is400);
const createAs = (user, body) => service.createTask(user, body);
const titles = (list) => list.map((t) => t.title).sort();

function testValidateInput() {
  const parsed = validate({ title: "  Báo cáo  " });
  assert.deepStrictEqual(parsed, { title: "Báo cáo" });
  throws400({});
  throws400({ title: "   " });
  throws400({ title: 123 });
  throws400({ title: "x".repeat(256) });
  assert.strictEqual(validate({ title: "x".repeat(255) }).title.length, 255);
  throws400(null);
  throws400([]);

  const blank = validate({ title: "t", description: "  " });
  assert.strictEqual(blank.description, null);
  const trimmed = validate({ title: "t", description: " mô tả " });
  assert.strictEqual(trimmed.description, "mô tả");
  throws400({ title: "t", description: "x".repeat(5001) });
  throws400({ title: "t", description: 5 });

  const due = (value) => validate({ title: "t", due_date: value }).dueDate;
  assert.strictEqual(due(today), today);
  assert.strictEqual(due(tomorrow), tomorrow);
  assert.strictEqual(due(null), null);
  assert.strictEqual(due(""), null);
  throws400({ title: "t", due_date: yesterday });
  throws400({ title: "t", due_date: "2026-02-30" });
  throws400({ title: "t", due_date: "30/10/2026" });
  throws400({ title: "t", due_date: 20261001 });

  const high = validate({ title: "t", priority: "HIGH" });
  assert.strictEqual(high.priority, "HIGH");
  throws400({ title: "t", priority: "URGENT" });
  // status chỉ nhận khi cập nhật, tạo mới bỏ qua
  const ignored = validate({ title: "t", status: "DONE" });
  assert.strictEqual(ignored.status, undefined);
  const partial = { partial: true };
  assert.strictEqual(validate({ status: "DONE" }, partial).status, "DONE");
  throws400({ status: "LATE" }, partial);
  // cập nhật
  throws400({}, partial);
  throws400({ unknown: 1 }, partial);
  assert.deepStrictEqual(validate({ title: "Mới" }, partial), { title: "Mới" });
  throws400({ title: "" }, partial);
  // giữ nguyên hạn cũ đã quá hạn vẫn hợp lệ, đổi sang hạn quá khứ khác thì không
  const keepOld = { partial: true, currentDueDate: yesterday };
  const kept = validate({ due_date: yesterday }, keepOld);
  assert.strictEqual(kept.dueDate, yesterday);
  throws400({ due_date: addDays(today, -5) }, keepOld);
}

function testDto() {
  const base = { id: "7", internId: "10", title: "T", priority: "LOW" };
  const dto = (extra) => {
    const row = { ...base, status: "TODO", ...extra };
    return service.toTaskDto(row, today);
  };
  assert.strictEqual(dto({ dueDate: yesterday }).is_overdue, true);
  assert.strictEqual(dto({ dueDate: today }).is_overdue, false);
  const done = dto({ dueDate: yesterday, status: "DONE" });
  assert.strictEqual(done.is_overdue, false);
  assert.strictEqual(dto({}).is_overdue, false);
  assert.strictEqual(dto({}).id, 7);
}

async function testCreate() {
  const created = await createAs(mentor1, {
    intern_id: 10,
    title: "  Làm trang đăng nhập ",
    description: "Dùng HTML/CSS",
    due_date: tomorrow,
    priority: "HIGH",
  });
  assert.strictEqual(created.title, "Làm trang đăng nhập");
  assert.strictEqual(created.intern_id, 10);
  assert.strictEqual(created.intern_name, "Intern A");
  assert.strictEqual(created.status, "TODO");
  assert.strictEqual(created.priority, "HIGH");
  assert.strictEqual(created.due_date, tomorrow);
  assert.strictEqual(created.is_overdue, false);
  assert.strictEqual(tasks[0].createdByMentorId, 1);

  const input = { intern_id: "10", title: "Tối thiểu" };
  const minimal = await createAs(mentor1, input);
  assert.strictEqual(minimal.priority, "MEDIUM");
  assert.strictEqual(minimal.due_date, null);
  assert.strictEqual(minimal.description, "");

  const base = { title: "x" };
  const past = { intern_id: 10, title: "x", due_date: yesterday };
  const noProfile = { id: 1, email: "nomentor@test.local", role: "Mentor" };
  const internRole = { id: 1, email: "a@test.local", role: "Intern" };
  const failures = [
    [mentor1, { intern_id: 11, title: "x" }, 403, "intern của mentor khác"],
    [mentor1, { intern_id: 12, title: "x" }, 403, "intern chưa phân công"],
    [mentor1, { intern_id: 999, title: "x" }, 404, "intern không tồn tại"],
    [mentor1, { ...base }, 400, "thiếu intern_id"],
    [mentor1, { intern_id: "abc", ...base }, 400, "intern_id sai định dạng"],
    [mentor1, { intern_id: 0, ...base }, 400, "intern_id = 0"],
    [mentor1, { intern_id: 10, title: "" }, 400, "thiếu tiêu đề"],
    [mentor1, past, 400, "hạn quá khứ"],
    [mentor1, null, 400, "body rỗng"],
    [noProfile, { intern_id: 10, ...base }, 403, "mentor không có hồ sơ"],
    [internRole, { intern_id: 10, ...base }, 403, "vai trò Intern"],
  ];
  for (const [user, body, status, label] of failures) {
    await rejects(createAs(user, body), status, label);
  }
  assert.strictEqual(tasks.length, 2, "Tạo lỗi không được lưu nhiệm vụ");
  return { created, minimal };
}

async function testList() {
  const taskB = await createAs(mentor2, { intern_id: 11, title: "Việc của B" });
  let list = await service.listTasksForMentor(mentor1);
  const expected = ["Làm trang đăng nhập", "Tối thiểu"].sort();
  assert.deepStrictEqual(titles(list), expected);
  assert.ok(list.every((t) => t.intern_id === 10));
  list = await service.listTasksForMentor(mentor2);
  assert.deepStrictEqual(list.map((t) => t.id), [taskB.id]);
  list = await service.listTasksForMentor(mentor1, { intern_id: "10" });
  assert.strictEqual(list.length, 2);
  list = await service.listTasksForMentor(mentor1, { intern_id: "11" });
  assert.strictEqual(list.length, 0, "Lọc intern mentor khác phải rỗng");
  await rejects(
    service.listTasksForMentor(mentor1, { intern_id: "x" }),
    400,
    "lọc intern_id sai",
  );
  return taskB;
}

async function testUpdate({ created, minimal }) {
  const update = (user, id, body) => service.updateTask(user, id, body);
  let updated = await update(mentor1, created.id, {
    status: "IN_PROGRESS",
    priority: "LOW",
  });
  assert.strictEqual(updated.status, "IN_PROGRESS");
  assert.strictEqual(updated.priority, "LOW");
  assert.strictEqual(updated.title, "Làm trang đăng nhập", "Giữ nguyên title");
  const clear = { due_date: null, description: "" };
  updated = await update(mentor1, created.id, clear);
  assert.strictEqual(updated.due_date, null);
  assert.strictEqual(updated.description, "");

  const failures = [
    [mentor2, created.id, { title: "Chiếm quyền" }, 403, "mentor khác"],
    [mentor1, 9999, { title: "x" }, 404, "sửa task không tồn tại"],
    [mentor1, "abc", { title: "x" }, 400, "id task sai"],
    [mentor1, created.id, {}, 400, "cập nhật rỗng"],
    [mentor1, created.id, { status: "LATE" }, 400, "status sai"],
  ];
  for (const [user, id, body, status, label] of failures) {
    await rejects(update(user, id, body), status, label);
  }
  const stored = tasks.find((t) => t.id === created.id);
  assert.strictEqual(stored.title, "Làm trang đăng nhập");

  // Task quá hạn: sửa trường khác không bị chặn bởi hạn cũ, nhưng is_overdue=true
  tasks.find((t) => t.id === minimal.id).dueDate = yesterday;
  const keep = { title: "Tối thiểu (sửa)", due_date: yesterday };
  updated = await update(mentor1, minimal.id, keep);
  assert.strictEqual(updated.is_overdue, true);
  updated = await update(mentor1, minimal.id, { status: "DONE" });
  assert.strictEqual(updated.is_overdue, false, "DONE không bị quá hạn");
}

async function testInternView(taskB) {
  const mine = await service.listTasksForInternUser(internUser("a@test.local"));
  assert.strictEqual(mine.length, 2);
  assert.ok(mine.every((t) => t.intern_id === 10));
  assert.strictEqual(mine[0].mentor_name, "Mentor Một");
  const bUser = internUser("B@test.local");
  const bTasks = await service.listTasksForInternUser(bUser);
  assert.deepStrictEqual(bTasks.map((t) => t.id), [taskB.id]);
  await rejects(
    service.listTasksForInternUser(internUser("ghost@test.local")),
    404,
    "intern chưa có hồ sơ",
  );
  await rejects(
    service.listTasksForInternUser({ role: "Intern" }),
    404,
    "token thiếu email",
  );
}

async function testReassignAndDelete({ created }) {
  // Đổi mentor phụ trách: mentor cũ mất quyền, mentor mới có quyền
  const intern = interns.find((i) => i.id === 10);
  intern.mentorId = 2;
  await rejects(
    service.updateTask(mentor1, created.id, { title: "Mentor cũ" }),
    403,
    "mentor cũ sau khi đổi",
  );
  assert.strictEqual((await service.listTasksForMentor(mentor1)).length, 0);
  const rename = { title: "Mới" };
  const renamed = await service.updateTask(mentor2, created.id, rename);
  assert.strictEqual(renamed.title, "Mới");
  intern.mentorId = 1;

  const remove = (user, id) => service.deleteTask(user, id);
  await rejects(remove(mentor2, created.id), 403, "xóa task mentor khác");
  const deleted = await remove(mentor1, created.id);
  assert.deepStrictEqual(deleted, { id: created.id });
  await rejects(remove(mentor1, created.id), 404, "xóa lần hai");
  await rejects(remove(mentor1, "0"), 400, "xóa id sai");
}

(async () => {
  testValidateInput();
  testDto();
  const made = await testCreate();
  const taskB = await testList();
  await testUpdate(made);
  await testInternView(taskB);
  await testReassignAndDelete(made);
  console.log("PASS test_tasks_unit");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
