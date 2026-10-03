const assert = require("assert");
const mysql = require("mysql2/promise");
const { BASE_URL, loginAs, readDbConfig } = require("./test_helpers");

async function call(path, role, method = "GET", body) {
  const headers = {};
  if (role === "INVALID") {
    headers.Authorization = "Bearer invalid-token";
  } else if (role) {
    headers.Authorization = `Bearer ${await loginAs(role)}`;
  }
  if (body) headers["Content-Type"] = "application/json";

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

async function cleanupProgramTestData(departmentId, namePrefix) {
  const conn = await mysql.createConnection(readDbConfig());
  try {
    await conn.query(
      `UPDATE internship_programs SET status = 'DRAFT'
       WHERE department_id = ? AND LEFT(name, CHAR_LENGTH(?)) = ?`,
      [departmentId, namePrefix, namePrefix],
    );
    await conn.query(
      `DELETE FROM internship_programs
       WHERE department_id = ? AND LEFT(name, CHAR_LENGTH(?)) = ?`,
      [departmentId, namePrefix, namePrefix],
    );
    await conn.query(
      "DELETE FROM departments WHERE id = ? AND LEFT(name, CHAR_LENGTH(?)) = ?",
      [departmentId, namePrefix, namePrefix],
    );
  } finally {
    await conn.end();
  }
}

async function testProgramApi() {
  let response = await call("/departments", "Mentor");
  assert.equal(response.status, 200);

  response = await call("/programs", "Admin", "POST", {});
  assert.equal(response.status, 403);
  response = await call("/programs", "Mentor", "POST", {});
  assert.equal(response.status, 403);
  response = await call("/programs", "Intern", "POST", {});
  assert.equal(response.status, 403);
  response = await call("/programs", null);
  assert.equal(response.status, 401);
  response = await call("/programs", "INVALID");
  assert.equal(response.status, 401);

  const uniqueName = `program_test_${Date.now()}`;
  const departmentResponse = await call("/departments", "HR", "POST", {
    name: uniqueName,
  });
  assert.equal(departmentResponse.status, 201);
  const department = departmentResponse.body.data;

  const createResponse = await call("/programs", "HR", "POST", {
    name: uniqueName,
    department_id: department.id,
    start_date: "2026-01-01",
    end_date: "2026-03-01",
    capacity: 2,
  });
  assert.equal(createResponse.status, 201);
  const programId = createResponse.body.data.id;

  try {
    assert.equal((await call("/programs", "Admin")).status, 200);
    const filtered = await call(
      `/programs?department_id=${department.id}&status=DRAFT`,
      "HR",
    );
    assert.equal(filtered.body.data.some((item) => item.id === programId), true);

    const invalidInputs = [
      {},
      { name: "x" },
      { name: "x", department_id: 999999999 },
      { name: "x".repeat(256), department_id: department.id },
      {
        name: "x",
        department_id: department.id,
        description: "x".repeat(2001),
      },
      { name: "x", department_id: department.id, start_date: "2025-2-01" },
      { name: "x", department_id: department.id, start_date: "2025-02-30" },
      {
        name: "x",
        department_id: department.id,
        start_date: "2026-03-01",
        end_date: "2026-02-01",
      },
      { name: "x", department_id: department.id, capacity: 0 },
      { name: "x", department_id: department.id, capacity: 1.5 },
      { name: "x", department_id: department.id, status: "NO" },
    ];

    for (const invalidInput of invalidInputs) {
      const invalidResponse = await call(
        "/programs",
        "HR",
        "POST",
        invalidInput,
      );
      assert.ok([400, 404].includes(invalidResponse.status));
    }

    const overlappingDuplicate = await call("/programs", "HR", "POST", {
      name: uniqueName,
      department_id: department.id,
      start_date: "2026-02-15",
      end_date: "2026-04-01",
    });
    assert.equal(overlappingDuplicate.status, 409);

    const concurrentName = `${uniqueName}_concurrent`;
    const concurrentPayload = {
      name: concurrentName,
      department_id: department.id,
      start_date: "2026-05-01",
      end_date: "2026-06-01",
    };
    const concurrentResults = await Promise.all([
      call("/programs", "HR", "POST", concurrentPayload),
      call("/programs", "HR", "POST", concurrentPayload),
    ]);
    assert.deepEqual(
      concurrentResults.map((item) => item.status).sort(),
      [201, 409],
      "Hai request đồng thời trùng lịch chỉ được tạo một chương trình",
    );

    assert.equal((await call("/programs/not-an-id", "HR")).status, 400);
    const updateResponse = await call(
      `/programs/${programId}`,
      "HR",
      "PUT",
      {
        name: uniqueName,
        department_id: department.id,
        start_date: "2026-01-01",
        end_date: "2026-03-01",
      },
    );
    assert.equal(updateResponse.status, 200);

    await call(`/programs/${programId}`, "HR", "PUT", {
      name: uniqueName,
      department_id: department.id,
      status: "ONGOING",
    });
    assert.equal((await call(`/programs/${programId}`, "HR", "DELETE")).status, 409);
    assert.equal(
      (await call(`/departments/${department.id}`, "HR", "DELETE")).status,
      409,
    );
  } finally {
    await cleanupProgramTestData(department.id, uniqueName);
  }
}

testProgramApi().then(
  () => console.log("PROGRAM API: auth, CRUD, filters, validation, concurrency PASS"),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
