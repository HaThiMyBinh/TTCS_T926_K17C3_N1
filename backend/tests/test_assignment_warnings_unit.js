// Unit test: cảnh báo mềm khi phân công mentor + xem/gán thực tập sinh từ phía mentor (không cần MySQL).
const assert = require("assert");
const express = require("express");
const db = require("../db");
const warn = require("../services/assignmentWarnings.service");
const mentorInterns = require("../services/mentorInterns.service");

const saved = {};
const stub = (over) => {
  for (const k of Object.keys(over)) {
    if (!(k in saved)) saved[k] = db[k];
    db[k] = over[k];
  }
};
const quiet = console.error;
console.error = () => {};
const rejects = async (p, status, label) => {
  try {
    await p;
  } catch (e) {
    assert.strictEqual(e.status, status, `${label}: ${e.status} ${e.message}`);
    return e;
  }
  assert.fail(`${label}: phải bị từ chối`);
};

(async () => {
  // ---------- module thuần ----------
  const mentor = { fullName: "Hà", department: "Kinh doanh" };
  const i = (id, name, status = "Đang thực tập") => ({
    id,
    fullName: name,
    status,
  });
  assert.deepStrictEqual(
    warn.assignmentWarnings({ mentor, interns: [i(1, "An")] }),
    [],
    "bình thường -> không cảnh báo",
  );
  let w = warn.assignmentWarnings({
    mentor,
    interns: [i(1, "An", "Hoàn thành")],
  });
  assert.deepStrictEqual(
    w.map((x) => x.type),
    ["INACTIVE_INTERN"],
  );
  assert.match(w[0].message, /An đang ở trạng thái "Hoàn thành"/);
  w = warn.assignmentWarnings({
    mentor,
    interns: [i(1, "An", "Tạm dừng"), i(2, "Bình", "Hoàn thành"), i(3, "Chi")],
  });
  assert.match(w[0].message, /2 thực tập sinh không ở trạng thái.*An, Bình/);
  assert.deepStrictEqual(w[0].internIds, [1, 2]);
  // phòng ban: chỉ cảnh báo khi biết cả hai phía và khác nhau
  const deps = new Map([
    [1, ["Truyền thông"]],
    [2, ["kinh doanh "]],
    [3, ["Nhân sự", "Kinh doanh"]],
  ]);
  w = warn.assignmentWarnings({
    mentor,
    interns: [i(1, "An"), i(2, "Bình"), i(3, "Chi"), i(4, "Dũng")],
    programDepartments: deps,
  });
  assert.deepStrictEqual(
    w.map((x) => x.type),
    ["DEPARTMENT_MISMATCH"],
  );
  assert.deepStrictEqual(
    w[0].internIds,
    [1],
    "khớp (không phân biệt hoa/thường, khoảng trắng), khớp một trong nhiều CT, hoặc chưa thuộc CT nào thì không cảnh báo",
  );
  assert.match(w[0].message, /"Kinh doanh".*An/);
  for (const unknown of [undefined, "", "Chưa cập nhật"])
    assert.deepStrictEqual(
      warn.assignmentWarnings({
        mentor: { fullName: "X", department: unknown },
        interns: [i(1, "An")],
        programDepartments: deps,
      }),
      [],
      `mentor chưa có phòng ban (${unknown})`,
    );
  w = warn.assignmentWarnings({
    mentor,
    interns: Array.from({ length: 8 }, (_, k) =>
      i(k + 1, `T${k + 1}`, "Hoàn thành"),
    ),
  });
  assert.match(w[0].message, /T5 và 3 người khác/);
  // xác nhận
  assert.strictEqual(warn.parseConfirm(undefined), false);
  assert.strictEqual(warn.parseConfirm(true), true);
  assert.throws(
    () => warn.parseConfirm("true"),
    (e) => e.status === 400,
  );
  warn.requireConfirmation([], false);
  const err = await (async () => {
    try {
      warn.requireConfirmation([{ type: "X", message: "m" }], false);
    } catch (e) {
      return e;
    }
  })();
  assert.ok(
    err &&
      err.status === 409 &&
      err.extra.code === "NEEDS_CONFIRMATION" &&
      err.extra.warnings[0].message === "m",
  );
  warn.requireConfirmation([{ type: "X", message: "m" }], true);

  // ---------- xem / gán từ phía mentor ----------
  const profiles = {
    1: {
      id: 1,
      fullName: "An",
      email: "a@x.vn",
      status: "Đang thực tập",
      mentorId: null,
    },
    2: {
      id: 2,
      fullName: "Bình",
      email: "b@x.vn",
      status: "Hoàn thành",
      mentorId: 5,
    },
    3: {
      id: 3,
      fullName: "Chi",
      email: "c@x.vn",
      status: "Đang thực tập",
      mentorId: 9,
    }, // đã thuộc mentor 9
  };
  const calls = [],
    pushed = [];
  stub({
    findMentorById: async (id) =>
      id === 9 ? { id: 9, fullName: "Hà", department: "Kinh doanh" } : null,
    listMentorInterns: async (id) => [{ id: 3, mentorId: id }],
    listInternsNotOfMentor: async () => [{ id: 1 }],
    findInternProfileById: async (id) => profiles[id] || null,
    listProgramDepartmentsForInterns: async () => new Map(),
    assignMentorToInterns: async (mid, ids) => {
      calls.push([mid, ids]);
      return {
        outcome: "UPDATED",
        mentorName: "Hà",
        unchanged: 1,
        changed: [
          { id: 1, email: "a@x.vn", mentorId: null },
          { id: 2, email: "b@x.vn", mentorId: 5 },
        ],
      };
    },
    findMentorUserId: async (id) => 100 + id,
    findUserByEmail: async (e) => ({ id: e === "a@x.vn" ? 11 : 12 }),
    createNotifications: async (ids, n) => {
      pushed.push([ids, n.type]);
      return ids.length;
    },
  });
  assert.deepStrictEqual(await mentorInterns.list("9"), [
    { id: 3, mentorId: 9 },
  ]);
  assert.deepStrictEqual(await mentorInterns.available("9"), [{ id: 1 }]);
  await rejects(mentorInterns.list("77"), 404, "mentor không tồn tại");
  await rejects(mentorInterns.list("abc"), 400, "id sai");
  for (const [label, body] of [
    ["null", null],
    ["thiếu", {}],
    ["rỗng", { intern_ids: [] }],
    ["trùng", { intern_ids: [1, 1] }],
    ["sai kiểu", { intern_ids: ["1"] }],
    ["trường lạ", { intern_ids: [1], x: 1 }],
    ["confirm sai", { intern_ids: [1], confirm_warnings: "yes" }],
  ])
    await rejects(mentorInterns.assign("9", body), 400, label);
  await rejects(
    mentorInterns.assign("9", { intern_ids: [1, 99] }),
    400,
    "thực tập sinh không tồn tại",
  );
  // Bình đã "Hoàn thành" -> cần xác nhận; Chi đã thuộc mentor 9 nên không bị tính vào cảnh báo
  const e409 = await rejects(
    mentorInterns.assign("9", { intern_ids: [1, 2, 3] }),
    409,
    "cần xác nhận",
  );
  assert.strictEqual(e409.extra.code, "NEEDS_CONFIRMATION");
  assert.match(
    e409.extra.warnings[0].message,
    /Bình đang ở trạng thái "Hoàn thành"/,
  );
  assert.strictEqual(calls.length, 0, "chưa xác nhận thì không chạm DB");
  // không ai thật sự đổi -> không cảnh báo
  await mentorInterns.assign("9", { intern_ids: [3] });
  assert.strictEqual(calls.length, 1);
  calls.length = 0;
  pushed.length = 0;
  const ok = await mentorInterns.assign("9", {
    intern_ids: [1, 2, 3],
    confirm_warnings: true,
  });
  assert.deepStrictEqual(ok, {
    mentor_id: 9,
    mentor_name: "Hà",
    updated: 2,
    unchanged: 1,
  });
  assert.deepStrictEqual(calls[0], [9, [1, 2, 3]]);
  assert.deepStrictEqual(pushed.map((p) => p[1]).sort(), [
    "MENTOR_ASSIGNED",
    "MENTOR_ASSIGNED_TO_ME",
    "MENTOR_ASSIGNED_TO_ME",
    "MENTOR_UNASSIGNED",
  ]);

  // ---------- route gán từng người (PUT /interns/:id/mentor) ----------
  const router = require("../routes/interns.routes");
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { role: "HR", id: 1, email: "hr@x.vn" };
    next();
  });
  app.use("/api", router);
  const server = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const put = async (id, body) => {
    const r = await fetch(`${base}/interns/${id}/mentor`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  let assigned = 0;
  stub({
    assignInternMentor: async (id, mid) => {
      assigned++;
      return {
        outcome: "UPDATED",
        student: { id, mentorId: mid, mentorName: "Hà" },
      };
    },
  });
  let r = await put(2, { mentor_id: 9 });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.code, "NEEDS_CONFIRMATION");
  assert.match(r.body.warnings[0].message, /Hoàn thành/);
  assert.strictEqual(assigned, 0);
  r = await put(2, { mentor_id: 9, confirm_warnings: true });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(assigned, 1);
  assert.strictEqual(
    (await put(1, { mentor_id: 9 })).status,
    200,
    "người đang thực tập: không cảnh báo",
  );
  assert.strictEqual(
    (await put(3, { mentor_id: 9 })).status,
    200,
    "không đổi mentor: không cảnh báo",
  );
  assert.strictEqual(
    (await put(2, { mentor_id: null })).status,
    200,
    "gỡ mentor: không cảnh báo",
  );
  assert.strictEqual(
    (await put(2, { mentor_id: 9, confirm_warnings: "x" })).status,
    400,
  );
  // lệch phòng ban
  stub({
    listProgramDepartmentsForInterns: async () =>
      new Map([[1, ["Truyền thông"]]]),
  });
  r = await put(1, { mentor_id: 9 });
  assert.strictEqual(r.status, 409);
  assert.match(r.body.warnings[0].message, /phòng ban "Kinh doanh"/);
  server.close();

  // ---------- phân công theo chương trình: cảnh báo ----------
  const programs = require("../services/programs.service");
  const progCalls = [];
  stub({
    findProgramById: async () => ({
      id: 3,
      name: "Hè",
      department_name: "Truyền thông",
    }),
    listProgramInterns: async () => [
      { id: 1, status: "Đang thực tập", mentorId: null, fullName: "An" },
      { id: 2, status: "Tạm dừng", mentorId: null, fullName: "Bình" },
      { id: 4, status: "Đang thực tập", mentorId: 9, fullName: "Dũng" },
    ],
    assignProgramInternsMentor: async (...a) => {
      progCalls.push(a);
      return {
        outcome: "UPDATED",
        mentorName: "Hà",
        changed: [],
        unchanged: 0,
      };
    },
  });
  const e2 = await rejects(
    programs.assignMentor("3", { mentor_id: 9 }),
    409,
    "chương trình: cần xác nhận",
  );
  assert.deepStrictEqual(
    e2.extra.warnings.map((x) => x.type),
    ["INACTIVE_INTERN", "DEPARTMENT_MISMATCH"],
  );
  assert.ok(
    !/Dũng/.test(e2.extra.warnings.map((x) => x.message).join()),
    "Dũng đã thuộc mentor 9 nên không tính",
  );
  assert.strictEqual(progCalls.length, 0);
  await programs.assignMentor("3", { mentor_id: 9, intern_ids: [4] }); // chỉ chọn người không đổi -> không cảnh báo
  await programs.assignMentor("3", { mentor_id: 9, confirm_warnings: true });
  await programs.assignMentor("3", { mentor_id: null });
  assert.strictEqual(progCalls.length, 3);
  await rejects(
    programs.assignMentor("3", { mentor_id: 9, confirm_warnings: 1 }),
    400,
    "confirm sai kiểu",
  );

  console.error = quiet;
  console.log(
    "ASSIGNMENT WARNINGS UNIT: warnings/mentor-side/route/program PASS",
  );
})()
  .catch((e) => {
    console.error = quiet;
    console.error(e);
    process.exit(1);
  })
  .finally(() => Object.assign(db, saved));
