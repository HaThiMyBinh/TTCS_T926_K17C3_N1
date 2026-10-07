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
      progressPercent: 0,
      progressNote: null,
      progressUpdatedAt: null,
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
  listInternTasksForMentor: async (
    mentorId,
    { internId = null, status = null } = {},
  ) => {
    return tasks
      .map(joinTask)
      .filter((t) => t.internMentorId === mentorId)
      .filter((t) => !internId || t.internId === internId)
      .filter((t) => !status || t.status === status);
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
  updateInternTaskProgress: async (id, fields) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return 0;
    Object.assign(task, fields, { progressUpdatedAt: "2026-01-02 08:00:00" });
    return 1;
  },
  listTaskAttachmentsByTaskIds: async () => ({}),
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
  assert.deepStrictEqual(
    list.map((t) => t.id),
    [taskB.id],
  );
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
  assert.deepStrictEqual(
    bTasks.map((t) => t.id),
    [taskB.id],
  );
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

function testResolveProgress() {
  const cur = (status, percent) => ({ status, percent });
  const r = (c, i) => service.resolveProgress(c, i);
  const eq = (got, status, percent) =>
    assert.deepStrictEqual(got, { status, percent });

  // Chỉ gửi status
  eq(r(cur("TODO", 0), { status: "DONE" }), "DONE", 100);
  eq(r(cur("IN_PROGRESS", 40), { status: "TODO" }), "TODO", 0);
  eq(r(cur("TODO", 0), { status: "IN_PROGRESS" }), "IN_PROGRESS", 0);
  eq(r(cur("IN_PROGRESS", 40), { status: "IN_PROGRESS" }), "IN_PROGRESS", 40);
  eq(r(cur("DONE", 100), { status: "IN_PROGRESS" }), "IN_PROGRESS", 99);
  // Chỉ gửi percent
  eq(r(cur("TODO", 0), { percent: 100 }), "DONE", 100);
  eq(r(cur("TODO", 0), { percent: 30 }), "IN_PROGRESS", 30);
  eq(r(cur("DONE", 100), { percent: 0 }), "TODO", 0);
  eq(r(cur("IN_PROGRESS", 50), { percent: 0 }), "IN_PROGRESS", 0);
  // Gửi cả hai, khớp nhau
  eq(r(cur("TODO", 0), { status: "DONE", percent: 100 }), "DONE", 100);
  eq(
    r(cur("TODO", 0), { status: "IN_PROGRESS", percent: 0 }),
    "IN_PROGRESS",
    0,
  );
  eq(r(cur("TODO", 0), { status: "TODO", percent: 0 }), "TODO", 0);
  // Gửi cả hai, mâu thuẫn
  const bad = [
    { status: "DONE", percent: 40 },
    { status: "TODO", percent: 10 },
    { status: "IN_PROGRESS", percent: 100 },
  ];
  for (const input of bad) {
    assert.throws(() => r(cur("TODO", 0), input), is400, JSON.stringify(input));
  }
  // Không gửi gì: giữ nguyên
  eq(r(cur("IN_PROGRESS", 70), {}), "IN_PROGRESS", 70);
}

function testValidateProgress() {
  const cur = { status: "TODO", percent: 0 };
  const v = (input) => service.validateProgressInput(input, cur);
  const bad = (input) => assert.throws(() => v(input), is400);

  assert.deepStrictEqual(v({ progress_percent: 50 }), {
    status: "IN_PROGRESS",
    progressPercent: 50,
  });
  assert.deepStrictEqual(v({ status: "DONE" }), {
    status: "DONE",
    progressPercent: 100,
  });
  // Chỉ ghi chú: không đụng status/percent
  assert.deepStrictEqual(v({ progress_note: "  Xong form  " }), {
    progressNote: "Xong form",
  });
  assert.deepStrictEqual(v({ progress_note: "   " }), { progressNote: null });
  assert.deepStrictEqual(v({ progress_note: null }), { progressNote: null });
  const max = service.PROGRESS_NOTE_MAX_LENGTH;
  assert.strictEqual(
    v({ progress_note: "x".repeat(max) }).progressNote.length,
    max,
  );

  bad(null);
  bad([]);
  bad("x");
  bad({});
  bad({ status: "LATE" });
  bad({ progress_percent: -1 });
  bad({ progress_percent: 101 });
  bad({ progress_percent: 1.5 });
  bad({ progress_percent: "50" });
  bad({ progress_percent: null });
  bad({ progress_note: 5 });
  bad({ progress_note: "x".repeat(max + 1) });
  bad({ status: "DONE", progress_percent: 40 });
  // Trường intern không được sửa, kể cả khi gửi kèm trường hợp lệ
  for (const field of ["title", "description", "due_date", "priority", "id"]) {
    bad({ progress_percent: 10, [field]: "x" });
  }
}

async function testInternProgress() {
  const a = internUser("a@test.local");
  const b = internUser("b@test.local");
  const mine = await createAs(mentor1, {
    intern_id: 10,
    title: "Việc tiến độ",
  });
  const otherInterns = await createAs(mentor2, {
    intern_id: 11,
    title: "Của B",
  });
  assert.strictEqual(mine.progress_percent, 0);
  assert.strictEqual(mine.progress_note, "");
  assert.strictEqual(mine.progress_updated_at, null);

  const up = (user, id, body) => service.updateMyTaskProgress(user, id, body);

  // Cập nhật hợp lệ
  let dto = await up(a, mine.id, {
    progress_percent: 40,
    progress_note: "Xong UI",
  });
  assert.strictEqual(dto.status, "IN_PROGRESS");
  assert.strictEqual(dto.progress_percent, 40);
  assert.strictEqual(dto.progress_note, "Xong UI");
  assert.ok(dto.progress_updated_at, "Phải ghi thời điểm cập nhật");
  assert.strictEqual(dto.title, "Việc tiến độ", "Không đổi tiêu đề");

  // Mentor phụ trách thấy tiến độ; filter theo status
  let list = await service.listTasksForMentor(mentor1, {
    status: "IN_PROGRESS",
  });
  const seen = list.find((t) => t.id === mine.id);
  assert.ok(seen);
  assert.strictEqual(seen.progress_percent, 40);
  assert.strictEqual(seen.progress_note, "Xong UI");
  list = await service.listTasksForMentor(mentor1, { status: "DONE" });
  assert.ok(!list.some((t) => t.id === mine.id));
  await rejects(
    service.listTasksForMentor(mentor1, { status: "LATE" }),
    400,
    "filter status sai",
  );
  // Mentor khác không thấy
  list = await service.listTasksForMentor(mentor2);
  assert.ok(!list.some((t) => t.id === mine.id));

  // Hoàn thành rồi xóa ghi chú
  dto = await up(a, mine.id, { status: "DONE", progress_note: null });
  assert.strictEqual(dto.status, "DONE");
  assert.strictEqual(dto.progress_percent, 100);
  assert.strictEqual(dto.progress_note, "");
  assert.strictEqual(dto.is_overdue, false);

  // Mở lại việc
  dto = await up(a, mine.id, { status: "IN_PROGRESS" });
  assert.strictEqual(dto.progress_percent, 99);

  // Mentor đổi status thì % khớp theo
  const byMentor = await service.updateTask(mentor1, mine.id, {
    status: "DONE",
  });
  assert.strictEqual(byMentor.progress_percent, 100);
  const reset = await service.updateTask(mentor1, mine.id, { status: "TODO" });
  assert.strictEqual(reset.progress_percent, 0);
  // Mentor sửa trường khác không làm đổi tiến độ
  await up(a, mine.id, { progress_percent: 60 });
  const rename = await service.updateTask(mentor1, mine.id, {
    title: "Đổi tên",
  });
  assert.strictEqual(rename.progress_percent, 60);

  // Lỗi quyền / dữ liệu
  const stored = tasks.find((t) => t.id === mine.id);
  const snapshot = JSON.stringify(stored);
  await rejects(
    up(b, mine.id, { progress_percent: 90 }),
    403,
    "việc của intern khác",
  );
  await rejects(
    up(a, otherInterns.id, { progress_percent: 90 }),
    403,
    "việc của B",
  );
  await rejects(up(a, 9999, { progress_percent: 90 }), 404, "không tồn tại");
  await rejects(up(a, "abc", { progress_percent: 90 }), 400, "id sai");
  await rejects(up(a, mine.id, {}), 400, "body rỗng");
  await rejects(up(a, mine.id, { title: "Hack" }), 400, "sửa tiêu đề");
  await rejects(
    up(a, mine.id, { status: "DONE", progress_percent: 5 }),
    400,
    "mâu thuẫn",
  );
  await rejects(
    up(internUser("ghost@test.local"), mine.id, { status: "DONE" }),
    404,
    "chưa có hồ sơ",
  );
  await rejects(
    up({ role: "Intern" }, mine.id, { status: "DONE" }),
    404,
    "token thiếu email",
  );
  assert.strictEqual(
    JSON.stringify(stored),
    snapshot,
    "Lỗi không được đổi dữ liệu",
  );
}

(async () => {
  testValidateInput();
  testResolveProgress();
  testValidateProgress();
  testDto();
  const made = await testCreate();
  const taskB = await testList();
  await testUpdate(made);
  await testInternView(taskB);
  await testReassignAndDelete(made);
  await testInternProgress();
  console.log("PASS test_tasks_unit");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
