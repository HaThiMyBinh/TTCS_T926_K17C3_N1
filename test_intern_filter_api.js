const assert = require("assert");
const mysql = require("mysql2/promise");
const { BASE_URL, loginAs, readDbConfig, cleanupTestData } = require("./test_helpers");

(async () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random()*10000)}`;
  const fixtures = [
    { code: `IF_A_${suffix}`, name: "Nguyễn Ánh Test", university: `Đại học Bộ lọc ${suffix}`, major: "Khoa học dữ liệu", email: `intern_filter_a_${suffix}@example.test` },
    { code: `IF_B_${suffix}`, name: "Trần Bình Test", university: `Đại học Bộ lọc ${suffix}`, major: "Kỹ thuật phần mềm", email: `intern_filter_b_${suffix}@example.test` },
    { code: `IF_C_${suffix}`, name: "Lê Chi Test", university: `Trường Khác ${suffix}`, major: "Khoa học dữ liệu", email: `intern_filter_c_${suffix}@example.test` },
  ];
  const emails = fixtures.map((item) => item.email);
  const conn = await mysql.createConnection(readDbConfig());
  try {
    const hr = await loginAs("HR");
    const admin = await loginAs("Admin");
    const mentor = await loginAs("Mentor");
    const headers = (token) => ({ Authorization: `Bearer ${token}` });
    const unauth = await fetch(`${BASE_URL}/interns`);
    assert.strictEqual(unauth.status, 401);
    const unauthOptions = await fetch(`${BASE_URL}/interns/filter-options`);
    assert.strictEqual(unauthOptions.status, 401);
    const unauthCount = await fetch(`${BASE_URL}/interns/count`);
    assert.strictEqual(unauthCount.status, 401);
    const forbidden = await fetch(`${BASE_URL}/interns/filter-options`, { headers: headers(mentor) });
    assert.strictEqual(forbidden.status, 403);
    const forbiddenCount = await fetch(`${BASE_URL}/interns/count`, { headers: headers(mentor) });
    assert.strictEqual(forbiddenCount.status, 403);
    let res = await fetch(`${BASE_URL}/interns/filter-options`, { headers: headers(admin) });
    assert.strictEqual(res.status, 200);
    const options = await res.json();
    assert.ok(Array.isArray(options.universities) && Array.isArray(options.majors));

    const [mentorRows] = await conn.query("SELECT id FROM mentors WHERE LOWER(email)=LOWER(?)", ["mentor@gmail.com"]);
    assert.ok(mentorRows.length > 0, "Tài khoản mentor mẫu cần có hồ sơ mentor");
    for (let i = 0; i < fixtures.length; i++) {
      const item = fixtures[i];
      await conn.query("INSERT INTO intern_profiles (student_code, full_name, email, university, major, mentor_id) VALUES (?, ?, ?, ?, ?, ?)", [item.code, item.name, item.email, item.university, item.major, i === 0 ? mentorRows[0]?.id || null : null]);
    }
    const dependentOptionsRes = await fetch(
      `${BASE_URL}/interns/filter-options?university=${encodeURIComponent(fixtures[0].university)}`,
      { headers: headers(hr) },
    );
    const dependentOptions = await dependentOptionsRes.json();
    assert.deepStrictEqual(dependentOptions.majors, [fixtures[0].major, fixtures[1].major]);
    res = await fetch(`${BASE_URL}/interns/filter-options`, { headers: headers(hr) });
    const seededOptions = await res.json();
    assert.ok(seededOptions.universities.includes(fixtures[0].university));
    assert.ok(seededOptions.majors.includes(fixtures[0].major));
    assert.strictEqual(new Set(seededOptions.universities).size, seededOptions.universities.length);
    assert.strictEqual(new Set(seededOptions.majors).size, seededOptions.majors.length);
    const countRes = await fetch(`${BASE_URL}/interns/count`, {
      headers: headers(hr),
    });
    const countData = await countRes.json();
    const [dbCount] = await conn.query("SELECT COUNT(*) AS count FROM intern_profiles");
    assert.strictEqual(countData.count, Number(dbCount[0].count));
    const unassignedCountRes = await fetch(
      `${BASE_URL}/interns/count?unassigned=true`,
      { headers: headers(hr) },
    );
    const unassignedCount = await unassignedCountRes.json();
    const [dbUnassignedCount] = await conn.query("SELECT COUNT(*) AS count FROM intern_profiles WHERE mentor_id IS NULL");
    assert.strictEqual(unassignedCount.count, Number(dbUnassignedCount[0].count));
    const fetchList = async (token, query = "") => {
      const response = await fetch(`${BASE_URL}/interns${query}`, { headers: headers(token) });
      assert.strictEqual(response.status, 200);
      return response.json();
    };
    assert.strictEqual((await fetchList(hr, `?university=${encodeURIComponent(fixtures[0].university)}`)).length, 2);
    assert.strictEqual((await fetchList(hr, `?major=${encodeURIComponent(fixtures[0].major)}`)).length, 2);
    assert.strictEqual((await fetchList(hr, `?q=${encodeURIComponent("nguyen anh")}`)).length, 1);
    assert.strictEqual((await fetchList(hr, `?university=${encodeURIComponent(fixtures[0].university)}&major=${encodeURIComponent(fixtures[1].major)}`)).length, 1);
    assert.deepStrictEqual(await fetchList(hr, `?q=${encodeURIComponent(`khongco_${suffix}`)}`), []);
    const scoped = await fetchList(mentor, `?q=${encodeURIComponent(suffix)}`);
    assert.strictEqual(scoped.length, 1);
    assert.strictEqual(Number(scoped[0].mentorId), Number(mentorRows[0].id));
    assert.strictEqual(scoped[0].email, fixtures[0].email);
    const invalid = await fetch(`${BASE_URL}/interns?q=${encodeURIComponent("x".repeat(101))}`, { headers: headers(hr) });
    assert.strictEqual(invalid.status, 400);
    const repeated = await fetch(`${BASE_URL}/interns?q=a&q=b`, { headers: headers(hr) });
    assert.strictEqual(repeated.status, 400);
    const injection = await fetchList(hr, `?q=${encodeURIComponent("' OR 1=1 --")}`);
    assert.deepStrictEqual(injection, []);
    console.log("PASS test_intern_filter_api");
  } finally {
    await conn.end();
    await cleanupTestData(emails);
  }
})().catch((err) => { console.error(err); process.exitCode = 1; });
