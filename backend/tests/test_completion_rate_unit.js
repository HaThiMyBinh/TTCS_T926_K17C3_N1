const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const service = require("../services/completionRate.service");
const db = require("../db");
const rows = [
  {
    id: 1,
    internId: 1,
    fullName: "A",
    programId: 10,
    programName: "Alpha",
    mentorId: 2,
    mentorName: "Mentor A",
    status: "Hoàn thành",
  },
  {
    id: 4,
    internId: 1,
    fullName: "A",
    programId: 11,
    programName: "Beta",
    mentorId: 2,
    mentorName: "Mentor A",
    status: "Hoàn thành",
  },
  {
    id: 2,
    fullName: "B",
    programId: 10,
    programName: "Alpha",
    mentorId: 2,
    mentorName: "Mentor A",
    status: "Đang thực tập",
  },
  {
    id: 3,
    fullName: "C",
    programId: null,
    programName: null,
    mentorId: null,
    mentorName: null,
    status: "Tạm dừng",
  },
];
function bad(query, detail = false) {
  assert.throws(
    () => service.validateQuery(query, detail),
    (e) => e.status === 400,
  );
}
async function withRows(data, fn) {
  const original = db.getCompletionRateRows;
  db.getCompletionRateRows = async () => data;
  try {
    await fn();
  } finally {
    db.getCompletionRateRows = original;
  }
}
test("rate: zero denominator, 1/3, 2/3 and all completed", () => {
  assert.equal(service.rate(0, 0), 0);
  assert.equal(service.rate(1, 3), 33.3);
  assert.equal(service.rate(2, 3), 66.7);
  assert.equal(service.rate(3, 3), 100);
  assert.ok(Number.isFinite(service.buildReport([]).summary.rate));
});
test("summary counts membership IDs, with unique people shown separately", () => {
  assert.deepEqual(service.summarize(rows), {
    total: 4,
    completed: 2,
    active: 1,
    notCompleted: 1,
    unknownStatus: 0,
    uniqueInterns: 3,
    pendingReview: 4,
    rate: 50,
  });
});
test("unknown, empty and legacy statuses remain visible as not completed", () => {
  const data = [null, "", "Foo", "Đã kết thúc", " Hoàn thành "].map(
    (status, id) => ({ id, status }),
  );
  assert.deepEqual(service.summarize(data), {
    total: 5,
    completed: 1,
    active: 0,
    notCompleted: 4,
    unknownStatus: 4,
    uniqueInterns: 5,
    pendingReview: 5,
    rate: 20,
  });
});
test("groups sort by descending rate, then Vietnamese name", () => {
  const report = service.buildReport(rows);
  assert.deepEqual(
    report.byProgram.map((g) => [g.name, g.rate]),
    [
      ["Beta", 100],
      ["Alpha", 50],
    ],
  );
  const ties = service.groupRows(
    [
      { id: 1, programId: 2, programName: "B", status: "Hoàn thành" },
      { id: 2, programId: 1, programName: "A", status: "Hoàn thành" },
    ],
    "program",
  );
  assert.deepEqual(
    ties.map((g) => g.name),
    ["A", "B"],
  );
});
test("program IDs and mentor IDs keep identical names separate", () => {
  const data = [1, 2].map((id) => ({
    id,
    programId: id,
    programName: "Same",
    mentorId: id,
    mentorName: "Same",
    status: "Hoàn thành",
  }));
  assert.equal(service.buildReport(data).byProgram.length, 2);
  assert.equal(service.buildReport(data).byMentor.length, 2);
});
test("legacy mentor normalization and unknown names are consistent", () => {
  const data = ["Đại  học Y", "Dai hoc Y", null, "Chưa cập nhật", "   "].map(
    (mentorName, id) => ({ id, mentorName }),
  );
  const groups = service.groupRows(data, "mentor");
  assert.equal(groups.find((g) => g.key === "legacy:dai hoc y").total, 2);
  assert.equal(groups.find((g) => g.key === "unknown").total, 3);
});
test("prototype keys and punctuation are ordinary labels", () => {
  for (const name of ["__proto__", "constructor", "O'Brien <>&\""]) {
    const report = service.buildReport([
      { id: 1, programId: 1, programName: name, mentorName: name },
    ]);
    assert.equal(report.byProgram[0].name, name);
    assert.equal(report.byMentor[0].total, 1);
  }
});
test("rejects unknown, repeated and nested query parameters", () => {
  for (const query of [
    { foo: "x" },
    { status: ["Hoàn thành", "Tạm dừng"] },
    { q: {} },
    { programId: 1 },
  ])
    bad(query);
});
test("validates existing statuses only", () => {
  for (const status of ["Foo", "Đã kết thúc"]) bad({ status });
  for (const status of ["Hoàn thành", "Đang thực tập", "Tạm dừng"])
    assert.equal(service.validateQuery({ status }).status, status);
});
test("validates real dates and range ordering", () => {
  for (const query of [
    { from: "2026-02-29" },
    { from: "2026/01/01" },
    { from: "2026-04-31" },
    { from: "2026-10-10", to: "2026-01-01" },
  ])
    bad(query);
  assert.equal(
    service.validateQuery({ from: "2024-02-29", to: "2024-02-29" }).from,
    "2024-02-29",
  );
});
test("validates IDs, search length and detail pagination", () => {
  for (const programId of ["0", "-1", "1.2", "9007199254740992", "1 OR 1=1"])
    bad({ programId });
  bad({ q: "x".repeat(101) });
  bad({ page: "1" });
  for (const query of [
    {},
    { groupBy: "Foo", groupKey: "1" },
    { groupBy: "program", groupKey: "Foo" },
    { groupBy: "mentor", groupKey: "Foo" },
    { groupBy: "program", groupKey: "1", page: "0" },
    { groupBy: "program", groupKey: "1", pageSize: "101" },
    {
      groupBy: "program",
      groupKey: "1",
      page: "9007199254740991",
      pageSize: "100",
    },
  ])
    bad(query, true);
  assert.equal(
    service.validateQuery({ groupBy: "program", groupKey: "unassigned" }, true)
      .pageSize,
    20,
  );
});
test("detail members and counts match every chart group, without duplicate IDs", async () => {
  await withRows(rows, async () => {
    const report = service.buildReport(rows);
    for (const [dimension, groups] of [
      ["program", report.byProgram],
      ["mentor", report.byMentor],
    ]) {
      for (const group of groups) {
        const detail = await service.interns({
          groupBy: dimension,
          groupKey: group.key,
        });
        assert.equal(detail.pagination.total, group.total);
        assert.equal(detail.summary.completed, group.completed);
        assert.equal(detail.summary.rate, group.rate);
        assert.equal(new Set(detail.items.map((i) => i.id)).size, group.total);
        assert.ok(
          detail.items.every((i) => !("email" in i) && !("phone" in i)),
        );
      }
    }
  });
});
test("detail pagination returns stable pages and handles empty/out-of-range", async () => {
  await withRows(rows, async () => {
    const query = { groupBy: "program", groupKey: "10", pageSize: "1" };
    const first = await service.interns(query),
      second = await service.interns({ ...query, page: "2" });
    assert.equal(first.items[0].id, 1);
    assert.equal(second.items[0].id, 2);
    assert.equal(first.pagination.totalPages, 2);
    assert.equal(
      (await service.interns({ ...query, page: "3" })).items.length,
      0,
    );
    assert.equal(
      (await service.interns({ ...query, groupKey: "999" })).pagination.total,
      0,
    );
  });
});
test("report and detail pass identical base filters to DB", async () => {
  const originalRows = db.getCompletionRateRows,
    originalPrograms = db.getCompletionRatePrograms;
  const calls = [];
  db.getCompletionRateRows = async (filters) => {
    calls.push(filters);
    return rows;
  };
  db.getCompletionRatePrograms = async () => [{ id: 10, name: "Alpha" }];
  try {
    const query = {
      programId: "10",
      status: "Hoàn thành",
      from: "2026-01-01",
      to: "2026-12-31",
      q: "A",
    };
    await service.report(query);
    await service.interns({ ...query, groupBy: "program", groupKey: "10" });
    for (const key of ["programId", "status", "from", "to", "q"])
      assert.equal(calls[0][key], calls[1][key]);
  } finally {
    db.getCompletionRateRows = originalRows;
    db.getCompletionRatePrograms = originalPrograms;
  }
});
test("CSV has BOM, correct summary and csvCell formula/quote escaping", async () => {
  await withRows(
    ["=1+1", "+cmd", "-cmd", "@cmd", "O'Brien <>&\""].map(
      (programName, id) => ({
        id,
        programId: id + 1,
        programName,
        status: "Hoàn thành",
      }),
    ),
    async () => {
      const csv = await service.exportCsv({});
      assert.ok(csv.content.startsWith("\uFEFF"));
      for (const formula of ["=1+1", "+cmd", "-cmd", "@cmd"])
        assert.ok(csv.content.includes(`"'${formula}"`));
      assert.ok(csv.content.includes('O\'Brien <>&""'));
      assert.ok(csv.content.includes('"5","5","0","0","0","100"'));
    },
  );
});
test("DB SQL is parameterized, escapes LIKE wildcards and supports all filters", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../db.js"), "utf8");
  const code = source.slice(
    source.indexOf("async function getCompletionRateRows("),
    source.indexOf("async function getCompletionRatePrograms("),
  );
  let captured;
  const getRows = vm.runInNewContext(`${code}\ngetCompletionRateRows`, {
    requireDb: () => ({
      query: async (sql, params) => {
        captured = { sql, params };
        return [[]];
      },
    }),
  });
  await getRows({
    programId: 10,
    status: "Hoàn thành",
    from: "2026-01-01",
    to: "2026-12-31",
    q: "50%_\\' OR 1=1",
  });
  assert.ok(!captured.sql.includes("50%"));
  assert.ok(!captured.sql.includes("GROUP BY"));
  assert.equal(captured.params.length, 9);
  assert.equal(captured.params[4], "%50\\%\\_\\\\' OR 1=1%");
  assert.match(captured.sql, /pi\.program_id = \?/);
  assert.match(captured.sql, /p\.end_date >= \?/);
});
test("HR without VIEW_REPORTS is denied by the existing permission middleware", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../middleware/permissions.js"),
    "utf8",
  );
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    __dirname: path.join(__dirname, "../middleware"),
    require: (name) =>
      name === "fs"
        ? { readFileSync: () => JSON.stringify({ HR: [] }) }
        : require(name),
  });
  let status;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json() {},
  };
  module.exports.checkPermission("VIEW_REPORTS")(
    { user: { role: "HR" } },
    res,
    () => assert.fail("must not authorize"),
  );
  assert.equal(status, 403);
});

test("report and detail exclude profiles without program membership", async () => {
  const data = [...rows, { id: 99, programId: null, status: "Hoàn thành" }];
  const result = service.buildReport(data);
  assert.deepEqual(result.summary, {
    total: 3,
    completed: 2,
    active: 1,
    notCompleted: 0,
    unknownStatus: 0,
    uniqueInterns: 2,
    pendingReview: 3,
    rate: 66.7,
  });
  assert.ok(result.byProgram.every((group) => group.key !== "unassigned"));
  await withRows(data, async () => {
    const detail = await service.interns({
      groupBy: "program",
      groupKey: "unassigned",
    });
    assert.equal(detail.pagination.total, 0);
  });
  assert.equal(
    service.buildReport([{ id: 1, programId: null, status: "Hoàn thành" }])
      .summary.rate,
    0,
  );
});

test("A completed and B active remain independent for the same intern", () => {
  const report = service.buildReport([
    {
      id: 101,
      internId: 1,
      programId: 10,
      programName: "A",
      status: "Hoàn thành",
      profileStatus: "Tạm dừng",
      resultUpdatedAt: "2020-01-31",
    },
    {
      id: 102,
      internId: 1,
      programId: 11,
      programName: "B",
      status: "Đang thực tập",
      profileStatus: "Tạm dừng",
    },
  ]);
  assert.equal(report.summary.total, 2);
  assert.equal(report.summary.completed, 1);
  assert.equal(report.summary.uniqueInterns, 1);
  assert.equal(report.summary.rate, 50);
  assert.equal(report.byProgram.find((g) => g.key === "10").rate, 100);
  assert.equal(report.byProgram.find((g) => g.key === "11").rate, 0);
});
test("HR result validation rejects forged audit fields and requires failure reason", () => {
  const results = require("../services/programCompletion.service");
  for (const body of [
    {},
    { completion_status: "Foo" },
    { completion_status: "COMPLETED", completed_by: 999 },
    { completion_status: "NOT_COMPLETED" },
    { completion_status: "PAUSED", note: "x".repeat(501) },
  ])
    assert.throws(
      () => results.validateResult(body),
      (e) => e.status === 400,
    );
  assert.equal(
    results.validateResult({
      completion_status: "COMPLETED",
      note: " HR xác nhận ",
    }).note,
    "HR xác nhận",
  );
});
