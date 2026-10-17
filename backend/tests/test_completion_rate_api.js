// Read-only needsServer integration suite. Never rewrites user data or permissions.
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const { BASE_URL, loginAs, readDbConfig } = require("./test_helpers");
const base = "/reports/completion-rate";
let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log("[PASS] " + name);
}
async function call(url, token) {
  const res = await fetch(BASE_URL + url, {
    headers: token ? { Authorization: "Bearer " + token } : {},
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  let body;
  try {
    body = JSON.parse(bytes.toString("utf8"));
  } catch {
    body = null;
  }
  return { status: res.status, headers: res.headers, body, bytes };
}
function key(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}
function expected(rows) {
  const unique = [...new Map(rows.map((r) => [String(r.id), r])).values()];
  const complete = unique.filter(
    (r) => r.completionStatus === "COMPLETED",
  ).length;
  const active = unique.filter(
    (r) => r.completionStatus === "IN_PROGRESS",
  ).length;
  return {
    total: unique.length,
    completed: complete,
    active,
    notCompleted: unique.length - complete - active,
    rate: unique.length
      ? Number(((complete * 100) / unique.length).toFixed(1))
      : 0,
  };
}
function assertStats(actual, rows) {
  for (const [name, value] of Object.entries(expected(rows)))
    assert.equal(actual[name], value, name);
}
async function main() {
  const conn = await mysql.createConnection(readDbConfig());
  try {
    const before = (
      await conn.query(
        "SELECT id,completion_status,completed_at,completed_by,completion_note FROM program_interns ORDER BY id",
      )
    )[0];
    const hr = await loginAs("HR");
    const paths = [
      base,
      base + "/interns?groupBy=program&groupKey=1",
      base + "/export.csv",
    ];
    for (const url of paths) {
      const r = await call(url);
      check("401 anonymous " + url, () => {
        assert.equal(r.status, 401);
        assert.equal(r.headers.get("cache-control"), "private, no-store");
      });
    }
    for (const role of ["Admin", "Mentor", "Intern"]) {
      const token = await loginAs(role);
      for (const url of paths) {
        const r = await call(url, token);
        check("403 " + role + " " + url, () => assert.equal(r.status, 403));
      }
    }
    const raw = (
      await conn.query(`SELECT pi.id,pi.intern_id AS internId,pi.program_id AS programId,pi.completion_status AS completionStatus,
  CASE WHEN pi.completion_status IN ('COMPLETED','NOT_COMPLETED') THEN pi.result_mentor_id ELSE i.mentor_id END AS mentorId,
  CASE WHEN pi.completion_status IN ('COMPLETED','NOT_COMPLETED') THEN pi.result_mentor_name ELSE COALESCE(m.full_name COLLATE utf8mb4_unicode_ci,i.mentor_name COLLATE utf8mb4_unicode_ci) END AS mentorName
  FROM program_interns pi JOIN intern_profiles i ON i.id=pi.intern_id LEFT JOIN mentors m ON m.id=i.mentor_id`)
    )[0];
    const r = await call(base, hr);
    check("HR 200; counts match membership results, not profile status", () => {
      assert.equal(r.status, 200);
      assertStats(r.body.data.summary, raw);
      assert.equal(
        r.body.data.summary.uniqueInterns,
        new Set(raw.map((row) => String(row.internId))).size,
      );
      assert.equal(r.headers.get("cache-control"), "private, no-store");
    });
    const data = r.body.data;
    for (const [dimension, groups] of [
      ["program", data.byProgram],
      ["mentor", data.byMentor],
    ]) {
      for (const group of groups) {
        const selected = raw.filter((row) =>
          dimension === "program"
            ? String(row.programId) === group.key
            : (row.mentorId != null
                ? "id:" + row.mentorId
                : ["", "chua cap nhat"].includes(key(row.mentorName))
                  ? "unknown"
                  : "legacy:" + key(row.mentorName)) === group.key,
        );
        const seen = [];
        let page = 1,
          last = 1;
        do {
          const detail = await call(
            base +
              "/interns?" +
              new URLSearchParams({
                groupBy: dimension,
                groupKey: group.key,
                page: String(page),
                pageSize: "2",
              }),
            hr,
          );
          assert.equal(detail.status, 200);
          assertStats(detail.body.data.summary, selected);
          assert.equal(detail.body.data.pagination.total, group.total);
          assert.equal(detail.body.data.summary.rate, group.rate);
          seen.push(...detail.body.data.items.map((item) => Number(item.id)));
          last = detail.body.data.pagination.totalPages;
          page++;
        } while (page <= last);
        check(
          "chart/detail IDs and all pages " + dimension + " " + group.key,
          () =>
            assert.deepEqual(
              seen.sort((a, b) => a - b),
              selected.map((row) => Number(row.id)).sort((a, b) => a - b),
            ),
        );
      }
    }
    for (const [status, code] of [
      ["Đang thực tập", "IN_PROGRESS"],
      ["Hoàn thành", "COMPLETED"],
      ["Tạm dừng", "PAUSED"],
      ["Không hoàn thành", "NOT_COMPLETED"],
    ]) {
      const filtered = await call(
        base + "?" + new URLSearchParams({ status }),
        hr,
      );
      check("membership status filter " + status, () => {
        assert.equal(filtered.status, 200);
        assertStats(
          filtered.body.data.summary,
          raw.filter((row) => row.completionStatus === code),
        );
      });
    }
    for (const program of data.programs) {
      const filtered = await call(base + "?programId=" + program.id, hr);
      check("program filter " + program.id, () =>
        assertStats(
          filtered.body.data.summary,
          raw.filter((row) => String(row.programId) === String(program.id)),
        ),
      );
    }
    const day = "2020-01-15";
    const selected = (
      await conn.query(
        `SELECT pi.id,pi.completion_status AS completionStatus FROM program_interns pi JOIN internship_programs p ON p.id=pi.program_id WHERE p.start_date<=? AND p.end_date>=?`,
        [day, day],
      )
    )[0];
    const dates = await call(base + "?from=" + day + "&to=" + day, hr);
    check(
      "date filter intersects program period (not profile created_at)",
      () => {
        assert.equal(dates.status, 200);
        assertStats(dates.body.data.summary, selected);
      },
    );
    for (const state of ["ONGOING", "CLOSED"]) {
      const selected = (
        await conn.query(
          "SELECT pi.id,pi.completion_status AS completionStatus FROM program_interns pi JOIN internship_programs p ON p.id=pi.program_id WHERE p.status=?",
          [state],
        )
      )[0];
      const filtered = await call(base + "?programStatus=" + state, hr);
      check("program state " + state, () =>
        assertStats(filtered.body.data.summary, selected),
      );
    }
    const invalid = [
      "foo=1",
      "status=Foo",
      "status=Ho%C3%A0n%20th%C3%A0nh&status=Foo",
      "q=a&q=b",
      "programId=0",
      "programId=1&programId=2",
      "programId=9007199254740992",
      "from=2026-02-29",
      "from=2026-10-10&to=2026-01-01",
      "programStatus=Foo",
      "q=" + "a".repeat(101),
    ];
    for (const query of invalid) {
      for (const endpoint of [base, base + "/export.csv"]) {
        const bad = await call(endpoint + "?" + query, hr);
        check("400 invalid report/CSV " + query.slice(0, 50), () =>
          assert.equal(bad.status, 400),
        );
      }
    }
    for (const query of [
      "",
      "groupBy=foo&groupKey=1",
      "groupBy=program&groupKey=1&pageSize=101",
      "groupBy=program&groupKey=1&page=0",
      "groupBy=program&groupKey=1&page=1&page=2",
    ]) {
      const bad = await call(base + "/interns?" + query, hr);
      check("400 detail " + query, () => assert.equal(bad.status, 400));
    }
    const empty = await call(base + "?q=US6_NOMATCH_" + Date.now(), hr);
    check("empty data has finite zero rate", () => {
      assert.equal(empty.body.data.summary.total, 0);
      assert.equal(empty.body.data.summary.rate, 0);
    });
    const csv = await call(base + "/export.csv", hr);
    check("CSV 200 BOM/download/no-store", () => {
      assert.equal(csv.status, 200);
      assert.deepEqual([...csv.bytes.subarray(0, 3)], [239, 187, 191]);
      assert.match(csv.headers.get("content-type"), /text\/csv/);
      assert.match(csv.headers.get("content-disposition"), /attachment/);
      assert.equal(csv.headers.get("cache-control"), "private, no-store");
    });
    const after = (
      await conn.query(
        "SELECT id,completion_status,completed_at,completed_by,completion_note FROM program_interns ORDER BY id",
      )
    )[0];
    check("report suite did not change membership results", () =>
      assert.deepEqual(after, before),
    );
    console.log(`US6 API: ${passed} checks passed; no data written.`);
  } finally {
    await conn.end();
  }
}
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
