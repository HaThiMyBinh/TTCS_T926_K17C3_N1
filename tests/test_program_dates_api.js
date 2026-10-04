const assert = require("assert");
const mysql = require("mysql2/promise");
const service = require("../services/programs.service");
const { BASE_URL, loginAs, readDbConfig } = require("./test_helpers");

async function request(path, role, method = "GET", body) {
  const hasBody = body !== undefined;
  const headers = {};
  if (role === "INVALID") {
    headers.Authorization = "Bearer invalid-token";
  } else if (role) {
    headers.Authorization = `Bearer ${await loginAs(role)}`;
  }
  if (hasBody) headers["Content-Type"] = "application/json";

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

async function removeTestPrograms(departmentId, namePrefix) {
  const connection = await mysql.createConnection(readDbConfig());
  try {
    await connection.query(
      `UPDATE internship_programs SET status = 'DRAFT'
       WHERE department_id = ? AND LEFT(name, CHAR_LENGTH(?)) = ?`,
      [departmentId, namePrefix, namePrefix],
    );
    await connection.query(
      `DELETE FROM internship_programs
       WHERE department_id = ? AND LEFT(name, CHAR_LENGTH(?)) = ?`,
      [departmentId, namePrefix, namePrefix],
    );
  } finally {
    await connection.end();
  }
}

async function testProgramDatesApi() {
  const departmentResponse = await request("/departments", "HR");
  assert.equal(departmentResponse.status, 200);
  assert.ok(departmentResponse.body.data.length > 0, "Cần có ít nhất một phòng ban");
  const departmentId = departmentResponse.body.data[0].id;
  const namePrefix = `program_test_dates_${Date.now()}`;
  const today = service.getVietnamToday();
  const base = {
    name: namePrefix,
    department_id: departmentId,
    start_date: today,
    end_date: today,
    status: "OPEN",
  };

  try {
    const created = await request("/programs", "HR", "POST", base);
    assert.equal(created.status, 201);
    const id = created.body.data.id;
    assert.equal(created.body.data.time_state, "RUNNING");
    assert.equal(created.body.data.duration_days, 1);
    assert.equal(created.body.data.days_remaining, 0);

    assert.equal((await request("/programs", "HR", "POST", null)).status, 400);
    assert.equal((await request("/programs", "HR", "POST", [])).status, 400);

    for (const role of ["Admin", "Mentor", "Intern"]) {
      assert.equal((await request(`/programs/${id}`, role, "PUT", base)).status, 403);
    }
    assert.equal((await request(`/programs/${id}`, null, "PUT", base)).status, 401);
    assert.equal((await request(`/programs/${id}`, "INVALID", "PUT", base)).status, 401);

    const runningFilter = await request("/programs?time_state=RUNNING", "HR");
    assert.equal(runningFilter.status, 200);
    assert.ok(runningFilter.body.data.some((program) => program.id === id));
    assert.equal((await request("/programs?time_state=BAD", "HR")).status, 400);

    const invalidUpdates = [
      { ...base, status: "OPEN", end_date: null },
      { ...base, start_date: "2028-02-30" },
      { ...base, start_date: "2028-01-01' OR 1=1 --" },
      { ...base, start_date: { unexpected: true } },
      { ...base, end_date: ["2028-01-01"] },
      { ...base, start_date: "2028-04-02", end_date: "2028-04-01" },
    ];
    for (const invalidUpdate of invalidUpdates) {
      const result = await request(`/programs/${id}`, "HR", "PUT", invalidUpdate);
      assert.equal(result.status, 400);
      const unchanged = await request(`/programs/${id}`, "HR");
      assert.equal(unchanged.status, 200);
      assert.equal(unchanged.body.data.start_date, today);
      assert.equal(unchanged.body.data.end_date, today);
      assert.equal(unchanged.body.data.status, "OPEN");
    }

    const overlapping = await request("/programs", "HR", "POST", {
      ...base,
      start_date: today,
      end_date: today,
    });
    assert.equal(overlapping.status, 409);

    const legacy = await request("/programs", "HR", "POST", {
      name: `${namePrefix}_legacy`,
      department_id: departmentId,
      status: "DRAFT",
    });
    assert.equal(legacy.status, 201);
    const editedLegacy = await request(
      `/programs/${legacy.body.data.id}`,
      "HR",
      "PUT",
      {
        name: `${namePrefix}_legacy`,
        department_id: departmentId,
        status: "CLOSED",
      },
    );
    assert.equal(editedLegacy.status, 200);
    assert.equal(editedLegacy.body.data.time_state, "UNSCHEDULED");
  } finally {
    await removeTestPrograms(departmentId, namePrefix);
  }
}

testProgramDatesApi().then(
  () => console.log("PROGRAM DATES API: create/update, filters, RBAC, bad-body safety PASS"),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
