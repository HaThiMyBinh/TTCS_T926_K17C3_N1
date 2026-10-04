const assert = require("assert");
const mysql = require("mysql2/promise");
const { generateToken } = require("../auth");
const { BASE_URL, loginAs, readDbConfig } = require("./test_helpers");

const prefix = `mentor_assign_test_${Date.now()}_`;

async function call(path, token, method = "GET", body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const options = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE_URL}${path}`, options);
  return { status: response.status, body: await response.json() };
}

async function tokenFor(email) {
  const response = await call("/auth/login", null, "POST", {
    account: email,
    password: "password123",
  });
  assert.equal(response.status, 200, `Login test mentor failed: ${email}`);
  return response.body.token;
}

async function cleanup() {
  const conn = await mysql.createConnection(readDbConfig());
  try {
    await conn.beginTransaction();
    for (const table of ["intern_profiles", "mentors"]) {
      await conn.query(
        `DELETE FROM \`${table}\`
         WHERE LEFT(LOWER(email), CHAR_LENGTH(?)) = LOWER(?)`,
        [prefix.toLowerCase(), prefix.toLowerCase()],
      );
    }
    await conn.query(
      `DELETE u FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.role_name IN ('Intern', 'Mentor')
         AND LEFT(LOWER(u.email), CHAR_LENGTH(?)) = LOWER(?)`,
      [prefix.toLowerCase(), prefix.toLowerCase()],
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    await conn.end();
  }
}

async function testMentorAssignmentApi() {
  const hr = await loginAs("HR");
  const admin = await loginAs("Admin");
  const internToken = await loginAs("Intern");
  const mentorAEmail = `${prefix}a@example.test`;
  const mentorBEmail = `${prefix}b@example.test`;
  let mentorAId;
  let mentorBId;
  let studentId;

  try {
    for (const roleToken of [admin, await loginAs("Mentor"), internToken]) {
      assert.equal((await call("/interns/1/mentor", roleToken, "PUT", { mentor_id: null })).status, 403);
    }
    assert.equal((await call("/interns/1/mentor", null, "PUT", { mentor_id: null })).status, 401);

    const mentorA = await call("/mentors", hr, "POST", {
      fullName: "Mentor Assign Test A",
      email: mentorAEmail,
      department: "US9 test",
    });
    assert.equal(mentorA.status, 201);
    mentorAId = mentorA.body.mentor.id;
    const mentorB = await call("/mentors", hr, "POST", {
      fullName: "Mentor Assign Test B",
      email: mentorBEmail,
      department: "US9 test",
    });
    assert.equal(mentorB.status, 201);
    mentorBId = mentorB.body.mentor.id;

    const mentorAToken = await tokenFor(mentorAEmail);
    const mentorBToken = await tokenFor(mentorBEmail);
    const noProfileToken = generateToken({ id: 987654321, email: `${prefix}missing@example.test`, role: "Mentor" });
    assert.deepEqual((await call("/mentors/me/interns", noProfileToken)).body, []);
    assert.equal((await call("/mentors/me/interns", null)).status, 401);
    for (const roleToken of [hr, admin, internToken]) {
      assert.equal((await call("/mentors/me/interns", roleToken)).status, 403);
    }

    const created = await call("/interns", hr, "POST", {
      fullName: "US9 Assignment Student",
      email: `${prefix}student@example.test`,
      university: "US9 test university",
    });
    assert.equal(created.status, 201);
    studentId = created.body.student.id;
    const unassignedStudent = await call("/interns", hr, "POST", {
      fullName: "US9 Unassigned Student",
      email: `${prefix}unassigned@example.test`,
      university: "US9 test university",
    });
    assert.equal(unassignedStudent.status, 201);

    assert.equal((await call("/interns/not-an-id/mentor", hr, "PUT", { mentor_id: mentorAId })).status, 400);
    for (const mentorId of [String(mentorAId), [mentorAId], -1, "1 OR 1=1", 1.5]) {
      const invalid = await call(`/interns/${studentId}/mentor`, hr, "PUT", { mentor_id: mentorId });
      assert.equal(invalid.status, 400, `Expected 400 for mentor_id=${JSON.stringify(mentorId)}`);
    }
    assert.equal((await call("/interns/987654321/mentor", hr, "PUT", { mentor_id: null })).status, 404);
    assert.equal((await call(`/interns/${studentId}/mentor`, hr, "PUT", { mentor_id: 987654321 })).status, 404);

    const assignedA = await call(`/interns/${studentId}/mentor`, hr, "PUT", { mentor_id: mentorAId });
    assert.equal(assignedA.status, 200);
    assert.equal(Number(assignedA.body.student.mentorId), Number(mentorAId));
    assert.deepEqual((await call("/mentors/me/interns", mentorAToken)).body.map((s) => Number(s.id)), [Number(studentId)]);
    assert.deepEqual((await call("/mentors/me/interns", mentorBToken)).body, []);
    assert.deepEqual((await call("/interns", mentorAToken)).body.map((s) => Number(s.id)), [Number(studentId)]);
    assert.deepEqual((await call("/interns", mentorBToken)).body, []);
    assert.deepEqual((await call("/students", mentorAToken)).body.map((s) => Number(s.id)), [Number(studentId)]);
    assert.deepEqual((await call("/interns?unassigned=true", mentorAToken)).body, []);
    const hrList = await call("/interns", hr);
    const adminList = await call("/interns", await loginAs("Admin"));
    assert.equal(hrList.body.some((s) => Number(s.id) === Number(unassignedStudent.body.student.id)), true);
    assert.equal(adminList.body.some((s) => Number(s.id) === Number(unassignedStudent.body.student.id)), true);

    const reassignedB = await call(`/interns/${studentId}/mentor`, hr, "PUT", { mentor_id: mentorBId });
    assert.equal(reassignedB.status, 200);
    assert.deepEqual((await call("/mentors/me/interns", mentorAToken)).body, []);
    assert.deepEqual((await call("/mentors/me/interns", mentorBToken)).body.map((s) => Number(s.id)), [Number(studentId)]);

    const cleared = await call(`/interns/${studentId}/mentor`, hr, "PUT", { mentor_id: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.student.mentorName, "");
    const unassigned = await call("/interns?unassigned=true", hr);
    assert.equal(unassigned.body.some((student) => Number(student.id) === Number(studentId)), true);

    const unmatchedLegacyUpdate = await call(`/interns/${studentId}`, hr, "PUT", {
      fullName: "US9 Assignment Student",
      email: `${prefix}student@example.test`,
      university: "US9 test university",
      mentorName: "No matching mentor",
    });
    assert.equal(unmatchedLegacyUpdate.status, 200);
    assert.equal(unmatchedLegacyUpdate.body.student.mentorId, null);

    const legacyUpdate = await call(`/interns/${studentId}`, hr, "PUT", {
      fullName: "US9 Assignment Student",
      email: `${prefix}student@example.test`,
      university: "US9 test university",
      mentorName: "mentor assign test b",
    });
    assert.equal(legacyUpdate.status, 200);
    assert.equal(Number(legacyUpdate.body.student.mentorId), Number(mentorBId));

    const rename = await call(`/mentors/${mentorBId}`, hr, "PUT", {
      fullName: "Mentor Assign Test B Renamed",
      email: `${prefix}b-renamed@example.test`,
      department: "US9 test",
    });
    assert.equal(rename.status, 200);
    let students = await call("/interns", hr);
    assert.equal(students.body.find((student) => Number(student.id) === Number(studentId)).mentorName, "Mentor Assign Test B Renamed");
    assert.deepEqual((await call("/mentors/me/interns", mentorBToken)).body, []);
    const renamedMentorToken = await tokenFor(`${prefix}b-renamed@example.test`);
    assert.deepEqual((await call("/mentors/me/interns", renamedMentorToken)).body.map((s) => Number(s.id)), [Number(studentId)]);

    const deleted = await call(`/mentors/${mentorBId}`, hr, "DELETE");
    assert.equal(deleted.status, 200);
    mentorBId = null;
    students = await call("/interns", hr);
    const afterDelete = students.body.find((student) => Number(student.id) === Number(studentId));
    assert.equal(afterDelete.mentorId, null);
    assert.equal(afterDelete.mentorName, "");

    const mentorC = await call("/mentors", hr, "POST", {
      fullName: "Mentor Assign Test C",
      email: `${prefix}c@example.test`,
      department: "US9 test",
    });
    assert.equal(mentorC.status, 201);
    const raceResults = await Promise.all([
      call(`/interns/${studentId}/mentor`, hr, "PUT", { mentor_id: mentorC.body.mentor.id }),
      call(`/mentors/${mentorC.body.mentor.id}`, hr, "DELETE"),
    ]);
    assert.ok([200, 404].includes(raceResults[0].status), `Assignment raced with deletion: ${raceResults[0].status}`);
    assert.equal(raceResults[1].status, 200);
    students = await call("/interns", hr);
    const afterRace = students.body.find((student) => Number(student.id) === Number(studentId));
    assert.equal(afterRace.mentorId, null);
    assert.equal(afterRace.mentorName, "");
    console.log("MENTOR ASSIGNMENT API: RBAC, assignment, filters, sync, and safety PASS");
  } finally {
    await cleanup();
  }
}

testMentorAssignmentApi().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
