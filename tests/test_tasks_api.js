// Integration API test: Mentor giao nhiệm vụ cho thực tập sinh.
// Cần MySQL + backend, chạy qua `npm test` hoặc `npm run test:tasks-api`.
const mysql = require("mysql2/promise");
const {
  BASE_URL,
  loginAs,
  readDbConfig,
  cleanupTestData,
} = require("./test_helpers");
const { getVietnamToday } = require("../utils/date");

const RUN_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const PREFIX = `task_test_${RUN_ID}`;
let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(` [PASS] ${name}`);
  } else {
    failed += 1;
    console.error(` [FAIL] ${name}${detail ? `: ${detail}` : ""}`);
  }
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

async function call(method, url, token, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${url}`, {
    method,
    headers,
    body: payload,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

// Gọi API, kiểm tra mã HTTP rồi trả về response để kiểm tra tiếp.
async function expectStatus(name, code, method, url, token, body) {
  const res = await call(method, url, token, body);
  check(name, res.status === code, `nhận ${res.status}`);
  return res;
}

async function loginUser(email, password = "password123") {
  const res = await call("POST", "/auth/login", null, {
    account: email,
    password,
  });
  if (res.status !== 200 || !res.body?.token) {
    const detail = JSON.stringify(res.body);
    throw new Error(`Đăng nhập thất bại (${email}): ${detail}`);
  }
  return res.body.token;
}

async function createIntern(hrToken, label) {
  const email = `${PREFIX}_${label}@ictu.edu.vn`;
  const res = await call("POST", "/interns", hrToken, {
    fullName: `Intern Task ${label}`,
    email,
    studentCode: `T${label}${Date.now().toString().slice(-5)}`,
    university: "ICTU University",
    major: "Kỹ thuật phần mềm",
  });
  if (res.status !== 201) {
    const detail = JSON.stringify(res.body);
    throw new Error(`Tạo intern ${label} thất bại: ${detail}`);
  }
  return { id: Number((res.body.intern || res.body.student).id), email };
}

async function assignMentor(hrToken, internId, mentorId) {
  const res = await call("PUT", `/interns/${internId}/mentor`, hrToken, {
    mentor_id: mentorId,
  });
  if (res.status !== 200) {
    throw new Error(`Phân công mentor thất bại: ${JSON.stringify(res.body)}`);
  }
}

// Dựng dữ liệu: mentor 2, thực tập sinh A, B (mentor 1), C (mentor 2), D (chưa phân công).
async function setup(conn, emails) {
  const adminToken = await loginAs("Admin");
  const hrToken = await loginAs("HR");
  const mentor1Token = await loginAs("Mentor");

  const mentor2Email = `${PREFIX}_mentor2@ictu.edu.vn`;
  emails.push(mentor2Email);
  const mentorRes = await call("POST", "/users", adminToken, {
    name: "Mentor Task Hai",
    email: mentor2Email,
    password: "password123",
    role: "Mentor",
  });
  if (![200, 201].includes(mentorRes.status)) {
    const detail = JSON.stringify(mentorRes.body);
    throw new Error(`Không tạo được mentor 2: ${detail}`);
  }
  const mentor2Token = await loginUser(mentor2Email);

  const [m1] = await conn.query(
    "SELECT id FROM mentors WHERE LOWER(email) = LOWER(?)",
    ["mentor@gmail.com"],
  );
  const [m2] = await conn.query(
    "SELECT id FROM mentors WHERE LOWER(email) = LOWER(?)",
    [mentor2Email],
  );
  if (!m1.length || !m2.length) throw new Error("Thiếu hồ sơ mentor để test");
  const mentor1Id = Number(m1[0].id);
  const mentor2Id = Number(m2[0].id);

  const interns = {};
  for (const label of ["a", "b", "c", "d"]) {
    interns[label] = await createIntern(hrToken, label);
    emails.push(interns[label].email);
  }
  await assignMentor(hrToken, interns.a.id, mentor1Id);
  await assignMentor(hrToken, interns.b.id, mentor1Id);
  await assignMentor(hrToken, interns.c.id, mentor2Id);

  return {
    adminToken,
    hrToken,
    mentor1Token,
    mentor2Token,
    mentor2Id,
    interns,
    internAToken: await loginUser(interns.a.email),
    internBToken: await loginUser(interns.b.email),
  };
}

async function testPermissions(ctx) {
  const { hrToken, adminToken, mentor1Token, internAToken, interns } = ctx;
  const probe = { intern_id: interns.a.id, title: "Không được giao" };
  const noToken = (name, method, url, body) =>
    expectStatus(name, 401, method, url, null, body);
  const forbid = (name, token, method, url, body) =>
    expectStatus(name, 403, method, url, token, body);
  await noToken("GET /tasks không token", "GET", "/tasks");
  await noToken("POST /tasks không token", "POST", "/tasks", probe);
  await noToken("GET /me/tasks không token", "GET", "/me/tasks");
  const roles = [
    ["HR", hrToken],
    ["Admin", adminToken],
    ["Intern", internAToken],
  ];
  for (const [role, token] of roles) {
    await forbid(`GET /tasks với ${role}`, token, "GET", "/tasks");
    await forbid(`POST /tasks với ${role}`, token, "POST", "/tasks", probe);
  }
  await forbid("GET /me/tasks với Mentor", mentor1Token, "GET", "/me/tasks");
  await forbid("GET /me/tasks với HR", hrToken, "GET", "/me/tasks");
}

async function testCreate(ctx, conn) {
  const { mentor1Token, mentor2Token, interns } = ctx;
  const tomorrow = addDays(getVietnamToday(), 1);
  const create = await call("POST", "/tasks", mentor1Token, {
    intern_id: interns.a.id,
    title: "  Xây dựng trang đăng nhập  ",
    description: "Dùng HTML/CSS, gọi API /auth/login",
    due_date: tomorrow,
    priority: "HIGH",
  });
  const taskA = create.body?.data;
  check(
    "Mentor giao việc cho intern của mình -> 201",
    create.status === 201 && create.body?.success === true,
  );
  check(
    "Tiêu đề được trim, trạng thái mặc định TODO",
    taskA?.title === "Xây dựng trang đăng nhập" && taskA?.status === "TODO",
  );
  check(
    "Lưu đúng intern, hạn, ưu tiên",
    taskA?.intern_id === interns.a.id &&
      taskA?.due_date === tomorrow &&
      taskA?.priority === "HIGH",
  );
  const [rows] = await conn.query(
    "SELECT created_by_mentor_id FROM intern_tasks WHERE id = ?",
    [taskA?.id],
  );
  const mentor1Id = Number(rows[0]?.created_by_mentor_id);
  check("DB ghi nhận mentor đã giao", rows.length === 1 && mentor1Id > 0);

  const minimal = await call("POST", "/tasks", mentor1Token, {
    intern_id: interns.b.id,
    title: "Đọc tài liệu onboarding",
  });
  const min = minimal.body?.data;
  check(
    "Chỉ cần tiêu đề: ưu tiên MEDIUM, không có hạn",
    minimal.status === 201 &&
      min?.priority === "MEDIUM" &&
      min?.due_date === null,
  );

  const forC = await call("POST", "/tasks", mentor2Token, {
    intern_id: interns.c.id,
    title: "Việc của intern C",
  });
  check("Mentor 2 giao cho intern của mình -> 201", forC.status === 201);
  return { taskA, taskB: min, taskC: forC.body?.data };
}

async function testCreateErrors(ctx, conn) {
  const { mentor1Token, interns } = ctx;
  const today = getVietnamToday();
  const post = (name, code, body) =>
    expectStatus(name, code, "POST", "/tasks", mentor1Token, body);
  const withA = (extra) => ({ intern_id: interns.a.id, ...extra });

  await post("Thiếu tiêu đề", 400, withA({ title: "   " }));
  await post("Tiêu đề quá 255 ký tự", 400, withA({ title: "x".repeat(256) }));
  const past = addDays(today, -1);
  await post("Hạn là ngày đã qua", 400, withA({ title: "x", due_date: past }));
  const badFormat = withA({ title: "x", due_date: "31/12/2030" });
  await post("Hạn sai định dạng", 400, badFormat);
  const noDay = withA({ title: "x", due_date: "2030-02-30" });
  await post("Ngày không tồn tại", 400, noDay);
  await post("Mức ưu tiên sai", 400, withA({ title: "x", priority: "URGENT" }));
  await post("Thiếu intern_id", 400, { title: "x" });
  await post("intern_id sai định dạng", 400, { intern_id: "abc", title: "x" });
  await post("Giao cho intern mentor khác", 403, {
    intern_id: interns.c.id,
    title: "x",
  });
  await post("Giao cho intern chưa phân công", 403, {
    intern_id: interns.d.id,
    title: "x",
  });
  await post("Giao cho intern không tồn tại", 404, {
    intern_id: 999999999,
    title: "x",
  });

  const ids = Object.values(interns).map((i) => i.id);
  const [count] = await conn.query(
    "SELECT COUNT(*) AS n FROM intern_tasks WHERE intern_id IN (?)",
    [ids],
  );
  const total = Number(count[0].n);
  check("Yêu cầu lỗi không tạo thêm nhiệm vụ", total === 3, `có ${total}`);
}

async function testLists(ctx, tasks) {
  const { mentor1Token, mentor2Token, internAToken, internBToken } = ctx;
  const { interns } = ctx;
  const { taskA, taskB, taskC } = tasks;

  const list1 = await call("GET", "/tasks", mentor1Token);
  const ids1 = (list1.body?.data || []).map((t) => t.id);
  check(
    "Mentor 1 thấy việc của A và B, không thấy của C",
    list1.status === 200 &&
      ids1.includes(taskA.id) &&
      ids1.includes(taskB.id) &&
      !ids1.includes(taskC.id),
  );
  const q = (id) => `/tasks?intern_id=${id}`;
  const byA = await call("GET", q(interns.a.id), mentor1Token);
  const listA = byA.body?.data || [];
  check(
    "Lọc theo intern_id chỉ trả việc của intern đó",
    byA.status === 200 && listA.length === 1 && listA[0].id === taskA.id,
  );
  const byC = await call("GET", q(interns.c.id), mentor1Token);
  check(
    "Lọc theo intern của mentor khác -> rỗng",
    byC.status === 200 && byC.body.data.length === 0,
  );
  const get = (name, code, url, token) =>
    expectStatus(name, code, "GET", url, token);
  await get("intern_id sai định dạng", 400, q("abc"), mentor1Token);
  const list2 = await call("GET", "/tasks", mentor2Token);
  check(
    "Mentor 2 chỉ thấy việc của mình",
    list2.status === 200 &&
      list2.body.data.length === 1 &&
      list2.body.data[0].id === taskC.id,
  );

  const mineA = await call("GET", "/me/tasks", internAToken);
  const dataA = mineA.body?.data || [];
  check(
    "Intern A thấy đúng nhiệm vụ được giao",
    mineA.status === 200 &&
      dataA.length === 1 &&
      dataA[0].id === taskA.id &&
      dataA[0].title === "Xây dựng trang đăng nhập",
  );
  const mineB = await call("GET", "/me/tasks", internBToken);
  const dataB = mineB.body?.data || [];
  check(
    "Intern B không thấy việc của intern A",
    mineB.status === 200 &&
      dataB.length === 1 &&
      dataB.every((t) => t.intern_id === interns.b.id),
  );
}

async function testUpdate(ctx, tasks) {
  const { mentor1Token, mentor2Token, internAToken } = ctx;
  const url = `/tasks/${tasks.taskA.id}`;
  const today = getVietnamToday();
  const tomorrow = addDays(today, 1);

  const patch = await call("PATCH", url, mentor1Token, {
    status: "IN_PROGRESS",
    priority: "LOW",
    title: "Trang đăng nhập (v2)",
  });
  const d = patch.body?.data;
  check(
    "Mentor cập nhật nhiệm vụ -> 200",
    patch.status === 200 &&
      d?.status === "IN_PROGRESS" &&
      d?.priority === "LOW" &&
      d?.title === "Trang đăng nhập (v2)",
  );
  check(
    "Trường không gửi được giữ nguyên",
    d?.due_date === tomorrow && d?.description.includes("HTML/CSS"),
  );
  const clear = await call("PATCH", url, mentor1Token, { due_date: null });
  check(
    "Có thể bỏ hạn hoàn thành (null)",
    clear.status === 200 && clear.body.data.due_date === null,
  );

  const patchAs = (name, code, token, body, target = url) =>
    expectStatus(name, code, "PATCH", target, token, body);
  await patchAs("Cập nhật body rỗng", 400, mentor1Token, {});
  await patchAs("Trạng thái sai", 400, mentor1Token, { status: "LATE" });
  const past = { due_date: addDays(today, -1) };
  await patchAs("Hạn đổi sang ngày đã qua", 400, mentor1Token, past);
  const edit = { title: "x" };
  const missing = "/tasks/999999999";
  const badId = "/tasks/abc";
  await patchAs("Mentor khác sửa nhiệm vụ", 403, mentor2Token, edit);
  await patchAs("Việc không tồn tại", 404, mentor1Token, edit, missing);
  await patchAs("Mã nhiệm vụ sai", 400, mentor1Token, edit, badId);
  const done = { status: "DONE" };
  await patchAs("Intern không sửa được", 403, internAToken, done);
}

async function testReassignAndDelete(ctx, conn, tasks) {
  const { hrToken, mentor1Token, mentor2Token, internBToken, interns } = ctx;
  const { taskA, taskB } = tasks;
  const patch = (token, body) =>
    call("PATCH", `/tasks/${taskA.id}`, token, body);

  const move = await call("PUT", `/interns/${interns.a.id}/mentor`, hrToken, {
    mentor_id: ctx.mentor2Id,
  });
  check("HR đổi mentor của intern A sang mentor 2", move.status === 200);
  const oldMentor = await patch(mentor1Token, { title: "Mentor cũ" });
  check("Mentor cũ mất quyền với việc của intern A", oldMentor.status === 403);
  const after = await call("GET", "/tasks", mentor1Token);
  check(
    "Mentor cũ không còn thấy việc của intern A",
    after.body.data.every((t) => t.intern_id !== interns.a.id),
  );
  const newMentor = await patch(mentor2Token, { status: "DONE" });
  check("Mentor mới quản lý được nhiệm vụ đó", newMentor.status === 200);

  const url = `/tasks/${taskB.id}`;
  const del = (name, code, token) =>
    expectStatus(name, code, "DELETE", url, token);
  await del("Mentor khác xóa nhiệm vụ", 403, mentor2Token);
  await del("Mentor xóa việc của intern mình", 200, mentor1Token);
  await del("Xóa lần hai", 404, mentor1Token);
  const mineB = await call("GET", "/me/tasks", internBToken);
  check("Việc đã xóa biến mất khỏi danh sách", mineB.body.data.length === 0);

  // Xóa hồ sơ intern thì nhiệm vụ bị xóa theo (ON DELETE CASCADE)
  const delIntern = await call("DELETE", `/interns/${interns.c.id}`, hrToken);
  const [cascade] = await conn.query(
    "SELECT COUNT(*) AS n FROM intern_tasks WHERE intern_id = ?",
    [interns.c.id],
  );
  check(
    "Xóa hồ sơ intern kéo theo xóa nhiệm vụ",
    delIntern.status === 200 && Number(cascade[0].n) === 0,
  );
}

async function run() {
  console.log("\n====================================================");
  console.log(" BẮT ĐẦU INTEGRATION TEST GIAO NHIỆM VỤ (API)");
  console.log("====================================================\n");

  const emails = [];
  const conn = await mysql.createConnection(readDbConfig());
  try {
    const ctx = await setup(conn, emails);
    await testPermissions(ctx);
    const tasks = await testCreate(ctx, conn);
    await testCreateErrors(ctx, conn);
    await testLists(ctx, tasks);
    await testUpdate(ctx, tasks);
    await testReassignAndDelete(ctx, conn, tasks);
  } catch (err) {
    failed += 1;
    console.error(" [FAIL] Lỗi không mong đợi:", err);
  } finally {
    await conn.end();
    await cleanupTestData(emails);
  }

  console.log(`\n${passed} pass, ${failed} fail\n`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
