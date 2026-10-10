// Integration API test: thực tập sinh nộp báo cáo tuần, mentor xem (chỉ đọc).
// Cần MySQL + backend, chạy qua `npm test` hoặc `npm run test:weekly-reports-api`.
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
const PREFIX = `wr_test_${RUN_ID}`;
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
  if (body instanceof FormData) {
    payload = body; // fetch tự đặt Content-Type multipart
  } else if (body !== undefined) {
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
  return { status: res.status, body: json, headers: res.headers, raw: res };
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
    fullName: `Intern Report ${label}`,
    email,
    studentCode: `R${label}${Date.now().toString().slice(-5)}`,
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

const pdfForm = (name = "bao_cao.pdf") => {
  const form = new FormData();
  form.append(
    "file",
    new Blob([Buffer.from("%PDF-1.4 test")], { type: "application/pdf" }),
    name,
  );
  return form;
};

// Dựng dữ liệu: mentor 2; intern A (mentor 1, vào thực tập từ 3 tuần trước),
// intern B (mentor 2, mới vào hôm nay).
async function setup(conn, emails) {
  const adminToken = await loginAs("Admin");
  const hrToken = await loginAs("HR");
  const mentor1Token = await loginAs("Mentor");

  const mentor2Email = `${PREFIX}_mentor2@ictu.edu.vn`;
  emails.push(mentor2Email);
  const mentorRes = await call("POST", "/users", adminToken, {
    name: "Mentor Report Hai",
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
  // Nộp báo cáo cần hợp đồng đã xác nhận (hợp đồng test không có ngày nên kỳ thực tập vẫn tính từ ngày tạo hồ sơ).
  await confirmContractDirect(conn, a.id);
  await confirmContractDirect(conn, b.id);

  // Không có hợp đồng nên kỳ thực tập tính từ ngày tạo hồ sơ: lùi hồ sơ A về 3 tuần trước.
  const today = getVietnamToday();
  const currentWeek = weeks.mondayOf(today);
  const startA = weeks.addDays(currentWeek, -21);
  await conn.query("UPDATE intern_profiles SET created_at = ? WHERE id = ?", [
    `${startA} 10:00:00`,
    a.id,
  ]);

  return {
    adminToken,
    hrToken,
    mentor1Token,
    mentor2Token,
    a,
    b,
    internAToken: await loginUser(a.email),
    internBToken: await loginUser(b.email),
    today,
    currentWeek,
    prevWeek: weeks.addDays(currentWeek, -7),
  };
}

async function testPermissions(ctx) {
  const { adminToken, hrToken, mentor1Token, internAToken, currentWeek } = ctx;
  const setIntern = (permissions) =>
    call("POST", "/permissions/update", adminToken, {
      role: "Intern",
      permissions,
    });

  await expectStatus(
    "GET /me/weekly-reports không token",
    401,
    "GET",
    "/me/weekly-reports",
  );
  await expectStatus(
    "GET /weekly-reports không token",
    401,
    "GET",
    "/weekly-reports",
  );

  // Mặc định Intern chưa có quyền nào: phải bị chặn cho đến khi Admin tick SUBMIT_WORK
  await setIntern([]);
  await expectStatus(
    "Intern chưa có SUBMIT_WORK bị chặn nộp",
    403,
    "PUT",
    "/me/weekly-reports",
    internAToken,
    {
      week_start: currentWeek,
      content: "x",
    },
  );
  await expectStatus(
    "Intern chưa có SUBMIT_WORK bị chặn xem",
    403,
    "GET",
    "/me/weekly-reports/status",
    internAToken,
  );
  await setIntern(["SUBMIT_WORK"]);
  await expectStatus(
    "Intern có SUBMIT_WORK xem được",
    200,
    "GET",
    "/me/weekly-reports",
    internAToken,
  );

  await expectStatus(
    "Mentor không dùng API nộp báo cáo",
    403,
    "PUT",
    "/me/weekly-reports",
    mentor1Token,
    {
      week_start: currentWeek,
      content: "x",
    },
  );
  await expectStatus(
    "HR không dùng API nộp báo cáo",
    403,
    "GET",
    "/me/weekly-reports",
    hrToken,
  );
  await expectStatus(
    "Intern không xem được tổng quan của mentor",
    403,
    "GET",
    "/weekly-reports/overview",
    internAToken,
  );
  await expectStatus(
    "HR không xem báo cáo của mentor",
    403,
    "GET",
    "/weekly-reports",
    hrToken,
  );
}

async function testSubmit(ctx, conn) {
  const { internAToken, internBToken, currentWeek, prevWeek, today } = ctx;
  const put = (token, body) => call("PUT", "/me/weekly-reports", token, body);
  const bad = async (name, body) => {
    const res = await put(internAToken, body);
    check(name, res.status === 400, `nhận ${res.status}`);
  };

  await bad("Thiếu week_start", { content: "x" });
  await bad("Tuần không phải thứ Hai", {
    week_start: weeks.addDays(currentWeek, 1),
    content: "x",
  });
  await bad("Tuần tương lai", {
    week_start: weeks.addDays(currentWeek, 7),
    content: "x",
  });
  await bad("Nội dung rỗng", { week_start: currentWeek, content: "   " });
  await bad("Nội dung quá 5000 ký tự", {
    week_start: currentWeek,
    content: "x".repeat(5001),
  });
  await bad("Không nhận trường lạ", {
    week_start: currentWeek,
    content: "x",
    is_late: false,
  });

  // Nộp đúng hạn tuần hiện tại
  const first = await put(internAToken, {
    week_start: currentWeek,
    content: "  Hoàn thành module đăng nhập  ",
    difficulties: "Thiếu tài liệu API",
    next_plan: "Viết test",
  });
  check(
    "Nộp báo cáo tuần hiện tại",
    first.status === 200 && first.body?.success,
  );
  const report = first.body?.data || {};
  check("Báo cáo đúng hạn (is_late = false)", report.is_late === false);
  check("Nội dung được trim", report.content === "Hoàn thành module đăng nhập");
  check(
    "Hạn nộp là hết Chủ nhật 23:59",
    report.week_end === weeks.weekEndOf(currentWeek) &&
      report.deadline === `${weeks.weekEndOf(currentWeek)} 23:59`,
  );

  // Nộp lại cùng tuần: cập nhật bản cũ
  const again = await put(internAToken, {
    week_start: currentWeek,
    content: "Bản sửa",
  });
  check(
    "Nộp lại cùng tuần giữ nguyên id và cập nhật nội dung",
    again.status === 200 &&
      again.body.data.id === report.id &&
      again.body.data.content === "Bản sửa",
  );
  const [count] = await conn.query(
    "SELECT COUNT(*) AS n FROM weekly_reports WHERE intern_id = ? AND week_start = ?",
    [ctx.a.id, currentWeek],
  );
  check("Mỗi tuần chỉ có 1 báo cáo trong DB", Number(count[0].n) === 1);

  // Nộp bù tuần trước: trễ hạn
  const late = await put(internAToken, {
    week_start: prevWeek,
    content: "Nộp bù tuần trước",
  });
  check(
    "Nộp bù tuần trước bị gắn nhãn trễ",
    late.status === 200 && late.body.data.is_late === true,
  );
  const lateEdit = await put(internAToken, {
    week_start: prevWeek,
    content: "Sửa lại",
  });
  check("Sửa lại không đổi nhãn trễ", lateEdit.body?.data?.is_late === true);

  // Intern B mới vào hôm nay: tuần trước nằm ngoài kỳ thực tập
  const outside = await put(internBToken, {
    week_start: prevWeek,
    content: "x",
  });
  check(
    "Không nộp được tuần trước khi vào thực tập",
    outside.status === 400,
    `nhận ${outside.status}`,
  );
  const okB = await put(internBToken, {
    week_start: currentWeek,
    content: "B nộp",
  });
  check("Intern mới nộp được tuần hiện tại", okB.status === 200);
  void today;

  const list = await call("GET", "/me/weekly-reports", internAToken);
  check(
    "Danh sách báo cáo của tôi (mới nhất trước)",
    list.status === 200 &&
      list.body.data.length === 2 &&
      list.body.data[0].week_start === currentWeek,
  );
  return report;
}

async function testStatus(ctx) {
  const { internAToken, internBToken, currentWeek } = ctx;
  const res = await call("GET", "/me/weekly-reports/status", internAToken);
  const data = res.body?.data || {};
  check(
    "GET /me/weekly-reports/status trả 200",
    res.status === 200 && res.body?.success,
  );
  check(
    "4 tuần cần nộp (từ 3 tuần trước đến tuần này)",
    Array.isArray(data.weeks) && data.weeks.length === 4,
    JSON.stringify((data.weeks || []).map((w) => w.week_start)),
  );
  check(
    "Trạng thái từng tuần: đã nộp / trễ / chưa nộp",
    JSON.stringify((data.weeks || []).map((w) => w.status)) ===
      JSON.stringify(["SUBMITTED", "LATE_SUBMITTED", "MISSING", "MISSING"]),
    JSON.stringify((data.weeks || []).map((w) => w.status)),
  );
  check(
    "Tổng hợp trạng thái",
    data.summary?.submitted === 1 &&
      data.summary?.late_submitted === 1 &&
      data.summary?.missing === 2,
    JSON.stringify(data.summary),
  );
  check("Tuần hiện tại đúng", data.current_week_start === currentWeek);

  // Nộp bù tuần xa nhất rồi kiểm tra lại
  const oldest = data.weeks[data.weeks.length - 1].week_start;
  const makeUp = await call("PUT", "/me/weekly-reports", internAToken, {
    week_start: oldest,
    content: "Nộp bù tuần cũ",
  });
  check(
    "Nộp bù tuần xa nhất",
    makeUp.status === 200 && makeUp.body.data.is_late === true,
  );
  const after = await call("GET", "/me/weekly-reports/status", internAToken);
  check(
    "Số tuần thiếu giảm sau khi nộp bù",
    after.body.data.summary.missing === 1,
  );

  const statusB = await call("GET", "/me/weekly-reports/status", internBToken);
  check(
    "Intern mới chỉ có 1 tuần cần nộp",
    statusB.body.data.weeks.length === 1 &&
      statusB.body.data.weeks[0].week_start === currentWeek,
  );
}

async function testMentor(ctx) {
  const { mentor1Token, mentor2Token, a, b, currentWeek, prevWeek } = ctx;
  const q = (week) => (week ? `?week_start=${week}` : "");

  const ov = await call(
    "GET",
    `/weekly-reports/overview${q(currentWeek)}`,
    mentor1Token,
  );
  const rows = ov.body?.data?.interns || [];
  const rowA = rows.find((r) => r.intern_id === a.id);
  check(
    "Mentor 1 thấy intern A đã nộp tuần này",
    ov.status === 200 && rowA?.status === "SUBMITTED",
  );
  check(
    "Mentor 1 không thấy intern của mentor 2",
    !rows.some((r) => r.intern_id === b.id),
  );

  const ov2 = await call(
    "GET",
    `/weekly-reports/overview${q(currentWeek)}`,
    mentor2Token,
  );
  const rowB = (ov2.body?.data?.interns || []).find(
    (r) => r.intern_id === b.id,
  );
  check("Mentor 2 thấy intern B đã nộp", rowB?.status === "SUBMITTED");

  const prev = await call(
    "GET",
    `/weekly-reports/overview${q(prevWeek)}`,
    mentor1Token,
  );
  const prevA = (prev.body?.data?.interns || []).find(
    (r) => r.intern_id === a.id,
  );
  check(
    "Tuần trước: intern A hiện là nộp trễ",
    prevA?.status === "LATE_SUBMITTED",
  );
  const prevB =
    (await call("GET", `/weekly-reports/overview${q(prevWeek)}`, mentor2Token))
      .body?.data?.interns || [];
  check(
    "Tuần trước: intern B (mới vào) không có trong bảng",
    !prevB.some((r) => r.intern_id === b.id),
  );

  const dflt = await call("GET", "/weekly-reports/overview", mentor1Token);
  check(
    "Không truyền tuần thì mặc định tuần hiện tại",
    dflt.body?.data?.week_start === currentWeek,
  );
  await expectStatus(
    "Tổng quan tuần tương lai",
    400,
    "GET",
    `/weekly-reports/overview${q(weeks.addDays(currentWeek, 7))}`,
    mentor1Token,
  );
  await expectStatus(
    "Tổng quan tuần không phải thứ Hai",
    400,
    "GET",
    `/weekly-reports/overview${q(weeks.addDays(currentWeek, 1))}`,
    mentor1Token,
  );

  const list = await call(
    "GET",
    `/weekly-reports?intern_id=${a.id}`,
    mentor1Token,
  );
  check(
    "Mentor 1 đọc được báo cáo của intern A",
    list.status === 200 &&
      list.body.data.length >= 2 &&
      list.body.data.every((r) => r.intern_id === a.id),
  );
  await expectStatus(
    "Mentor 2 không đọc được báo cáo của intern A",
    403,
    "GET",
    `/weekly-reports?intern_id=${a.id}`,
    mentor2Token,
  );
  const all = await call(
    "GET",
    `/weekly-reports${q(currentWeek)}`,
    mentor2Token,
  );
  check(
    "Danh sách của mentor 2 chỉ có intern của mình",
    all.status === 200 && all.body.data.every((r) => r.intern_id === b.id),
  );
  await expectStatus(
    "Mentor sửa báo cáo bị chặn",
    403,
    "PUT",
    "/me/weekly-reports",
    mentor1Token,
    {
      week_start: currentWeek,
      content: "x",
    },
  );
}

async function testAttachments(ctx, report) {
  const { internAToken, internBToken, mentor1Token, mentor2Token } = ctx;
  const base = `/me/weekly-reports/${report.id}/attachments`;

  const up = await call("POST", base, internAToken, pdfForm("Báo cáo.pdf"));
  check(
    "Intern đính kèm PDF vào báo cáo",
    up.status === 201 && up.body?.success,
  );
  const att = up.body?.data?.attachment || {};
  check(
    "Không lộ stored_name",
    att.stored_name === undefined && att.mime_type === "application/pdf",
  );

  const bad = new FormData();
  bad.append("file", new Blob([Buffer.from("MZ....")]), "virus.pdf");
  await expectStatus(
    "File thực thi đổi đuôi bị từ chối",
    400,
    "POST",
    base,
    internAToken,
    bad,
  );
  await expectStatus(
    "Thiếu file",
    400,
    "POST",
    base,
    internAToken,
    new FormData(),
  );
  await expectStatus(
    "Intern khác không đính kèm vào báo cáo của A",
    403,
    "POST",
    base,
    internBToken,
    pdfForm(),
  );

  const url = `/weekly-reports/${report.id}/attachments/${att.id}/download`;
  const dl = await call("GET", url, internAToken);
  check(
    "Chủ báo cáo tải được file",
    dl.status === 200 &&
      dl.headers.get("content-type")?.includes("application/pdf"),
  );
  const mentorDl = await call("GET", url, mentor1Token);
  check("Mentor phụ trách tải được file", mentorDl.status === 200);
  await expectStatus(
    "Mentor khác không tải được file",
    403,
    "GET",
    url,
    mentor2Token,
  );
  await expectStatus(
    "Intern khác không tải được file",
    403,
    "GET",
    url,
    internBToken,
  );
  await expectStatus("Không token không tải được file", 401, "GET", url);

  // Giới hạn 5 file
  for (let i = 0; i < 4; i++)
    await call("POST", base, internAToken, pdfForm(`f${i}.pdf`));
  await expectStatus(
    "Quá 5 file bị từ chối",
    409,
    "POST",
    base,
    internAToken,
    pdfForm("thua.pdf"),
  );

  await expectStatus(
    "Intern khác không xóa được file",
    403,
    "DELETE",
    `${base}/${att.id}`,
    internBToken,
  );
  await expectStatus(
    "Intern xóa file của mình",
    200,
    "DELETE",
    `${base}/${att.id}`,
    internAToken,
  );
  await expectStatus("Tải file đã xóa", 404, "GET", url, internAToken);
  await expectStatus(
    "Xóa lần hai",
    404,
    "DELETE",
    `${base}/${att.id}`,
    internAToken,
  );
}

async function testCascade(ctx, conn, report) {
  // Hồ sơ đang giữ hợp đồng đã xác nhận thì không xóa được (409), nên gỡ hợp đồng test trước khi kiểm tra CASCADE.
  await conn.query("DELETE FROM internship_contracts WHERE intern_id = ?", [ctx.a.id]);
  const del = await call("DELETE", `/interns/${ctx.a.id}`, ctx.hrToken);
  const [reports] = await conn.query(
    "SELECT COUNT(*) AS n FROM weekly_reports WHERE intern_id = ?",
    [ctx.a.id],
  );
  const [files] = await conn.query(
    "SELECT COUNT(*) AS n FROM weekly_report_attachments WHERE report_id = ?",
    [report.id],
  );
  check(
    "Xóa hồ sơ intern kéo theo xóa báo cáo và file đính kèm",
    del.status === 200 &&
      Number(reports[0].n) === 0 &&
      Number(files[0].n) === 0,
  );
}

async function run() {
  console.log("\n====================================================");
  console.log(" BẮT ĐẦU INTEGRATION TEST BÁO CÁO TUẦN (API)");
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

    const ctx = await setup(conn, emails);
    await testPermissions(ctx);
    const report = await testSubmit(ctx, conn);
    await testStatus(ctx);
    await testMentor(ctx);
    await testAttachments(ctx, report);
    await testCascade(ctx, conn, report);
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
