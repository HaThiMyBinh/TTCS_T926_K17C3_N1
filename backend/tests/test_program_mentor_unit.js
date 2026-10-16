// Unit test US12: HR phân công thực tập sinh của một chương trình cho mentor (không cần MySQL).
const assert = require("assert");
const db = require("../db");
const service = require("../services/programs.service");

const original = {};
function stub(over) {
  for (const k of Object.keys(over)) {
    if (!(k in original)) original[k] = db[k];
    db[k] = over[k];
  }
}
async function rejects(promise, status, label) {
  try {
    await promise;
  } catch (err) {
    assert.strictEqual(
      err.status,
      status,
      `${label}: mã lỗi ${err.status} (${err.message})`,
    );
    return;
  }
  assert.fail(`${label}: phải bị từ chối`);
}

const program = { id: 3, name: "Hè 2026" };
const pushed = [];
const deps = {
  db: {
    findMentorUserId: async (id) => 100 + id,
    findUserByEmail: async (e) => ({ id: e === "a@x.vn" ? 11 : 12 }),
  },
  pushSafe: async (ids, n) => {
    pushed.push([ids, n.type, n.message]);
    return ids.length;
  },
};
let calls = [];

(async () => {
  stub({
    findProgramById: async (id) => (id === 3 ? program : null),
    listProgramInterns: async (id) => [{ id: 1 }],
    findMentorById: async (id) => ({
      id,
      fullName: "Mentor B",
      department: "",
    }),
    assignProgramInternsMentor: async (pid, mid, ids) => {
      calls.push([pid, mid, ids]);
      return {
        outcome: "UPDATED",
        mentorName: "Mentor B",
        unchanged: 1,
        changed: [
          { id: 1, email: "a@x.vn", mentorId: 5 },
          { id: 2, email: "b@x.vn", mentorId: 5 },
          { id: 4, email: "c@x.vn", mentorId: null },
        ],
      };
    },
  });

  // listInterns
  assert.deepStrictEqual(await service.listInterns("3"), [{ id: 1 }]);
  await rejects(service.listInterns("9"), 404, "chương trình không tồn tại");
  await rejects(service.listInterns("abc"), 400, "id sai");

  // kiểm tra đầu vào
  for (const [label, body] of [
    ["thiếu mentor_id", { intern_ids: [1] }],
    ["mentor_id chuỗi", { mentor_id: "5" }],
    ["mentor_id 0", { mentor_id: 0 }],
    ["trường lạ", { mentor_id: 5, x: 1 }],
    ["intern_ids rỗng", { mentor_id: 5, intern_ids: [] }],
    ["intern_ids không phải mảng", { mentor_id: 5, intern_ids: 1 }],
    ["intern_ids trùng", { mentor_id: 5, intern_ids: [1, 1] }],
    ["intern_ids sai kiểu", { mentor_id: 5, intern_ids: ["1"] }],
    ["body null", null],
    [
      "quá 500",
      {
        mentor_id: 5,
        intern_ids: Array.from({ length: 501 }, (_, i) => i + 1),
      },
    ],
  ])
    await rejects(service.assignMentor("3", body, deps), 400, label);
  await rejects(
    service.assignMentor("9", { mentor_id: 5 }, deps),
    404,
    "chương trình không tồn tại",
  );
  assert.strictEqual(calls.length, 0, "đầu vào sai không được chạm DB");

  // gán thành công + thông báo gộp
  const res = await service.assignMentor(
    "3",
    { mentor_id: 6, intern_ids: [1, 2, 4, 7] },
    deps,
  );
  assert.deepStrictEqual(res, {
    mentor_id: 6,
    mentor_name: "Mentor B",
    updated: 3,
    unchanged: 1,
  });
  assert.deepStrictEqual(calls.pop(), [3, 6, [1, 2, 4, 7]]);
  assert.deepStrictEqual(
    pushed.map((p) => [p[0], p[1]]),
    [
      [[106], "MENTOR_ASSIGNED"],
      [[105], "MENTOR_UNASSIGNED"],
      [[11], "MENTOR_ASSIGNED_TO_ME"],
      [[12], "MENTOR_ASSIGNED_TO_ME"],
      [[12], "MENTOR_ASSIGNED_TO_ME"],
    ],
  );
  assert.match(pushed[0][2], /3 thực tập sinh.*Hè 2026/);
  assert.match(pushed[1][2], /không còn phụ trách 2 thực tập sinh/);

  // không gửi intern_ids = cả chương trình; null = gỡ mentor
  await service.assignMentor("3", { mentor_id: null }, deps);
  assert.deepStrictEqual(calls.pop(), [3, null, null]);

  // ---- HR tự xếp thực tập sinh vào chương trình ----
  stub({
    listInternsNotInProgram: async () => [{ id: 9 }],
    addProgramInterns: async (pid, ids, uid) => {
      calls.push(["add", pid, ids, uid]);
      return { outcome: "ADDED", added: [ids[0]], already: ids.length - 1 };
    },
    removeProgramIntern: async (pid, iid) => (iid === 1 ? 1 : 0),
    findInternProfileById: async (id) => ({ id, email: "a@x.vn" }),
    findUserByEmail: async () => ({ id: 11 }),
  });
  assert.deepStrictEqual(await service.listAvailableInterns("3"), [{ id: 9 }]);
  await rejects(
    service.listAvailableInterns("9"),
    404,
    "available: chương trình không tồn tại",
  );
  for (const [label, body] of [
    ["thiếu intern_ids", {}],
    ["rỗng", { intern_ids: [] }],
    ["trùng", { intern_ids: [1, 1] }],
    ["sai kiểu", { intern_ids: ["1"] }],
    ["trường lạ", { intern_ids: [1], mentor_id: 2 }],
    ["null", null],
  ])
    await rejects(
      service.addInterns("3", body, { id: 1 }, deps),
      400,
      `add: ${label}`,
    );
  await rejects(
    service.addInterns("9", { intern_ids: [1] }, { id: 1 }, deps),
    404,
    "add: chương trình không tồn tại",
  );
  pushed.length = 0;
  assert.deepStrictEqual(
    await service.addInterns(
      "3",
      { intern_ids: [4, 5] },
      { id: 7 },
      {
        db: {
          findInternProfileById: async (id) => ({ id, email: "a@x.vn" }),
          findUserByEmail: async () => ({ id: 11 }),
        },
        pushSafe: async (ids, n) => {
          pushed.push([ids, n.type]);
          return 1;
        },
      },
    ),
    { added: 1, already: 1 },
  );
  assert.deepStrictEqual(calls.pop(), ["add", 3, [4, 5], 7]);
  assert.deepStrictEqual(pushed, [[[11], "PROGRAM_ASSIGNED"]]); // chỉ báo người mới được thêm
  stub({
    addProgramInterns: async () => ({
      outcome: "CAPACITY_EXCEEDED",
      capacity: 2,
      current: 2,
    }),
  });
  await rejects(
    service.addInterns("3", { intern_ids: [4] }, { id: 7 }, deps),
    409,
    "vượt sức chứa",
  );
  stub({
    addProgramInterns: async () => ({
      outcome: "INTERN_NOT_FOUND",
      missing: [4],
    }),
  });
  await rejects(
    service.addInterns("3", { intern_ids: [4] }, { id: 7 }, deps),
    400,
    "thực tập sinh không tồn tại",
  );
  assert.strictEqual(await service.removeIntern("3", "1"), null);
  await rejects(
    service.removeIntern("3", "2"),
    404,
    "gỡ người không thuộc chương trình",
  );
  await rejects(service.removeIntern("3", "x"), 400, "gỡ: id sai");

  // các kết quả lỗi từ DB
  stub({
    assignProgramInternsMentor: async () => ({ outcome: "MENTOR_NOT_FOUND" }),
  });
  await rejects(
    service.assignMentor("3", { mentor_id: 99 }, deps),
    404,
    "mentor không tồn tại",
  );
  stub({ assignProgramInternsMentor: async () => ({ outcome: "NO_INTERNS" }) });
  await rejects(
    service.assignMentor("3", { mentor_id: 5 }, deps),
    409,
    "chương trình chưa có thực tập sinh",
  );
  stub({
    assignProgramInternsMentor: async () => ({
      outcome: "INTERN_NOT_IN_PROGRAM",
      missing: [8],
    }),
  });
  await rejects(
    service.assignMentor("3", { mentor_id: 5, intern_ids: [8] }, deps),
    400,
    "thực tập sinh ngoài chương trình",
  );

  // không có gì đổi thì không phát thông báo
  pushed.length = 0;
  stub({
    assignProgramInternsMentor: async () => ({
      outcome: "UPDATED",
      mentorName: "B",
      changed: [],
      unchanged: 2,
    }),
  });
  assert.deepStrictEqual(
    await service.assignMentor("3", { mentor_id: 6 }, deps),
    { mentor_id: 6, mentor_name: "B", updated: 0, unchanged: 2 },
  );
  assert.strictEqual(pushed.length, 0);

  console.log(
    "PROGRAM MENTOR UNIT: add/remove/assign/list/validate/notify PASS",
  );
})()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => Object.assign(db, original));
