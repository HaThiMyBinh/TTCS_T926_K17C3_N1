// Unit test (không cần MySQL): nhóm theo ngày, phạm vi GROUP của lịch làm việc, validate lịch họp theo phạm vi,
// validate nhóm và tra cứu thời điểm mentor.
const assert = require("assert");
const w = require("../services/scheduleRules.service");
const rules = require("../services/meetingRules.service");
const structure = require("../services/structure.service");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`[PASS] ${name}`);
}
function throwsStatus(fn, status, label) {
  assert.throws(fn, (e) => e.status === status, label);
}

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const future = iso(Date.now() + 10 * 86400000);
const futureEnd = iso(Date.now() + 10 * 86400000 + 3600000);
const meeting = (extra) => ({
  title: "Họp",
  start_at: future,
  end_at: futureEnd,
  program_id: 3,
  ...extra,
});

test("findMembershipGroup: chọn nhóm chính theo ngày, ngày rời là mốc loại trừ", () => {
  const memberships = [
    {
      internId: 1,
      programId: 3,
      groups: [
        { groupId: 10, from: "2026-01-01", to: "2026-02-10" },
        { groupId: 11, from: "2026-02-10", to: null },
      ],
    },
  ];
  assert.equal(w.findMembershipGroup(memberships, "2026-02-09", 3), 10);
  assert.equal(w.findMembershipGroup(memberships, "2026-02-10", 3), 11);
  assert.equal(w.findMembershipGroup(memberships, "2025-12-31", 3), null);
  assert.equal(w.findMembershipGroup(memberships, "2026-02-09", 4), null);
  assert.equal(w.findMembershipGroup(memberships, "2026-02-09", null), null);
});

test("internMatchesTarget: GROUP chỉ khớp thành viên nhóm đang hoạt động", () => {
  const memberships = [
    { internId: 1, programId: 3, groups: [{ groupId: 10, from: "2026-01-01", to: null }] },
    { internId: 2, programId: 3, groups: [{ groupId: 10, from: "2026-01-01", to: "2026-01-20" }] },
  ];
  assert.equal(w.internMatchesTarget({ id: 1 }, memberships, "GROUP", "10"), true);
  assert.equal(w.internMatchesTarget({ id: 2 }, memberships, "GROUP", "10"), false);
  assert.equal(w.internMatchesTarget({ id: 3 }, memberships, "GROUP", "10"), false);
  assert.equal(w.internMatchesTarget({ id: 1 }, memberships, "GROUP", "11"), false);
});

test("Ưu tiên lịch: INTERN > GROUP > PROGRAM > MENTOR > UNIVERSITY > DEFAULT", () => {
  assert.deepEqual(w.PRIORITY, ["INTERN", "GROUP", "PROGRAM", "MENTOR", "UNIVERSITY", "DEFAULT"]);
  assert.ok(w.TYPES.includes("GROUP"));
  const schedule = (id) => ({ id, name: `S${id}` });
  const assignment = (id, scheduleId, targetType, targetValue) => ({
    id,
    scheduleId,
    targetType,
    targetValue,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
  });
  const ctx = {
    schedules: [schedule(1), schedule(2), schedule(3), schedule(4)],
    assignments: [
      assignment(1, 1, "DEFAULT", ""),
      assignment(2, 2, "PROGRAM", "3"),
      assignment(3, 3, "GROUP", "10"),
      assignment(4, 4, "INTERN", "7"),
    ],
    programs: [{ id: 3, name: "P" }],
    groups: [{ id: 10, name: "Nhóm A", programName: "P" }],
    mentors: [],
  };
  const intern = { id: 5, university: "X", mentorId: null };
  const date = "2026-03-01";
  const pick = (i, programId, groupId) =>
    w.resolveScheduleFromContext(ctx, i, date, programId, groupId);
  assert.equal(pick(intern, 3, 10).source.type, "GROUP");
  assert.match(pick(intern, 3, 10).source.label, /Nhóm thực tập: Nhóm A \(P\)/);
  assert.equal(pick(intern, 3, null).source.type, "PROGRAM");
  assert.equal(pick(intern, null, null).source.type, "DEFAULT");
  assert.equal(pick({ ...intern, id: 7 }, 3, 10).source.type, "INTERN");
});

test("meetingRules: mặc định INDIVIDUAL giữ nguyên hành vi cũ", () => {
  const v = rules.validateInput(meeting({ attendee_ids: [2, 1] }));
  assert.equal(v.scopeType, "INDIVIDUAL");
  assert.deepEqual(v.attendeeIds, [1, 2]);
  assert.equal(v.groupId, null);
  assert.deepEqual(v.includeIds, []);
  throwsStatus(() => rules.validateInput(meeting({})), 400, "thiếu attendee_ids");
  throwsStatus(
    () => rules.validateInput(meeting({ attendee_ids: [1], include_ids: [2] })),
    400,
    "ngoại lệ chỉ cho lịch phạm vi",
  );
  throwsStatus(
    () => rules.validateInput(meeting({ attendee_ids: [1], group_id: 4 })),
    400,
    "group_id không dùng cho INDIVIDUAL",
  );
});

test("meetingRules: lịch PROGRAM/GROUP tự lấy người, chỉ nhận ngoại lệ", () => {
  const p = rules.validateInput(meeting({ scope_type: "PROGRAM", exclude_ids: [4] }));
  assert.equal(p.scopeType, "PROGRAM");
  assert.deepEqual(p.attendeeIds, []);
  assert.deepEqual(p.excludeIds, [4]);
  const g = rules.validateInput(
    meeting({ scope_type: "GROUP", group_id: 9, include_ids: [2], exclude_ids: [1] }),
  );
  assert.equal(g.groupId, 9);
  assert.deepEqual(g.includeIds, [2]);
  const bad = (extra, label) =>
    throwsStatus(() => rules.validateInput(meeting(extra)), 400, label);
  bad({ scope_type: "GROUP" }, "GROUP thiếu group_id");
  bad({ scope_type: "GROUP", group_id: 9, attendee_ids: [1] }, "không chọn tay khi có phạm vi");
  bad({ scope_type: "PROGRAM", group_id: 9 }, "PROGRAM không có nhóm");
  bad({ scope_type: "PROGRAM", include_ids: [1] }, "PROGRAM không thêm người ngoài");
  bad({ scope_type: "GROUP", group_id: 9, include_ids: [1], exclude_ids: [1] }, "vừa thêm vừa loại");
  bad({ scope_type: "GROUP", group_id: 9, include_ids: [1, 1] }, "trùng");
  bad({ scope_type: "GROUP", group_id: 9, include_ids: ["1"] }, "sai kiểu");
  bad({ scope_type: "UNKNOWN", attendee_ids: [1] }, "phạm vi lạ");
  bad({ scope_type: "GROUP", group_id: 9, program_id: null }, "thiếu chương trình");
});

test("validateGroup: tên/mô tả hợp lệ và chặn trường lạ", () => {
  assert.deepEqual(structure.validateGroup({ name: "  Nhóm A  ", description: " mô tả " }), {
    name: "Nhóm A",
    description: "mô tả",
  });
  assert.deepEqual(structure.validateGroup({ description: "" }, { partial: true }), {
    description: null,
  });
  for (const bad of [null, [], {}, { name: "" }, { name: "   " }, { name: 5 }, { name: "a".repeat(151) }, { name: "x", extra: 1 }, { name: "x", description: "d".repeat(501) }])
    throwsStatus(() => structure.validateGroup(bad), 400, JSON.stringify(bad));
});

test("parseAt/parseId: định dạng thời điểm và mã", () => {
  assert.equal(structure.parseAt(undefined), null);
  assert.equal(structure.parseAt("2026-02-03"), "2026-02-03 00:00:00");
  assert.equal(structure.parseAt("2026-02-03 08:30"), "2026-02-03 08:30:00");
  assert.equal(structure.parseAt("2026-02-03T08:30:15"), "2026-02-03 08:30:15");
  for (const bad of ["2026-02-30", "03/02/2026", "", "2026-02-03 25:00x", 5])
    throwsStatus(() => structure.parseAt(bad), 400, String(bad));
  assert.equal(structure.parseId("12"), 12);
  for (const bad of ["0", "-1", "1.5", "abc", "", undefined])
    throwsStatus(() => structure.parseId(bad), 400, String(bad));
});

// ---- Đồng bộ mentor_id <-> mentor_assignments (kết nối giả, không cần MySQL) ----
const migration = require("../migrations/structureMigration");
const fs = require("fs");
const path = require("path");

function fakeConn({
  lockAcquired = 1,
  driftBefore = [],
  driftAfter = [],
  failOn = null,
} = {}) {
  const log = [];
  let driftCalls = 0;
  const conn = {
    log,
    released: false,
    async query(sql) {
      const text = String(sql).replace(/\s+/g, " ").trim();
      log.push(text);
      if (failOn && failOn.test(text)) throw new Error("boom");
      if (/GET_LOCK/.test(text)) return [[{ acquired: lockAcquired }]];
      if (
        /FROM intern_profiles ip LEFT JOIN mentor_assignments ma/.test(text)
      ) {
        driftCalls += 1;
        return [driftCalls === 1 ? driftBefore : driftAfter];
      }
      return [[]];
    },
    async beginTransaction() {
      log.push("BEGIN");
    },
    async commit() {
      log.push("COMMIT");
    },
    async rollback() {
      log.push("ROLLBACK");
    },
    release() {
      conn.released = true;
    },
  };
  return conn;
}
const poolOf = (conn) => ({
  getConnection: async () => conn,
  query: (...a) => conn.query(...a),
});
const asyncTest = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`[PASS] ${name}`);
};

test("updateStudent khóa dòng intern (FOR UPDATE) trước khi đọc mentor_id", () => {
  const src = fs.readFileSync(path.join(__dirname, "../db.js"), "utf8");
  const start = src.indexOf("async function updateStudent(");
  assert.ok(start > 0, "không thấy updateStudent");
  const body = src.slice(
    start,
    src.indexOf("async function deleteStudent", start),
  );
  const select = body.match(
    /"SELECT \* FROM intern_profiles WHERE id = \?[^"]*"/,
  );
  assert.ok(select, "không thấy câu SELECT hồ sơ trong updateStudent");
  assert.match(select[0], /FOR UPDATE/);
});

test("server.js đồng bộ lịch sử mentor ngay sau backfillInternMentorIds", () => {
  const src = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const a = src.indexOf("db.backfillInternMentorIds()");
  const b = src.indexOf("reconcileMentorHistory(db.getPool())");
  assert.ok(
    a > 0 && b > a,
    "reconcileMentorHistory phải được gọi sau backfillInternMentorIds",
  );
});

(async () => {
  await asyncTest(
    "reconcileMentorHistory: không lệch thì không ghi gì, vẫn nhả khóa và kết nối",
    async () => {
      const conn = fakeConn();
      const r = await migration.reconcileMentorHistory(poolOf(conn));
      assert.deepEqual(r, { before: [], after: [] });
      assert.ok(!conn.log.some((l) => /^(UPDATE|INSERT)/.test(l)));
      assert.ok(conn.log.some((l) => /RELEASE_LOCK/.test(l)));
      assert.equal(conn.released, true);
    },
  );

  await asyncTest(
    "reconcileMentorHistory: có lệch thì sửa trong một giao dịch và trả danh sách trước/sau",
    async () => {
      const drift = [
        {
          internId: 7,
          currentMentorId: 2,
          openAssignmentId: 5,
          openMentorId: 1,
        },
      ];
      for (const asPool of [true, false]) {
        const conn = fakeConn({ driftBefore: drift, driftAfter: [] });
        const r = await migration.reconcileMentorHistory(
          asPool ? poolOf(conn) : conn,
        );
        assert.deepEqual(r.before, drift);
        assert.deepEqual(r.after, []);
        const order = conn.log.map((l) => l.split(" ")[0]);
        const iBegin = order.indexOf("BEGIN");
        const iUpdate = order.indexOf("UPDATE");
        const iInsert = order.indexOf("INSERT");
        const iCommit = order.indexOf("COMMIT");
        assert.ok(
          iBegin >= 0 &&
            iBegin < iUpdate &&
            iUpdate < iInsert &&
            iInsert < iCommit,
          conn.log.join(" | "),
        );
        assert.equal(conn.released, asPool);
      }
    },
  );

  await asyncTest(
    "reconcileMentorHistory: lỗi giữa chừng thì rollback, nhả khóa và kết nối",
    async () => {
      for (const asPool of [true, false]) {
        const conn = fakeConn({
          driftBefore: [{ internId: 1 }],
          failOn: /^INSERT INTO mentor_assignments/,
        });
        await assert.rejects(
          () => migration.reconcileMentorHistory(asPool ? poolOf(conn) : conn),
          /boom/,
        );
        assert.ok(conn.log.includes("ROLLBACK"));
        assert.ok(!conn.log.includes("COMMIT"));
        assert.ok(conn.log.some((l) => /RELEASE_LOCK/.test(l)));
        assert.equal(conn.released, asPool);
      }
    },
  );

  await asyncTest(
    "reconcileMentorHistory: không lấy được khóa thì không đụng dữ liệu",
    async () => {
      const conn = fakeConn({
        lockAcquired: 0,
        driftBefore: [{ internId: 1 }],
      });
      await assert.rejects(
        () => migration.reconcileMentorHistory(poolOf(conn)),
        /khóa migration/,
      );
      assert.ok(!conn.log.some((l) => /^(UPDATE|INSERT)/.test(l)));
      assert.ok(
        !conn.log.some((l) => /RELEASE_LOCK/.test(l)),
        "không giữ khóa thì không nhả",
      );
      assert.equal(conn.released, true);
    },
  );

  await asyncTest(
    "findMentorAssignmentDrift: truy vấn so sánh null-safe và bắt dòng mở không có mentor",
    async () => {
      const conn = fakeConn({ driftBefore: [{ internId: 3 }] });
      const rows = await migration.findMentorAssignmentDrift(conn);
      assert.deepEqual(rows, [{ internId: 3 }]);
      assert.match(conn.log[0], /ip\.mentor_id <=> ma\.mentor_id/);
      assert.match(conn.log[0], /ma\.effective_to IS NULL/);
      assert.match(conn.log[0], /ma\.id IS NOT NULL AND ma\.mentor_id IS NULL/);
    },
  );

  console.log(`\nSTRUCTURE UNIT: ${passed} PASS`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
