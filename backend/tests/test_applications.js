// test_applications.js HR duyệt / từ chối hồ sơ ứng viên
// Yêu cầu: MySQL đang chạy và backend đang mở ở cổng 5000 (node server.js / run.bat)
const {
  BASE_URL,
  loginAs,
  cleanupTestData,
  seedFullDocuments,
} = require("./test_helpers");

const REGISTER_URL = `${BASE_URL}/auth/register`;
const LOGIN_URL = `${BASE_URL}/auth/login`;
const APPLICATIONS_URL = `${BASE_URL}/applications`;
const PASSWORD = "password123";

// Lấy id người dùng từ payload của JWT (để đối chiếu reviewed_by)
function userIdFromToken(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
    .id;
}

// Nộp hồ sơ ứng tuyển thật qua API công khai -> trả về { id, email }
async function registerCandidate(label) {
  const email = `us7_${label}_${Date.now()}@ictu.edu.vn`;
  const res = await fetch(REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Ứng viên US7 ${label}`,
      email,
      password: PASSWORD,
      phone: "0987654321",
      university: "ĐH CNTT & Truyền Thông",
      major: "Kỹ thuật phần mềm",
    }),
  });
  const data = await res.json();
  if (res.status !== 201) {
    throw new Error(
      `Không tạo được hồ sơ test (${label}): ${JSON.stringify(data)}`,
    );
  }
  return { id: data.candidate.id, email };
}

async function patchStatus(id, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${APPLICATIONS_URL}/${id}/status`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function listApplications(token) {
  const res = await fetch(APPLICATIONS_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.data || [];
}

async function loginStatus(email) {
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: email, password: PASSWORD }),
  });
  return res.status;
}

async function runApplicationTests() {
  console.log("\n");
  console.log(" BẮT ĐẦU TEST DUYỆT / TỪ CHỐI HỒ SƠ ỨNG VIÊN ");
  console.log("\n");

  let passCount = 0;
  const totalCount = 12;
  const createdEmails = []; // email các hồ sơ test tạo ra -> dọn cuối phiên

  const report = (id, description, ok) => {
    console.log(` [${ok ? "PASS" : "FAIL"}] ${id}: ${description}`);
    if (ok) passCount++;
  };

  try {
    // ---- Chuẩn bị: đăng nhập các vai trò + tạo hồ sơ test ----
    const hrToken = await loginAs("HR");
    const hrId = userIdFromToken(hrToken);
    const adminToken = await loginAs("Admin");
    const mentorToken = await loginAs("Mentor");
    const internToken = await loginAs("Intern");

    const candApprove = await registerCandidate("duyet");
    createdEmails.push(candApprove.email);
    const candReject = await registerCandidate("tuchoi");
    createdEmails.push(candReject.email);
    const candUntouched = await registerCandidate("giunguyen"); // chỉ dùng cho test lỗi
    createdEmails.push(candUntouched.email);
    const candRace = await registerCandidate("dongthoi");
    createdEmails.push(candRace.email);
    // US10: duyệt yêu cầu đủ CV + Đơn xin thực tập
    await seedFullDocuments(candApprove.id);
    await seedFullDocuments(candRace.id);

    // TC_01: Chưa đăng nhập -> 401
    try {
      const r = await patchStatus(
        candUntouched.id,
        { status: "APPROVED" },
        null,
      );
      report(
        "TC_01",
        "Chưa đăng nhập bị chặn (Mã 401, success=false)",
        r.status === 401 && r.body.success === false,
      );
    } catch (e) {
      report("TC_01", "Lỗi kết nối API", false);
    }

    // TC_02: Không phải HR -> 403
    try {
      const results = await Promise.all(
        [adminToken, mentorToken, internToken].map((t) =>
          patchStatus(candUntouched.id, { status: "APPROVED" }, t),
        ),
      );
      report(
        "TC_02",
        "Admin / Mentor / Intern không được duyệt hồ sơ (Mã 403)",
        results.every((r) => r.status === 403 && r.body.success === false),
      );
    } catch (e) {
      report("TC_02", "Lỗi kết nối API", false);
    }

    // TC_03: status không hợp lệ / thiếu -> 400
    try {
      const bodies = [{ status: "MAYBE" }, {}, { status: "PENDING" }];
      const results = await Promise.all(
        bodies.map((b) => patchStatus(candUntouched.id, b, hrToken)),
      );
      report(
        "TC_03",
        "Chặn status không hợp lệ / thiếu / PENDING (Mã 400)",
        results.every((r) => r.status === 400 && r.body.success === false),
      );
    } catch (e) {
      report("TC_03", "Lỗi kết nối API", false);
    }

    // TC_04: REJECTED thiếu rejection_reason -> 400
    try {
      const r = await patchStatus(
        candUntouched.id,
        { status: "REJECTED" },
        hrToken,
      );
      report(
        "TC_04",
        "Từ chối mà thiếu lý do bị chặn (Mã 400)",
        r.status === 400 && r.body.success === false,
      );
    } catch (e) {
      report("TC_04", "Lỗi kết nối API", false);
    }

    // TC_05: REJECTED lý do chỉ có khoảng trắng -> 400
    try {
      const r = await patchStatus(
        candUntouched.id,
        { status: "REJECTED", rejection_reason: "     " },
        hrToken,
      );
      report(
        "TC_05",
        "Từ chối với lý do chỉ có khoảng trắng bị chặn (Mã 400)",
        r.status === 400 && r.body.success === false,
      );
    } catch (e) {
      report("TC_05", "Lỗi kết nối API", false);
    }

    // TC_06: Không tìm thấy hồ sơ -> 404
    try {
      const r = await patchStatus(999999999, { status: "APPROVED" }, hrToken);
      report(
        "TC_06",
        "Hồ sơ không tồn tại (Mã 404)",
        r.status === 404 && r.body.success === false,
      );
    } catch (e) {
      report("TC_06", "Lỗi kết nối API", false);
    }

    // TC_07: Duyệt thành công (không cần lý do)
    try {
      const r = await patchStatus(
        candApprove.id,
        { status: "APPROVED" },
        hrToken,
      );
      const d = r.body.data || {};
      report(
        "TC_07",
        "Duyệt hồ sơ PENDING -> APPROVED thành công (Mã 200), lưu người duyệt & thời gian",
        r.status === 200 &&
          r.body.success === true &&
          typeof r.body.message === "string" &&
          d.status === "APPROVED" &&
          d.reviewed_by === hrId &&
          !!d.reviewed_at,
      );
    } catch (e) {
      report("TC_07", "Lỗi kết nối API", false);
    }

    // TC_08: Từ chối thành công, lý do được trim & lưu
    try {
      const r = await patchStatus(
        candReject.id,
        {
          status: "REJECTED",
          rejection_reason: "  Không đủ điều kiện tiếng Anh  ",
        },
        hrToken,
      );
      const d = r.body.data || {};
      report(
        "TC_08",
        "Từ chối hồ sơ PENDING -> REJECTED thành công (Mã 200), lưu lý do",
        r.status === 200 &&
          r.body.success === true &&
          d.status === "REJECTED" &&
          d.rejection_reason === "Không đủ điều kiện tiếng Anh" &&
          d.reviewed_by === hrId,
      );
    } catch (e) {
      report("TC_08", "Lỗi kết nối API", false);
    }

    // TC_09: Đọc lại từ Database (qua GET) - dữ liệu đã lưu, hồ sơ bị lỗi 4xx không bị đổi
    try {
      const list = await listApplications(hrToken);
      const byId = (id) => list.find((a) => a.id === id) || {};
      const approved = byId(candApprove.id);
      const rejected = byId(candReject.id);
      const untouched = byId(candUntouched.id);
      report(
        "TC_09",
        "Database lưu đúng trạng thái, lý do, người duyệt; hồ sơ bị chặn (400/403) vẫn PENDING",
        approved.status === "APPROVED" &&
          approved.rejection_reason === null &&
          approved.reviewed_by === hrId &&
          rejected.status === "REJECTED" &&
          rejected.rejection_reason === "Không đủ điều kiện tiếng Anh" &&
          !!rejected.reviewed_at &&
          untouched.status === "PENDING" &&
          untouched.reviewed_by === null,
      );
    } catch (e) {
      report("TC_09", "Lỗi kết nối API", false);
    }

    // TC_10: Tài khoản ứng viên đồng bộ: được duyệt đăng nhập được, bị từ chối bị khóa
    try {
      const approvedLogin = await loginStatus(candApprove.email);
      const rejectedLogin = await loginStatus(candReject.email);
      report(
        "TC_10",
        "Tài khoản ứng viên được duyệt đăng nhập được (200), bị từ chối bị khóa (403)",
        approvedLogin === 200 && rejectedLogin === 403,
      );
    } catch (e) {
      report("TC_10", "Lỗi kết nối API", false);
    }

    // TC_11: Hồ sơ đã xử lý không được đổi lại -> 409
    try {
      const a = await patchStatus(
        candApprove.id,
        { status: "REJECTED", rejection_reason: "đổi ý" },
        hrToken,
      );
      const b = await patchStatus(
        candReject.id,
        { status: "APPROVED" },
        hrToken,
      );
      report(
        "TC_11",
        "Hồ sơ đã duyệt / đã từ chối không được đổi lại (Mã 409)",
        a.status === 409 &&
          b.status === 409 &&
          a.body.success === false &&
          b.body.success === false,
      );
    } catch (e) {
      report("TC_11", "Lỗi kết nối API", false);
    }

    // TC_12: Hai yêu cầu đồng thời -> chỉ một thành công, một bị 409 (atomic)
    try {
      const [x, y] = await Promise.all([
        patchStatus(candRace.id, { status: "APPROVED" }, hrToken),
        patchStatus(candRace.id, { status: "APPROVED" }, hrToken),
      ]);
      report(
        "TC_12",
        "Hai yêu cầu cùng lúc: một thành công (200), một bị chặn (409)",
        [x.status, y.status].sort().join(",") === "200,409",
      );
    } catch (e) {
      report("TC_12", "Lỗi kết nối API", false);
    }
  } catch (e) {
    console.log(" [LỖI CHUẨN BỊ] " + e.message);
    console.log(" -> Kiểm tra MySQL và backend (cổng 5000) đã chạy chưa.");
  } finally {
    // Dọn dữ liệu test (không ảnh hưởng kết quả PASS/FAIL ở trên)
    try {
      const removed = await cleanupTestData(createdEmails);
      console.log(` [CLEANUP] Đã xóa ${removed} bản ghi dữ liệu test.`);
    } catch (e) {
      console.log(" [CLEANUP] Không dọn được dữ liệu test: " + e.message);
    }
  }

  console.log("\n");
  console.log(
    ` KẾT QUẢ TEST DUYỆT HỒ SƠ : ${passCount}/${totalCount} TEST CASES PASS ${passCount === totalCount ? "100%!" : ""}`,
  );
  console.log("\n");

  // Trả mã thoát khác 0 khi có test FAIL để `npm test` / CI nhận biết được
  if (passCount < totalCount) process.exitCode = 1;
}

runApplicationTests();
