// Integration API test: mentor phản hồi báo cáo tuần, thực tập sinh chỉ đọc phản hồi.
// Cần MySQL + backend, chạy qua `npm test` hoặc `npm run test:weekly-feedback-api`.
const mysql = require("mysql2/promise");
const {
  BASE_URL,
  loginAs,
  readDbConfig,
  cleanupTestData,
  confirmContractDirect,
} = require("./test_helpers");
const { getVietnamToday } = require("../utils/date");
const weeks = require("../utils/weeks");

const RUN_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const PREFIX = `wrfb_test_${RUN_ID}`;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    fullName: `Intern Feedback ${label}`,
    email,
    studentCode: `F${label}${Date.now().toString().slice(-5)}`,
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

// Dựng dữ liệu: mentor 2; intern A (mentor 1), intern B (mentor 2); cả hai đã nộp báo cáo tuần này.
async function setup(conn, emails) {
  const adminToken = await loginAs("Admin");
  const hrToken = await loginAs("HR");
  const mentor1Token = await loginAs("Mentor");

  const mentor2Email = `${PREFIX}_mentor2@ictu.edu.vn`;
  emails.push(mentor2Email);
  const mentorRes = await call("POST", "/users", adminToken, {
    name: "Mentor Feedback Hai",
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
  emails.push(a.email, b.email);
  await assignMentor(hrToken, a.id, Number(m1[0].id));
  await assignMentor(hrToken, b.id, Number(m2[0].id));
  await confirmContractDirect(conn, a.id);
  await confirmContractDirect(conn, b.id);

  const currentWeek = weeks.mondayOf(getVietnamToday());
  const internAToken = await loginUser(a.email);
  const internBToken = await loginUser(b.email);

  const submit = (token, content) =>
    call("PUT", "/me/weekly-reports", token, {
      week_start: currentWeek,
      content,
    });
  const ra = await submit(internAToken, "Báo cáo của A");
  const rb = await submit(internBToken, "Báo cáo của B");
  if (ra.status !== 200 || rb.status !== 200) {
    throw new Error(
      `Intern không nộp được báo cáo: ${JSON.stringify([ra.body, rb.body])}`,
    );
  }

  return {
    adminToken,
    hrToken,
    mentor1Token,
    mentor2Token,
    a,
    b,
    internAToken,
    internBToken,
    currentWeek,
    reportA: ra.body.data,
    reportB: rb.body.data,
    submit,
  };
}

async function testPermissions(ctx) {
  const { adminToken, hrToken, internAToken, reportA } = ctx;
  const url = `/weekly-reports/${reportA.id}/feedback`;
  const body = { content: "Thử" };

  await expectStatus("PUT feedback không token", 401, "PUT", url, null, body);
  await expectStatus("DELETE feedback không token", 401, "DELETE", url);
  await expectStatus(
    "Intern không được viết phản hồi",
    403,
    "PUT",
    url,
    internAToken,
    body,
  );
  await expectStatus(
    "Intern không được xóa phản hồi",
    403,
    "DELETE",
    url,
    internAToken,
  );
  await expectStatus(
    "HR không được viết phản hồi",
    403,
    "PUT",
    url,
    hrToken,
    body,
  );
  await expectStatus(
    "Admin không được viết phản hồi",
    403,
    "PUT",
    url,
    adminToken,
    body,
  );
  await expectStatus("HR không được xóa phản hồi", 403, "DELETE", url, hrToken);
}

async function testSubmitFeedback(ctx, conn) {
  const { mentor1Token, reportA } = ctx;
  const url = `/weekly-reports/${reportA.id}/feedback`;

  // Dữ liệu sai
  await expectStatus("Nội dung rỗng", 400, "PUT", url, mentor1Token, {
    content: "   ",
  });
  await expectStatus("Thiếu content", 400, "PUT", url, mentor1Token, {});
  await expectStatus(
    "content không phải chuỗi",
    400,
    "PUT",
    url,
    mentor1Token,
    {
      content: 123,
    },
  );
  await expectStatus("Quá 2000 ký tự", 400, "PUT", url, mentor1Token, {
    content: "x".repeat(2001),
  });
  await expectStatus("Không nhận trường lạ", 400, "PUT", url, mentor1Token, {
    content: "ok",
    mentor_id: 999,
  });
  await expectStatus(
    "Mã báo cáo sai định dạng",
    400,
    "PUT",
    "/weekly-reports/abc/feedback",
    mentor1Token,
    { content: "ok" },
  );
  await expectStatus(
    "Báo cáo không tồn tại",
    404,
    "PUT",
    "/weekly-reports/999999999/feedback",
    mentor1Token,
    { content: "ok" },
  );

  const [none] = await conn.query(
    "SELECT COUNT(*) AS n FROM weekly_report_feedback WHERE report_id = ?",
    [reportA.id],
  );
  check("Phản hồi lỗi không được ghi vào DB", Number(none[0].n) === 0);

  // Gửi thành công (có trim)
  const first = await call("PUT", url, mentor1Token, {
    content: "  Cần bổ sung số liệu  ",
  });
  const fb = first.body?.data?.feedback || {};
  check(
    "Mentor 1 phản hồi báo cáo của intern A",
    first.status === 200 && first.body?.success,
    `nhận ${first.status}`,
  );
  check("Nội dung được trim", fb.content === "Cần bổ sung số liệu");
  check(
    "Có tên mentor và thời gian",
    Boolean(fb.mentor_name) && Boolean(fb.created_at) && Boolean(fb.updated_at),
  );
  check(
    "Phản hồi vừa gửi không bị đánh dấu lỗi thời",
    first.body?.data?.feedback_outdated === false,
  );

  // Gửi lại: cập nhật, vẫn đúng 1 bản ghi
  const again = await call("PUT", url, mentor1Token, { content: "Đã tốt hơn" });
  check(
    "Gửi lại thì cập nhật nội dung",
    again.status === 200 &&
      again.body?.data?.feedback?.content === "Đã tốt hơn",
  );
  const [count] = await conn.query(
    "SELECT COUNT(*) AS n FROM weekly_report_feedback WHERE report_id = ?",
    [reportA.id],
  );
  check("Mỗi báo cáo chỉ có 1 phản hồi trong DB", Number(count[0].n) === 1);

  // Lưu thuần văn bản, không biến đổi (escape khi hiển thị ở frontend)
  const xss = "<img src=x onerror=alert(1)>";
  const raw = await call("PUT", url, mentor1Token, { content: xss });
  check(
    "Nội dung HTML được lưu nguyên dạng văn bản",
    raw.body?.data?.feedback?.content === xss,
  );
  await call("PUT", url, mentor1Token, { content: "Đã tốt hơn" });
}

async function testIdor(ctx, conn) {
  const { mentor2Token, reportA } = ctx;
  const url = `/weekly-reports/${reportA.id}/feedback`;
  const [before] = await conn.query(
    "SELECT content FROM weekly_report_feedback WHERE report_id = ?",
    [reportA.id],
  );

  await expectStatus(
    "Mentor 2 không phản hồi được báo cáo của intern A",
    403,
    "PUT",
    url,
    mentor2Token,
    { content: "xâm nhập" },
  );
  await expectStatus(
    "Mentor 2 không xóa được phản hồi của intern A",
    403,
    "DELETE",
    url,
    mentor2Token,
  );
  const [after] = await conn.query(
    "SELECT content FROM weekly_report_feedback WHERE report_id = ?",
    [reportA.id],
  );
  check(
    "Dữ liệu phản hồi không bị đổi bởi mentor khác",
    after.length === 1 && after[0].content === before[0].content,
  );
}

async function testVisibility(ctx) {
  const { mentor1Token, internAToken, internBToken, a, currentWeek } = ctx;

  // Intern A thấy phản hồi của chính mình (quyền SUBMIT_WORK đã được cấp ở run())
  const mine = await call("GET", "/me/weekly-reports", internAToken);
  const reportA = (mine.body?.data || []).find(
    (r) => r.week_start === currentWeek,
  );
  check(
    "Intern A thấy phản hồi của mentor trong báo cáo của mình",
    mine.status === 200 && reportA?.feedback?.content === "Đã tốt hơn",
    JSON.stringify(reportA?.feedback),
  );
  check(
    "Phản hồi trả về mentor_name",
    typeof reportA?.feedback?.mentor_name === "string" &&
      reportA.feedback.mentor_name.length > 0,
  );

  // Intern B chưa có phản hồi và không thấy phản hồi của A
  const mineB = await call("GET", "/me/weekly-reports", internBToken);
  check(
    "Intern B chưa có phản hồi (không thấy phản hồi của A)",
    mineB.status === 200 && mineB.body.data.every((r) => r.feedback === null),
  );

  // Trạng thái các tuần
  const status = await call("GET", "/me/weekly-reports/status", internAToken);
  const week = (status.body?.data?.weeks || []).find(
    (w) => w.week_start === currentWeek,
  );
  check(
    "Trạng thái tuần của Intern A có has_feedback = true",
    week?.has_feedback === true,
  );

  // Mentor 1 đọc phản hồi trong danh sách báo cáo
  const list = await call(
    "GET",
    `/weekly-reports?intern_id=${a.id}`,
    mentor1Token,
  );
  check(
    "Mentor 1 thấy phản hồi trong danh sách báo cáo",
    list.status === 200 &&
      list.body.data.some((r) => r.feedback?.content === "Đã tốt hơn"),
  );
}

async function testOverview(ctx) {
  const { mentor1Token, mentor2Token, a, b, currentWeek, reportB } = ctx;
  const q = `?week_start=${currentWeek}`;

  const ov1 = await call("GET", `/weekly-reports/overview${q}`, mentor1Token);
  const rowA = (ov1.body?.data?.interns || []).find(
    (r) => r.intern_id === a.id,
  );
  check(
    "Tổng quan mentor 1: intern A đã được phản hồi",
    ov1.status === 200 && rowA?.has_feedback === true,
  );
  check(
    "Tổng quan mentor 1: feedback_pending = số báo cáo đã nộp mà chưa phản hồi",
    ov1.body?.data?.summary?.feedback_pending ===
      (ov1.body?.data?.interns || []).filter(
        (r) => r.report_id && !r.has_feedback,
      ).length,
    JSON.stringify(ov1.body?.data?.summary),
  );

  const ov2 = await call("GET", `/weekly-reports/overview${q}`, mentor2Token);
  const rowB = (ov2.body?.data?.interns || []).find(
    (r) => r.intern_id === b.id,
  );
  check(
    "Tổng quan mentor 2: intern B đã nộp nhưng chưa được phản hồi",
    rowB?.has_feedback === false && rowB?.report_id === Number(reportB.id),
  );
  const pendingBefore = ov2.body?.data?.summary?.feedback_pending;
  check(
    "feedback_pending của mentor 2 >= 1",
    pendingBefore >= 1,
    String(pendingBefore),
  );

  await expectStatus(
    "Mentor 2 phản hồi báo cáo của intern B",
    200,
    "PUT",
    `/weekly-reports/${reportB.id}/feedback`,
    mentor2Token,
    { content: "B làm tốt" },
  );
  const ov3 = await call("GET", `/weekly-reports/overview${q}`, mentor2Token);
  const rowB2 = (ov3.body?.data?.interns || []).find(
    (r) => r.intern_id === b.id,
  );
  check(
    "Sau khi phản hồi: has_feedback = true và feedback_pending giảm 1",
    rowB2?.has_feedback === true &&
      ov3.body?.data?.summary?.feedback_pending === pendingBefore - 1,
    JSON.stringify(ov3.body?.data?.summary),
  );
}

async function testOutdated(ctx) {
  const { mentor1Token, internAToken, a, currentWeek, reportA, submit } = ctx;
  const url = `/weekly-reports/${reportA.id}/feedback`;

  // MySQL TIMESTAMP chính xác đến giây: chờ để mốc sửa báo cáo chắc chắn sau mốc phản hồi.
  await sleep(1200);
  const edit = await submit(
    internAToken,
    "A sửa báo cáo sau khi được phản hồi",
  );
  check("Intern A sửa lại báo cáo", edit.status === 200);

  const mine = await call("GET", "/me/weekly-reports", internAToken);
  const mineA = (mine.body?.data || []).find(
    (r) => r.week_start === currentWeek,
  );
  check(
    "Intern thấy cờ feedback_outdated = true sau khi sửa báo cáo",
    mineA?.feedback_outdated === true,
  );

  const list = await call(
    "GET",
    `/weekly-reports?intern_id=${a.id}`,
    mentor1Token,
  );
  const forMentor = (list.body?.data || []).find(
    (r) => r.week_start === currentWeek,
  );
  check(
    "Mentor thấy báo cáo đã được sửa sau phản hồi (feedback_outdated = true)",
    forMentor?.feedback_outdated === true,
  );
  const ov = await call(
    "GET",
    `/weekly-reports/overview?week_start=${currentWeek}`,
    mentor1Token,
  );
  const row = (ov.body?.data?.interns || []).find((r) => r.intern_id === a.id);
  check(
    "Tổng quan đánh dấu phản hồi lỗi thời",
    row?.feedback_outdated === true,
  );

  await sleep(1200);
  const refresh = await call("PUT", url, mentor1Token, {
    content: "Đã xem bản sửa",
  });
  check(
    "Mentor phản hồi lại thì hết lỗi thời",
    refresh.status === 200 && refresh.body?.data?.feedback_outdated === false,
  );
}

async function testDeleteAndCascade(ctx, conn) {
  const { mentor1Token, internAToken, hrToken, a, reportA, currentWeek } = ctx;
  const url = `/weekly-reports/${reportA.id}/feedback`;

  const del = await call("DELETE", url, mentor1Token);
  check(
    "Mentor xóa phản hồi của mình",
    del.status === 200 && del.body?.data?.feedback === null,
  );
  const mine = await call("GET", "/me/weekly-reports", internAToken);
  const mineA = (mine.body?.data || []).find(
    (r) => r.week_start === currentWeek,
  );
  check("Intern không còn thấy phản hồi sau khi xóa", mineA?.feedback === null);
  await expectStatus("Xóa lần hai", 404, "DELETE", url, mentor1Token);
  await expectStatus(
    "Xóa phản hồi của báo cáo không tồn tại",
    404,
    "DELETE",
    "/weekly-reports/999999999/feedback",
    mentor1Token,
  );
  const stillThere = await call("GET", "/me/weekly-reports", internAToken);
  check(
    "Xóa phản hồi không xóa báo cáo",
    (stillThere.body?.data || []).some((r) => r.id === reportA.id),
  );

  // CASCADE: xóa hồ sơ intern kéo theo báo cáo và phản hồi
  await call("PUT", url, mentor1Token, { content: "Phản hồi để test cascade" });
  const [before] = await conn.query(
    "SELECT COUNT(*) AS n FROM weekly_report_feedback WHERE report_id = ?",
    [reportA.id],
  );
  check("Có phản hồi trước khi xóa intern", Number(before[0].n) === 1);
  // Hồ sơ đang giữ hợp đồng đã xác nhận thì không xóa được (409), nên gỡ hợp đồng test trước khi kiểm tra CASCADE.
  await conn.query("DELETE FROM internship_contracts WHERE intern_id = ?", [a.id]);
  const delIntern = await call("DELETE", `/interns/${a.id}`, hrToken);
  const [after] = await conn.query(
    "SELECT COUNT(*) AS n FROM weekly_report_feedback WHERE report_id = ?",
    [reportA.id],
  );
  check(
    "Xóa hồ sơ intern kéo theo xóa phản hồi (CASCADE)",
    delIntern.status === 200 && Number(after[0].n) === 0,
  );
}

async function run() {
  console.log("\n====================================================");
  console.log(" BẮT ĐẦU INTEGRATION TEST PHẢN HỒI BÁO CÁO TUẦN (API)");
  console.log("====================================================\n");

  const emails = [];
  const conn = await mysql.createConnection(readDbConfig());
  let adminToken = null;
  let originalIntern = null;
  try {
    adminToken = await loginAs("Admin");
    // Mặc định Intern chưa có quyền nào nên test tự cấp SUBMIT_WORK rồi khôi phục ở finally.
    const perms = await (
      await fetch(`${BASE_URL}/permissions`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
    ).json();
    originalIntern = Array.isArray(perms.Intern) ? [...perms.Intern] : [];
    await call("POST", "/permissions/update", adminToken, {
      role: "Intern",
      permissions: ["SUBMIT_WORK"],
    });

    const ctx = await setup(conn, emails);
    await testPermissions(ctx);
    await testSubmitFeedback(ctx, conn);
    await testIdor(ctx, conn);
    await testVisibility(ctx);
    await testOverview(ctx);
    await testOutdated(ctx);
    await testDeleteAndCascade(ctx, conn);
  } catch (err) {
    failed += 1;
    console.error(" [FAIL] Lỗi không mong đợi:", err);
  } finally {
    if (adminToken && originalIntern) {
      await call("POST", "/permissions/update", adminToken, {
        role: "Intern",
        permissions: originalIntern,
      });
    }
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
