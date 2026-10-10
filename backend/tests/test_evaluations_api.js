// Integration API test: mentor đánh giá tổng kết thực tập sinh (kỹ năng + thái độ).
// Cần MySQL + backend, chạy qua `npm test` hoặc `npm run test:evaluations-api`.
const mysql = require("mysql2/promise");
const {
  BASE_URL,
  loginAs,
  readDbConfig,
  cleanupTestData,
  confirmContractDirect,
} = require("./test_helpers");

const RUN_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const PREFIX = `evalx_test_${RUN_ID}`;
let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(` [PASS] ${name}`);
  } else {
    failed += 1;
    console.error(` [FAIL] ${name}${detail ? `: ${detail}` : ""}`);
  }
}

async function call(method, url, token, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${url}`, {
    method,
    headers,
    body: payload,
  });
  const contentType = res.headers.get("content-type") || "";
  const json = contentType.includes("application/json")
    ? await res.json().catch(() => null)
    : null;
  return { status: res.status, body: json };
}

async function expectStatus(name, code, method, url, token, body) {
  const res = await call(method, url, token, body);
  check(name, res.status === code, `nhận ${res.status}`);
  return res;
}

async function loginUser(email, password = "password123") {
  const res = await call("POST", "/auth/login", null, {
    account: email,
    password,
  });
  if (res.status !== 200 || !res.body?.token) {
    throw new Error(
      `Đăng nhập thất bại (${email}): ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.token;
}

async function createIntern(hrToken, label) {
  const email = `${PREFIX}_${label}@ictu.edu.vn`;
  const res = await call("POST", "/interns", hrToken, {
    fullName: `Intern Evaluation ${label}`,
    email,
    studentCode: `E${label}${Date.now().toString().slice(-5)}`,
    university: "ICTU University",
    major: "Kỹ thuật phần mềm",
  });
  if (res.status !== 201) {
    throw new Error(
      `Tạo intern ${label} thất bại: ${JSON.stringify(res.body)}`,
    );
  }
  return { id: Number((res.body.intern || res.body.student).id), email };
}

async function assignMentor(hrToken, internId, mentorId) {
  const res = await call("PUT", `/interns/${internId}/mentor`, hrToken, {
    mentor_id: mentorId,
  });
  if (res.status !== 200) {
    throw new Error(`Phân công mentor thất bại: ${JSON.stringify(res.body)}`);
  }
}

// Dựng dữ liệu: mentor 2; intern A (mentor 1), intern B (mentor 2), intern C (chưa có mentor).
async function setup(conn, emails) {
  const adminToken = await loginAs("Admin");
  const hrToken = await loginAs("HR");
  const mentor1Token = await loginAs("Mentor");

  const mentor2Email = `${PREFIX}_mentor2@ictu.edu.vn`;
  emails.push(mentor2Email);
  const mentorRes = await call("POST", "/users", adminToken, {
    name: "Mentor Evaluation Hai",
    email: mentor2Email,
    password: "password123",
    role: "Mentor",
  });
  if (![200, 201].includes(mentorRes.status)) {
    throw new Error(
      `Không tạo được mentor 2: ${JSON.stringify(mentorRes.body)}`,
    );
  }
  const mentor2Token = await loginUser(mentor2Email);

  const [m1] = await conn.query(
    "SELECT id FROM mentors WHERE LOWER(email) = LOWER(?)",
    ["mentor@gmail.com"],
  );
  const [m2] = await conn.query(
    "SELECT id FROM mentors WHERE LOWER(email) = LOWER(?)",
    [mentor2Email],
  );
  if (!m1.length || !m2.length) throw new Error("Thiếu hồ sơ mentor để test");

  const a = await createIntern(hrToken, "a");
  const b = await createIntern(hrToken, "b");
  const c = await createIntern(hrToken, "c");
  emails.push(a.email, b.email, c.email);
  await assignMentor(hrToken, a.id, Number(m1[0].id));
  await assignMentor(hrToken, b.id, Number(m2[0].id));
  // Đánh giá cần hợp đồng đã xác nhận: A, B có; C không có (dùng để test điều kiện này).
  await confirmContractDirect(conn, a.id);
  await confirmContractDirect(conn, b.id);

  return {
    mentor1Id: Number(m1[0].id),
    adminToken,
    hrToken,
    mentor1Token,
    mentor2Token,
    internAToken: await loginUser(a.email),
    a,
    b,
    c,
  };
}

const VALID = {
  skill_score: 4,
  skill_comment: "Nắm vững nghiệp vụ",
  attitude_score: 5,
  attitude_comment: "Chủ động, đúng giờ",
  overall_comment: "Hoàn thành tốt kỳ thực tập",
};

async function testPermissions(ctx) {
  const { adminToken, hrToken, internAToken, a } = ctx;
  const url = `/interns/${a.id}/evaluation`;

  for (const [method, body] of [
    ["GET"],
    ["PUT", VALID],
    ["DELETE"],
  ]) {
    await expectStatus(`${method} đánh giá không token`, 401, method, url, null, body);
    await expectStatus(`Intern không được ${method} đánh giá`, 403, method, url, internAToken, body);
    await expectStatus(`HR không được ${method} đánh giá`, 403, method, url, hrToken, body);
    await expectStatus(`Admin không được ${method} đánh giá`, 403, method, url, adminToken, body);
  }
  await expectStatus("Overview không token", 401, "GET", "/evaluations/overview", null);
  await expectStatus("Intern không xem overview", 403, "GET", "/evaluations/overview", internAToken);
  await expectStatus("HR không xem overview", 403, "GET", "/evaluations/overview", hrToken);
}

async function testSaveAndRead(ctx, conn) {
  const { mentor1Token, a } = ctx;
  const url = `/interns/${a.id}/evaluation`;

  const empty = await call("GET", url, mentor1Token);
  check(
    "Chưa đánh giá: GET trả 200 với data = null",
    empty.status === 200 && empty.body?.success === true && empty.body.data === null,
    JSON.stringify(empty.body),
  );

  const created = await call("PUT", url, mentor1Token, VALID);
  const d = created.body?.data;
  check(
    "Mentor tạo đánh giá cho intern của mình",
    created.status === 200 &&
      d?.skill_score === 4 &&
      d?.attitude_score === 5 &&
      d?.overall_score === 4.5 &&
      d?.overall_comment === VALID.overall_comment &&
      d?.intern_id === a.id,
    JSON.stringify(created.body),
  );

  const got = await call("GET", url, mentor1Token);
  check("GET trả lại đúng đánh giá", got.body?.data?.skill_comment === VALID.skill_comment);

  const updated = await call("PUT", url, mentor1Token, {
    skill_score: 2,
    attitude_score: 3,
    overall_comment: "Cần cố gắng thêm",
  });
  check(
    "Gửi lại thì cập nhật và điểm tổng tính lại",
    updated.status === 200 &&
      updated.body?.data?.overall_score === 2.5 &&
      updated.body?.data?.skill_comment === "",
    JSON.stringify(updated.body),
  );
  const [count] = await conn.query(
    "SELECT COUNT(*) AS n FROM intern_evaluations WHERE intern_id = ?",
    [a.id],
  );
  check("Mỗi intern chỉ có 1 đánh giá", Number(count[0].n) === 1);

  // Validate
  const bad = (name, body) =>
    expectStatus(name, 400, "PUT", url, mentor1Token, body);
  await bad("Thiếu điểm kỹ năng", { attitude_score: 3, overall_comment: "x" });
  await bad("Điểm kỹ năng = 0", { ...VALID, skill_score: 0 });
  await bad("Điểm thái độ = 6", { ...VALID, attitude_score: 6 });
  await bad("Điểm là chuỗi", { ...VALID, skill_score: "4" });
  await bad("Điểm không nguyên", { ...VALID, skill_score: 3.5 });
  await bad("Thiếu nhận xét tổng kết", { skill_score: 3, attitude_score: 3 });
  await bad("Nhận xét tổng kết rỗng", { ...VALID, overall_comment: "   " });
  await bad("Nhận xét quá 2000 ký tự", { ...VALID, overall_comment: "x".repeat(2001) });
  await bad("Trường lạ overall_score", { ...VALID, overall_score: 5 });
  await bad("Trường lạ mentor_id", { ...VALID, mentor_id: 1 });
  await expectStatus("Body không phải JSON object", 400, "PUT", url, mentor1Token, [1]);
  const after = await call("GET", url, mentor1Token);
  check(
    "Dữ liệu sai không làm đổi đánh giá đã lưu",
    after.body?.data?.overall_score === 2.5,
  );

  // XSS lưu nguyên văn bản
  const xss = await call("PUT", url, mentor1Token, {
    ...VALID,
    overall_comment: "<img src=x onerror=alert(1)>",
  });
  check(
    "Nhận xét chứa HTML được lưu nguyên văn",
    xss.body?.data?.overall_comment === "<img src=x onerror=alert(1)>",
  );
  await call("PUT", url, mentor1Token, VALID);
}

async function testIdor(ctx, conn) {
  const { mentor1Token, mentor2Token, a, b, c } = ctx;
  const urlB = `/interns/${b.id}/evaluation`;
  const urlA = `/interns/${a.id}/evaluation`;

  await expectStatus("Mentor 1 không đánh giá intern của mentor 2", 403, "PUT", urlB, mentor1Token, VALID);
  await expectStatus("Mentor 1 không đọc đánh giá intern của mentor 2", 403, "GET", urlB, mentor1Token);
  await expectStatus("Mentor 1 không xóa đánh giá intern của mentor 2", 403, "DELETE", urlB, mentor1Token);
  const [none] = await conn.query(
    "SELECT COUNT(*) AS n FROM intern_evaluations WHERE intern_id = ?",
    [b.id],
  );
  check("Bị từ chối thì không ghi dữ liệu", Number(none[0].n) === 0);

  await expectStatus("Mentor 2 không đọc đánh giá intern của mentor 1", 403, "GET", urlA, mentor2Token);
  await expectStatus("Mentor 2 không sửa đánh giá intern của mentor 1", 403, "PUT", urlA, mentor2Token, VALID);
  await expectStatus("Intern chưa có mentor: 403", 403, "PUT", `/interns/${c.id}/evaluation`, mentor1Token, VALID);
  // Có mentor nhưng chưa có hợp đồng xác nhận -> 409 (không ghi dữ liệu)
  await assignMentor(ctx.hrToken, c.id, ctx.mentor1Id);
  await expectStatus("Chưa có hợp đồng xác nhận: 409", 409, "PUT", `/interns/${c.id}/evaluation`, mentor1Token, VALID);
  const [noEval] = await conn.query(
    "SELECT COUNT(*) AS n FROM intern_evaluations WHERE intern_id = ?",
    [c.id],
  );
  check("Bị 409 thì không ghi đánh giá", Number(noEval[0].n) === 0);
  await expectStatus("Intern không tồn tại: 404", 404, "PUT", "/interns/999999999/evaluation", mentor1Token, VALID);
  await expectStatus("Mã intern không hợp lệ: 400", 400, "GET", "/interns/abc/evaluation", mentor1Token);

  await expectStatus("Mentor 2 đánh giá intern của mình", 200, "PUT", urlB, mentor2Token, VALID);
}

async function testOverview(ctx) {
  const { mentor1Token, mentor2Token, a, b } = ctx;
  const ov1 = await call("GET", "/evaluations/overview", mentor1Token);
  const data = ov1.body?.data;
  const rowA = data?.interns?.find((i) => i.intern_id === a.id);
  check(
    "Overview của mentor 1 có intern A đã đánh giá, điểm tổng 4.5",
    ov1.status === 200 && rowA?.has_evaluation === true && rowA?.overall_score === 4.5,
    JSON.stringify(ov1.body),
  );
  check(
    "Overview không lộ intern của mentor khác",
    !data?.interns?.some((i) => i.intern_id === b.id),
  );
  check(
    "Summary khớp số dòng",
    data?.summary?.total === data?.interns?.length &&
      data?.summary?.evaluated + data?.summary?.pending === data?.summary?.total,
  );
  const ov2 = await call("GET", "/evaluations/overview", mentor2Token);
  const rowB = ov2.body?.data?.interns?.find((i) => i.intern_id === b.id);
  check("Overview mentor 2 có intern B đã đánh giá", rowB?.has_evaluation === true);
}

async function testDeleteAndCascade(ctx, conn) {
  const { mentor1Token, hrToken, a, b } = ctx;
  const urlA = `/interns/${a.id}/evaluation`;

  const del = await call("DELETE", urlA, mentor1Token);
  check("Mentor xóa đánh giá của mình", del.status === 200 && del.body?.success === true);
  const got = await call("GET", urlA, mentor1Token);
  check("Sau khi xóa GET trả data = null", got.status === 200 && got.body?.data === null);
  await expectStatus("Xóa lần hai: 404", 404, "DELETE", urlA, mentor1Token);

  // CASCADE: xóa hồ sơ intern kéo theo đánh giá
  const [before] = await conn.query(
    "SELECT COUNT(*) AS n FROM intern_evaluations WHERE intern_id = ?",
    [b.id],
  );
  check("Có đánh giá trước khi xóa intern B", Number(before[0].n) === 1);
  // Hồ sơ đang giữ hợp đồng đã xác nhận thì không xóa được (409), nên gỡ hợp đồng test trước khi kiểm tra CASCADE.
  await conn.query("DELETE FROM internship_contracts WHERE intern_id = ?", [b.id]);
  const delIntern = await call("DELETE", `/interns/${b.id}`, hrToken);
  const [after] = await conn.query(
    "SELECT COUNT(*) AS n FROM intern_evaluations WHERE intern_id = ?",
    [b.id],
  );
  check(
    "Xóa hồ sơ intern kéo theo xóa đánh giá (CASCADE)",
    delIntern.status === 200 && Number(after[0].n) === 0,
  );
}

async function run() {
  console.log("\n====================================================");
  console.log(" BẮT ĐẦU INTEGRATION TEST ĐÁNH GIÁ THỰC TẬP SINH (API)");
  console.log("====================================================\n");

  const emails = [];
  const conn = await mysql.createConnection(readDbConfig());
  try {
    const ctx = await setup(conn, emails);
    await testPermissions(ctx);
    await testSaveAndRead(ctx, conn);
    await testIdor(ctx, conn);
    await testOverview(ctx);
    await testDeleteAndCascade(ctx, conn);
  } catch (err) {
    failed += 1;
    console.error(" [FAIL] Lỗi không mong đợi:", err);
  } finally {
    await conn.end();
    await cleanupTestData(emails);
  }

  console.log(`\n${passed} pass, ${failed} fail\n`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
