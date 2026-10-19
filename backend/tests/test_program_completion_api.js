// Opt-in mutation tests. Refuses any DB outside a dedicated us6_test_* namespace.
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { BASE_URL, loginAs, readDbConfig } = require("./test_helpers");
let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log("[PASS] " + name);
}
async function main() {
  const cfg = readDbConfig();
  if (
    process.env.US6_TEST_DB_ALLOW_WRITES !== "1" ||
    !/^us6_test_[A-Za-z0-9_]+$/.test(cfg.database)
  )
    throw new Error(
      "Requires US6_TEST_DB_ALLOW_WRITES=1 and a dedicated database named us6_test_*. Never run on user data.",
    );
  const conn = await mysql.createConnection(cfg),
    prefix = "US6_RESULT_" + Date.now();
  const programs = [],
    interns = [],
    mentors = [],
    accounts = [];
  let department;
  const hr = await loginAs("HR");
  async function call(method, url, body, token = hr, base = BASE_URL) {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }
  async function program(label, start, end, state = "CLOSED") {
    const r = await call("POST", "/programs", {
      department_id: department,
      name: label,
      start_date: start,
      end_date: end,
      status: state,
      capacity: 20,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    programs.push(r.body.data.id);
    return r.body.data.id;
  }
  async function intern(label) {
    const email = prefix + "_" + label + "@example.test";
    const [r] = await conn.query(
      "INSERT INTO intern_profiles (full_name,email,student_code,university,status) VALUES (?,?,?,?,'Hoàn thành')",
      [prefix + " " + label, email, label, "O'Brien <>&"],
    );
    interns.push(r.insertId);
    return r.insertId;
  }
  const add = (p, ids, base) =>
    call("POST", `/programs/${p}/interns`, { intern_ids: ids }, hr, base);
  const result = (p, i, status, note = "") =>
    call("PUT", `/programs/${p}/interns/${i}/completion`, {
      completion_status: status,
      note,
    });
  async function enrollment(p, i) {
    return (
      await conn.query(
        "SELECT * FROM program_interns WHERE program_id=? AND intern_id=?",
        [p, i],
      )
    )[0][0];
  }
  try {
    const [d] = await conn.query("INSERT INTO departments (name) VALUES (?)", [
      prefix,
    ]);
    department = d.insertId;
    for (const label of ["Mentor A", "Mentor B"]) {
      const [m] = await conn.query(
        "INSERT INTO mentors (full_name,email) VALUES (?,?)",
        [prefix + " " + label, prefix + mentors.length + "@mentor.test"],
      );
      mentors.push(m.insertId);
    }
    const a = await program(
      prefix + " A O'Brien <>&",
      "2020-01-01",
      "2020-01-31",
    );
    const b = await program(
      "=1+1 " + prefix + " B",
      "2020-02-01",
      "2020-02-29",
    );
    const boundary = await program(
      prefix + " boundary",
      "2020-01-31",
      "2020-02-20",
    );
    const i = await intern("50%_\\O'Brien");
    await conn.query("UPDATE intern_profiles SET mentor_id=? WHERE id=?", [
      mentors[0],
      i,
    ]);
    assert.equal((await add(a, [i])).status, 201);
    const initial = await enrollment(a, i);
    check("old global Hoàn thành does not imply per-program completion", () =>
      assert.equal(initial.completion_status, "IN_PROGRESS"),
    );
    for (const role of ["Admin", "Mentor", "Intern"]) {
      const token = await loginAs(role);
      const r = await call(
        "PUT",
        `/programs/${a}/interns/${i}/completion`,
        { completion_status: "COMPLETED" },
        token,
      );
      check("403 result " + role, () => assert.equal(r.status, 403));
    }
    const anonymous = await call(
      "PUT",
      `/programs/${a}/interns/${i}/completion`,
      { completion_status: "COMPLETED" },
      null,
    );
    check("401 result anonymous", () => assert.equal(anonymous.status, 401));
    const spoof = await call("PUT", `/programs/${a}/interns/${i}/completion`, {
      completion_status: "COMPLETED",
      completed_by: 999,
    });
    check("400 forged actor", () => assert.equal(spoof.status, 400));
    assert.equal(
      (await result(a, i, "COMPLETED", "HR xác nhận A")).status,
      200,
    );
    const savedA = await enrollment(a, i);
    check("HR confirmation stores result/time/actor/mentor snapshot", () => {
      assert.equal(savedA.completion_status, "COMPLETED");
      assert.ok(savedA.completed_at);
      assert.ok(savedA.completed_by);
      assert.equal(Number(savedA.result_mentor_id), mentors[0]);
    });
    const again = await result(a, i, "COMPLETED", "HR xác nhận A");
    check("same confirmation is idempotent", () => {
      assert.equal(again.status, 200);
      assert.equal(again.body.data.already, true);
    });
    assert.equal((await add(b, [i])).status, 201);
    await conn.query(
      "UPDATE intern_profiles SET status='Tạm dừng',mentor_id=? WHERE id=?",
      [mentors[1], i],
    );
    const report = await call(
      "GET",
      "/reports/completion-rate?" + new URLSearchParams({ q: prefix }),
    );
    check("A complete -> B active: 2 enrollments, 1 person, 50%", () => {
      assert.equal(report.status, 200);
      const data = report.body.data;
      assert.equal(data.summary.total, 2);
      assert.equal(data.summary.uniqueInterns, 1);
      assert.equal(data.summary.completed, 1);
      assert.equal(data.summary.rate, 50);
      assert.equal(data.byProgram.find((g) => g.key === String(a)).rate, 100);
      assert.equal(data.byProgram.find((g) => g.key === String(b)).rate, 0);
    });
    const detail = await call(
      "GET",
      "/reports/completion-rate/interns?" +
        new URLSearchParams({ groupBy: "program", groupKey: String(a) }),
    );
    check("A retains original mentor after B gets another mentor", () => {
      assert.equal(detail.body.data.items[0].mentorName, prefix + " Mentor A");
      assert.equal(detail.body.data.items[0].completionStatus, "COMPLETED");
    });
    assert.equal((await result(b, i, "PAUSED", "Tạm nghỉ")).status, 200);
    assert.equal((await result(b, i, "IN_PROGRESS")).status, 200);
    assert.equal(
      (await result(b, i, "COMPLETED", "HR xác nhận B")).status,
      200,
    );
    const currentA = await enrollment(a, i);
    check("completing B preserves all result fields of A", () =>
      assert.deepEqual(currentA, savedA),
    );
    const rewrite = await result(a, i, "PAUSED");
    check("cannot rewrite finalized A", () =>
      assert.equal(rewrite.status, 409),
    );
    assert.equal(
      (await call("DELETE", `/programs/${a}/interns/${i}`)).status,
      409,
    );
    const deleteProfile = await call("DELETE", `/interns/${i}`);
    check("profile deletion cannot cascade finalized results away", () =>
      assert.equal(deleteProfile.status, 409),
    );
    const [account] = await conn.query(
      "INSERT INTO users (name,email,password_hash,role_id,status) SELECT full_name,email,'isolated-test-no-login',4,'ACTIVE' FROM intern_profiles WHERE id=?",
      [i],
    );
    accounts.push(account.insertId);
    const admin = await loginAs("Admin");
    const deleteAccount = await call(
      "DELETE",
      `/users/${account.insertId}`,
      undefined,
      admin,
    );
    check("account deletion cannot cascade finalized results away", () =>
      assert.equal(deleteAccount.status, 409),
    );
    assert.equal((await call("DELETE", `/programs/${a}`)).status, 409);
    const editA = await call("PUT", `/programs/${a}`, {
      department_id: department,
      name: prefix + " A O'Brien <>&",
      start_date: "2020-01-02",
      end_date: "2020-01-31",
      status: "CLOSED",
      capacity: 20,
    });
    check("history protected from removal, deletion, and period edits", () =>
      assert.equal(editA.status, 409),
    );
    const sameDay = await add(boundary, [i]);
    check("inclusive boundary overlaps even after A completed", () =>
      assert.equal(sameDay.status, 409),
    );
    const x = await program(prefix + " X", "2020-03-01", "2020-03-31"),
      y = await program(prefix + " Y", "2020-03-10", "2020-04-01");
    const j = await intern("concurrent");
    const second = process.env.US6_SECOND_BASE_URL || BASE_URL;
    const raced = await Promise.all([add(x, [j]), add(y, [j], second)]);
    check("concurrent overlapping assignments: exactly one succeeds", () =>
      assert.deepEqual(raced.map((r) => r.status).sort(), [201, 409]),
    );
    const loser = raced[0].status === 409 ? x : y;
    const winner = loser === x ? y : x;
    const k = await intern("batch");
    const batch = await add(loser, [k, j]);
    check("conflicting batch is atomic", () => assert.equal(batch.status, 409));
    assert.equal(await enrollment(loser, k), undefined);
    const z = await program(prefix + " Z", "2020-05-01", "2020-05-31");
    assert.equal((await add(z, [j])).status, 201);
    const edit = await call("PUT", `/programs/${z}`, {
      department_id: department,
      name: prefix + " Z",
      start_date: "2020-03-15",
      end_date: "2020-03-20",
      status: "CLOSED",
      capacity: 20,
    });
    check("date edit cannot introduce an overlap", () =>
      assert.equal(edit.status, 409),
    );
    const future = await program(
      prefix + " future",
      "2090-01-01",
      "2090-01-31",
      "OPEN",
    );
    assert.equal((await add(future, [k])).status, 201);
    const futureResult = await result(future, k, "COMPLETED");
    check("cannot finalize a future program", () =>
      assert.equal(futureResult.status, 409),
    );
    await conn.query(
      "INSERT INTO program_interns (program_id,intern_id) VALUES (?,?)",
      [loser, j],
    );
    const legacyConflict = await result(
      winner,
      j,
      "NOT_COMPLETED",
      "Lý do test",
    );
    check(
      "legacy overlapping schedules must be resolved before finalization",
      () => assert.equal(legacyConflict.status, 409),
    );
    assert.equal(
      (await call("DELETE", `/programs/${loser}/interns/${j}`)).status,
      200,
    );
    assert.equal((await result(winner, j, "NOT_COMPLETED")).status, 400);
    assert.equal(
      (
        await result(
          winner,
          j,
          "NOT_COMPLETED",
          "Không đáp ứng yêu cầu, HR xác nhận",
        )
      ).status,
      200,
    );
    const invalidDate = await call("POST", "/programs", {
      department_id: department,
      name: prefix + " unscheduled",
      status: "DRAFT",
      capacity: 10,
    });
    assert.equal(invalidDate.status, 201);
    programs.push(invalidDate.body.data.id);
    assert.equal((await add(invalidDate.body.data.id, [k])).status, 409);
    const failed = await enrollment(winner, j);
    check("not-completed stores an independent terminal result", () =>
      assert.equal(failed.completion_status, "NOT_COMPLETED"),
    );
    const literal = await call(
      "GET",
      "/reports/completion-rate?" +
        new URLSearchParams({ q: prefix + " 50%_\\O'Brien" }),
    );
    check("literal LIKE percent/underscore/backslash/apostrophe", () =>
      assert.equal(literal.body.data.summary.total, 2),
    );
    const filtered = await call(
      "GET",
      "/reports/completion-rate?" +
        new URLSearchParams({
          programId: String(a),
          from: "2020-01-31",
          to: "2020-01-31",
        }),
    );
    check("program date boundaries are inclusive", () =>
      assert.equal(filtered.body.data.summary.total, 1),
    );
    const before = await call(
      "GET",
      "/reports/completion-rate?" +
        new URLSearchParams({ programId: String(a), from: "2020-02-01" }),
    );
    check("nonintersecting period excluded", () =>
      assert.equal(before.body.data.summary.total, 0),
    );
    const csvRes = await fetch(
      BASE_URL +
        "/reports/completion-rate/export.csv?" +
        new URLSearchParams({ q: prefix }),
      { headers: { Authorization: "Bearer " + hr } },
    );
    const csv = Buffer.from(await csvRes.arrayBuffer());
    check("CSV protects a formula-like program name and preserves BOM", () => {
      assert.equal(csvRes.status, 200);
      assert.deepEqual([...csv.subarray(0, 3)], [239, 187, 191]);
      assert.ok(csv.toString("utf8").includes("\"'=1+1 " + prefix + ' B"'));
    });
    // Exercise the read-only report suite while known lifecycle fixtures are present.
    const suite = spawnSync(
      process.execPath,
      [path.join(__dirname, "test_completion_rate_api.js")],
      { env: process.env, stdio: "inherit" },
    );
    assert.equal(suite.status, 0);
    console.log(`Program results lifecycle: ${passed} checks passed.`);
  } finally {
    // Only delete rows inserted by this test, in a guarded disposable DB.
    if (programs.length) {
      await conn.query("DELETE FROM program_interns WHERE program_id IN (?)", [
        programs,
      ]);
      await conn.query("DELETE FROM internship_programs WHERE id IN (?)", [
        programs,
      ]);
    }
    if (accounts.length)
      await conn.query("DELETE FROM users WHERE id IN (?)", [accounts]);
    if (interns.length)
      await conn.query("DELETE FROM intern_profiles WHERE id IN (?)", [
        interns,
      ]);
    if (mentors.length)
      await conn.query("DELETE FROM mentors WHERE id IN (?)", [mentors]);
    if (department)
      await conn.query("DELETE FROM departments WHERE id=?", [department]);
    await conn.end();
  }
}
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
