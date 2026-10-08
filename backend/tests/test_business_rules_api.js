// Integration API test các luật nghiệp vụ bổ sung:
//  - US6: ứng viên bị từ chối được nộp lại hồ sơ bằng cùng email
//  - US5: require_documents:false không còn bỏ qua điều kiện đủ tài liệu
//  - US10: đổi ngày hợp đồng đã xác nhận thì phải xác nhận lại
//  - US13: ngày hợp đồng phải nằm trong khoảng ngày chương trình
// Cần MySQL + backend, chạy qua `npm test` hoặc `npm run test:business-rules-api`.
const mysql = require("mysql2/promise");
const {
  BASE_URL,
  loginAs,
  readDbConfig,
  cleanupTestData,
  confirmContractDirect,
} = require("./test_helpers");

const RUN_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const PREFIX = `bizrule_test_${RUN_ID}`;
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
  const json = (res.headers.get("content-type") || "").includes("json")
    ? await res.json().catch(() => null)
    : null;
  return { status: res.status, body: json };
}

function register(email, name = "Ứng viên nộp lại") {
  return call("POST", "/auth/register", null, {
    name,
    email,
    password: "password123",
    phone: "0987654321",
    university: "ICTU University",
    major: "Kỹ thuật phần mềm",
  });
}

async function findApplication(hrToken, email) {
  const res = await call("GET", "/applications", hrToken);
  return (res.body?.data || []).find(
    (a) => String(a.email).toLowerCase() === email.toLowerCase(),
  );
}

// ---------- US6 + US5: nộp lại sau khi bị từ chối, không bỏ qua điều kiện tài liệu ----------
async function testReapply(hrToken, conn, emails) {
  const email = `${PREFIX}_reapply@ictu.edu.vn`;
  emails.push(email);

  const first = await register(email);
  check("Đăng ký lần đầu: 201", first.status === 201, JSON.stringify(first.body));

  const dup = await register(email);
  check("Đang chờ duyệt mà đăng ký lại cùng email: 400", dup.status === 400);

  const app = await findApplication(hrToken, email);
  check("HR thấy hồ sơ vừa đăng ký", Boolean(app));

  // US5: không có cách nào bỏ qua điều kiện đủ tài liệu
  const bypass = await call("PATCH", `/applications/${app.id}/status`, hrToken, {
    status: "APPROVED",
    require_documents: false,
  });
  check(
    "Duyệt thiếu tài liệu kể cả có require_documents:false: 400",
    bypass.status === 400,
    JSON.stringify(bypass.body),
  );

  const reject = await call("PATCH", `/applications/${app.id}/status`, hrToken, {
    status: "REJECTED",
    rejection_reason: "Hồ sơ chưa phù hợp",
  });
  check("HR từ chối hồ sơ: 200", reject.status === 200, JSON.stringify(reject.body));

  const [lockedUser] = await conn.query(
    "SELECT status FROM users WHERE LOWER(email) = LOWER(?)",
    [email],
  );
  check("Tài khoản bị khóa sau khi từ chối", lockedUser[0]?.status === "LOCKED");

  const again = await register(email, "Tên mới sau khi nộp lại");
  check(
    "Bị từ chối thì được nộp lại bằng cùng email: 201",
    again.status === 201 && again.body?.candidate?.status === "Chờ duyệt",
    JSON.stringify(again.body),
  );

  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM candidate_profiles WHERE LOWER(email) = LOWER(?)`,
    [email],
  );
  check("Vẫn chỉ có 1 hồ sơ ứng tuyển cho email này", Number(rows[0].n) === 1);

  const reopened = await findApplication(hrToken, email);
  check(
    "Hồ sơ về Chờ duyệt, xóa lý do từ chối, cập nhật tên",
    reopened?.status === "PENDING" &&
      !reopened.rejection_reason &&
      reopened.name === "Tên mới sau khi nộp lại",
    JSON.stringify(reopened),
  );

  const [user] = await conn.query(
    "SELECT status FROM users WHERE LOWER(email) = LOWER(?)",
    [email],
  );
  check("Tài khoản được mở lại (PENDING)", user[0]?.status === "PENDING");

  const login = await call("POST", "/auth/login", null, {
    account: email,
    password: "password123",
  });
  check("Đăng nhập lại được sau khi nộp lại", login.status === 200);

  const again2 = await register(email);
  check("Nộp lại lần nữa khi đang chờ duyệt: 400", again2.status === 400);
}

async function createIntern(hrToken, label, emails) {
  const email = `${PREFIX}_${label}@ictu.edu.vn`;
  const res = await call("POST", "/interns", hrToken, {
    fullName: `Intern BizRule ${label}`,
    email,
    studentCode: `B${label}${Date.now().toString().slice(-5)}`,
    university: "ICTU University",
    major: "Kỹ thuật phần mềm",
  });
  if (res.status !== 201) {
    throw new Error(`Tạo intern thất bại: ${JSON.stringify(res.body)}`);
  }
  emails.push(email);
  return Number((res.body.intern || res.body.student).id);
}

const patchContract = (hrToken, internId, contractId, body) =>
  call("PATCH", `/interns/${internId}/contracts/${contractId}`, hrToken, body);

// ---------- US10: đổi ngày hợp đồng đã xác nhận -> xác nhận lại ----------
async function testReconfirm(hrToken, conn, emails) {
  const internId = await createIntern(hrToken, "reconfirm", emails);
  const contractId = await confirmContractDirect(conn, internId, {
    startDate: "2026-06-01",
    endDate: "2026-12-01",
  });
  const status = async () => {
    const [rows] = await conn.query(
      "SELECT confirmation_status AS s, confirmed_at AS at FROM internship_contracts WHERE id = ?",
      [contractId],
    );
    return rows[0];
  };

  const same = await patchContract(hrToken, internId, contractId, {
    end_date: "2026-12-01",
  });
  check(
    "Gửi lại đúng ngày cũ: vẫn đã xác nhận",
    same.status === 200 && (await status()).s === "CONFIRMED",
  );

  const changed = await patchContract(hrToken, internId, contractId, {
    end_date: "2027-01-15",
  });
  const after = await status();
  check(
    "Đổi ngày của hợp đồng đã xác nhận: về PENDING, xóa thời điểm xác nhận",
    changed.status === 200 &&
      changed.body?.data?.confirmation_status === "PENDING" &&
      changed.body?.data?.reconfirmation_required === true &&
      after.s === "PENDING" &&
      after.at === null,
    JSON.stringify(changed.body),
  );

  // Hợp đồng chờ xác nhận thì sửa ngày không phát sinh yêu cầu gì thêm
  const again = await patchContract(hrToken, internId, contractId, {
    end_date: "2027-02-01",
  });
  check(
    "Hợp đồng đang chờ xác nhận đổi ngày: 200, không cờ xác nhận lại",
    again.status === 200 && again.body?.data?.reconfirmation_required === undefined,
  );

  // Điền ngày vào hợp đồng đã xác nhận nhưng chưa có ngày -> giữ nguyên xác nhận
  const blankId = await confirmContractDirect(conn, internId);
  const filled = await patchContract(hrToken, internId, blankId, {
    start_date: "2026-08-01",
    end_date: "2027-02-01",
  });
  const [blankRows] = await conn.query(
    "SELECT confirmation_status AS s FROM internship_contracts WHERE id = ?",
    [blankId],
  );
  check(
    "Điền ngày vào chỗ trống: giữ nguyên trạng thái đã xác nhận",
    filled.status === 200 && blankRows[0].s === "CONFIRMED",
    JSON.stringify(filled.body),
  );
}

// ---------- US13: ngày hợp đồng nằm trong khoảng ngày chương trình ----------
async function testProgramRange(hrToken, conn, emails, cleanup) {
  const dept = await call("POST", "/departments", hrToken, { name: PREFIX });
  if (dept.status !== 201) throw new Error("Không tạo được phòng ban test");
  cleanup.departmentId = dept.body.data.id;

  const prog = await call("POST", "/programs", hrToken, {
    name: PREFIX,
    department_id: dept.body.data.id,
    start_date: "2026-06-01",
    end_date: "2026-12-31",
    capacity: 5,
  });
  if (prog.status !== 201) {
    throw new Error(`Không tạo được chương trình test: ${JSON.stringify(prog.body)}`);
  }
  const programId = prog.body.data.id;

  const internId = await createIntern(hrToken, "program", emails);
  const contractId = await confirmContractDirect(conn, internId, {
    startDate: "2026-07-01",
    endDate: "2026-10-01",
  });

  const early = await patchContract(hrToken, internId, contractId, {
    program_id: programId,
    start_date: "2026-05-01",
  });
  check("Hợp đồng bắt đầu trước chương trình: 400", early.status === 400, JSON.stringify(early.body));

  const late = await patchContract(hrToken, internId, contractId, {
    program_id: programId,
    end_date: "2027-01-15",
  });
  check("Hợp đồng kết thúc sau chương trình: 400", late.status === 400, JSON.stringify(late.body));

  const linked = await patchContract(hrToken, internId, contractId, {
    program_id: programId,
  });
  check(
    "Gắn chương trình khi ngày hợp đồng nằm trong khoảng: 200",
    linked.status === 200 && Number(linked.body?.data?.program_id) === programId,
    JSON.stringify(linked.body),
  );

  const outside = await patchContract(hrToken, internId, contractId, {
    end_date: "2027-03-01",
  });
  check("Đổi ngày vượt khoảng chương trình đang gắn: 400", outside.status === 400);

  // Thu hẹp chương trình làm hợp đồng nằm ngoài -> 409; mở rộng thì được
  const programBody = (patch) => ({
    name: PREFIX,
    department_id: dept.body.data.id,
    start_date: "2026-06-01",
    end_date: "2026-12-31",
    capacity: 5,
    ...patch,
  });
  const shrink = await call("PUT", `/programs/${programId}`, hrToken, programBody({
    end_date: "2026-09-01",
  }));
  check("Thu hẹp chương trình khiến hợp đồng nằm ngoài: 409", shrink.status === 409, JSON.stringify(shrink.body));

  const widen = await call("PUT", `/programs/${programId}`, hrToken, programBody({
    end_date: "2027-06-30",
  }));
  check("Mở rộng chương trình: 200", widen.status === 200, JSON.stringify(widen.body));

  const ok = await call("PUT", `/programs/${programId}`, hrToken, programBody({
    start_date: "2026-07-01",
    end_date: "2026-10-01",
  }));
  check("Thu hẹp vừa khít với hợp đồng: 200", ok.status === 200, JSON.stringify(ok.body));
}

async function run() {
  console.log("\n====================================================");
  console.log(" BẮT ĐẦU INTEGRATION TEST LUẬT NGHIỆP VỤ BỔ SUNG (API)");
  console.log("====================================================\n");

  const emails = [];
  const cleanup = { departmentId: null };
  const conn = await mysql.createConnection(readDbConfig());
  try {
    const hrToken = await loginAs("HR");
    await testReapply(hrToken, conn, emails);
    await testReconfirm(hrToken, conn, emails);
    await testProgramRange(hrToken, conn, emails, cleanup);
  } catch (err) {
    failed += 1;
    console.error(" [FAIL] Lỗi không mong đợi:", err);
  } finally {
    await cleanupTestData(emails);
    try {
      if (cleanup.departmentId) {
        await conn.query(
          "UPDATE internship_programs SET status = 'DRAFT' WHERE department_id = ?",
          [cleanup.departmentId],
        );
        await conn.query("DELETE FROM internship_programs WHERE department_id = ?", [
          cleanup.departmentId,
        ]);
        await conn.query("DELETE FROM departments WHERE id = ?", [
          cleanup.departmentId,
        ]);
      }
    } catch (err) {
      console.warn("Không dọn được dữ liệu chương trình test:", err.message);
    }
    await conn.end();
  }

  console.log(`\n${passed} pass, ${failed} fail\n`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
