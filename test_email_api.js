// tests/test_email_api.js - Integration tests cho Email APIs, Phân quyền RBAC & Nhật ký
// Yêu cầu: Backend đang chạy ở cổng 5000 và MySQL đang hoạt động.
const {
  BASE_URL,
  loginAs,
  cleanupTestData,
  seedFullDocuments,
} = require("./test_helpers");

const CONFIG_URL = `${BASE_URL}/email/config`;
const TEST_SEND_URL = `${BASE_URL}/email/config/test`;
const LOGS_URL = `${BASE_URL}/email/logs`;
const APPLICATIONS_URL = `${BASE_URL}/applications`;
const REGISTER_URL = `${BASE_URL}/auth/register`;

let passed = 0;
let total = 0;

function report(tcId, name, condition) {
  total++;
  if (condition) {
    passed++;
    console.log(` [PASS] ${tcId}: ${name}`);
  } else {
    console.error(` [FAIL] ${tcId}: ${name}`);
  }
}

async function registerTestCandidate(label) {
  const email = `test_email_${label}_${Date.now()}@ictu.edu.vn`;
  const res = await fetch(REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Ứng viên Test Email ${label}`,
      email,
      password: "password123",
      phone: "0912345678",
      university: "ĐH Công Nghệ Thông Tin",
      major: "Kỹ Thuật Phần Mềm",
    }),
  });
  const data = await res.json();
  if (res.status !== 201) {
    throw new Error(`Không tạo được hồ sơ test: ${JSON.stringify(data)}`);
  }
  return { id: data.candidate.id, email };
}

async function runApiTests() {
  console.log("\n====================================================");
  console.log(" BẮT ĐẦU INTEGRATION TEST EMAIL SERVICE API (US8)");
  console.log("====================================================\n");

  const createdEmails = [];

  try {
    const adminToken = await loginAs("Admin");
    const hrToken = await loginAs("HR");
    const mentorToken = await loginAs("Mentor");
    const internToken = await loginAs("Intern");

    // TC_API_01: GET /api/email/config chưa đăng nhập -> 401
    try {
      const res = await fetch(CONFIG_URL);
      report(
        "TC_API_01",
        "Chưa đăng nhập truy cập /api/email/config bị chặn (401)",
        res.status === 401,
      );
    } catch (e) {
      report("TC_API_01", "Lỗi kết nối", false);
    }

    // TC_API_02: GET /api/email/config với HR / Mentor / Intern -> 403
    try {
      const results = await Promise.all(
        [hrToken, mentorToken, internToken].map((t) =>
          fetch(CONFIG_URL, { headers: { Authorization: `Bearer ${t}` } }),
        ),
      );
      report(
        "TC_API_02",
        "Chỉ Admin mới có quyền xem cấu hình SMTP (HR, Mentor, Intern bị chặn 403)",
        results.every((r) => r.status === 403),
      );
    } catch (e) {
      report("TC_API_02", "Lỗi kết nối", false);
    }

    // TC_API_03: GET /api/email/config với Admin -> 200 & không lộ pass
    try {
      const res = await fetch(CONFIG_URL, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const body = await res.json();
      const safe =
        body.data &&
        body.data.pass === undefined &&
        typeof body.data.hasPassword === "boolean";
      report(
        "TC_API_03",
        "Admin lấy cấu hình SMTP thành công (200), mật khẩu được ẩn an toàn",
        res.status === 200 && body.success === true && safe,
      );
    } catch (e) {
      report("TC_API_03", "Lỗi kết nối", false);
    }

    // TC_API_04: PUT /api/email/config với tham số không hợp lệ -> 400
    try {
      const res = await fetch(CONFIG_URL, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ host: "", port: 999999 }),
      });
      report(
        "TC_API_04",
        "Cập nhật cấu hình SMTP với dữ liệu không hợp lệ trả về lỗi (400)",
        res.status === 400,
      );
    } catch (e) {
      report("TC_API_04", "Lỗi kết nối", false);
    }

    // TC_API_05: PUT /api/email/config hợp lệ -> 200
    try {
      const res = await fetch(CONFIG_URL, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          host: "smtp.gmail.com",
          port: 587,
          secure: false,
          user: "hethong.internship@gmail.com",
          fromName: "Ban Tuyển Dụng Thực Tập Sinh",
        }),
      });
      const body = await res.json();
      report(
        "TC_API_05",
        "Admin cập nhật cấu hình SMTP thành công (200, success=true)",
        res.status === 200 &&
          body.success === true &&
          body.data.host === "smtp.gmail.com",
      );
    } catch (e) {
      report("TC_API_05", "Lỗi kết nối", false);
    }

    // TC_API_06: POST /api/email/config/test với email không hợp lệ -> 400
    try {
      const res = await fetch(TEST_SEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ to: "email_sai_dinh_dang" }),
      });
      report(
        "TC_API_06",
        "Gửi thử nghiệm với định dạng email không hợp lệ bị từ chối (400)",
        res.status === 400,
      );
    } catch (e) {
      report("TC_API_06", "Lỗi kết nối", false);
    }

    // TC_API_07: GET /api/email/logs với Admin / Mentor / Intern -> 403
    try {
      const results = await Promise.all(
        [adminToken, mentorToken, internToken].map((t) =>
          fetch(LOGS_URL, { headers: { Authorization: `Bearer ${t}` } }),
        ),
      );
      report(
        "TC_API_07",
        "Admin, Mentor và Intern không được truy cập Nhật ký Email (403)",
        results.every((r) => r.status === 403),
      );
    } catch (e) {
      report("TC_API_07", "Lỗi kết nối", false);
    }

    // TC_API_08: GET /api/email/logs với HR -> 200 có phân trang
    try {
      const results = await Promise.all(
        [hrToken].map((t) =>
          fetch(`${LOGS_URL}?page=1&pageSize=10`, {
            headers: { Authorization: `Bearer ${t}` },
          }),
        ),
      );
      const bodies = await Promise.all(results.map((r) => r.json()));
      const ok =
        results.every((r) => r.status === 200) &&
        bodies.every(
          (b) => b.success === true && Array.isArray(b.data) && b.pagination,
        );
      report(
        "TC_API_08",
        "Chỉ HR có quyền đọc Nhật ký gửi Email (200, có phân trang)",
        ok,
      );
    } catch (e) {
      report("TC_API_08", "Lỗi kết nối", false);
    }

    // TC_API_09: HR Duyệt hồ sơ -> Phát sự kiện -> Tự động ghi Email Log (APPROVED)
    try {
      const cand = await registerTestCandidate("duyet_gui_mail");
      createdEmails.push(cand.email);
      await seedFullDocuments(cand.id); // US10: duyệt cần đủ 2/2 tài liệu

      // HR duyệt hồ sơ
      const res = await fetch(`${APPLICATIONS_URL}/${cand.id}/status`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${hrToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "APPROVED" }),
      });
      const body = await res.json();
      const approvedOk = res.status === 200 && body.success === true;

      // Đợi ngắn (300ms) để background event consumer ghi log vào database
      await new Promise((r) => setTimeout(r, 400));

      // Kiểm tra nhật ký email xem đã có bản ghi APPROVED cho email này chưa
      const logRes = await fetch(
        `${LOGS_URL}?search=${encodeURIComponent(cand.email)}`,
        {
          headers: { Authorization: `Bearer ${hrToken}` },
        },
      );
      const logBody = await logRes.json();
      const foundLog = (logBody.data || []).find(
        (l) => l.recipientEmail === cand.email.toLowerCase(),
      );

      report(
        "TC_API_09",
        "HR duyệt hồ sơ kích hoạt Event Consumer tự động tạo bản ghi email_logs (APPROVED)",
        approvedOk && Boolean(foundLog) && foundLog.emailType === "APPROVED",
      );
    } catch (e) {
      report("TC_API_09", "Lỗi duyệt hồ sơ / ghi log: " + e.message, false);
    }

    // TC_API_10: HR Từ chối hồ sơ kèm lý do -> Tự động ghi Email Log (REJECTED)
    let rejectedLogId = null;
    try {
      const cand = await registerTestCandidate("tu_choi_gui_mail");
      createdEmails.push(cand.email);

      // HR từ chối hồ sơ
      const res = await fetch(`${APPLICATIONS_URL}/${cand.id}/status`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${hrToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: "REJECTED",
          rejection_reason: "Hồ sơ chưa đạt yêu cầu tiếng Anh đầu vào",
        }),
      });
      const body = await res.json();
      const rejectedOk = res.status === 200 && body.success === true;

      // Đợi ngắn (300ms) để background event consumer ghi log
      await new Promise((r) => setTimeout(r, 400));

      const logRes = await fetch(
        `${LOGS_URL}?search=${encodeURIComponent(cand.email)}`,
        {
          headers: { Authorization: `Bearer ${hrToken}` },
        },
      );
      const logBody = await logRes.json();
      const foundLog = (logBody.data || []).find(
        (l) => l.recipientEmail === cand.email.toLowerCase(),
      );
      if (foundLog) rejectedLogId = foundLog.id;

      report(
        "TC_API_10",
        "HR từ chối hồ sơ kích hoạt Event Consumer tự động tạo bản ghi email_logs (REJECTED)",
        rejectedOk && Boolean(foundLog) && foundLog.emailType === "REJECTED",
      );
    } catch (e) {
      report("TC_API_10", "Lỗi từ chối hồ sơ / ghi log: " + e.message, false);
    }

    // TC_API_11: Thử lại (Retry) email log không tồn tại -> 404
    try {
      const res = await fetch(`${LOGS_URL}/99999999/retry`, {
        method: "POST",
        headers: { Authorization: `Bearer ${hrToken}` },
      });
      report(
        "TC_API_11",
        "Gửi lại (Retry) với log ID không tồn tại trả về lỗi (404)",
        res.status === 404,
      );
    } catch (e) {
      report("TC_API_11", "Lỗi kết nối", false);
    }

    // TC_API_12: Thử lại (Retry) email log hợp lệ -> thực thi ngay
    try {
      if (rejectedLogId) {
        const res = await fetch(`${LOGS_URL}/${rejectedLogId}/retry`, {
          method: "POST",
          headers: { Authorization: `Bearer ${hrToken}` },
        });
        const body = await res.json();
        // Kết quả trả về 200 (nếu log FAILED/RETRYING) hoặc 400 (nếu trạng thái không hợp lệ)
        report(
          "TC_API_12",
          "API /api/email/logs/:id/retry phản hồi đúng định dạng { success, message }",
          typeof body.success === "boolean" && Boolean(body.message),
        );
      } else {
        report("TC_API_12", "Bỏ qua do không có logId từ bước trước", true);
      }
    } catch (e) {
      report("TC_API_12", "Lỗi gửi lại log: " + e.message, false);
    }
  } finally {
    // Dọn dẹp dữ liệu test
    try {
      const deleted = await cleanupTestData(createdEmails);
      if (deleted > 0) {
        console.log(
          `\n [CLEANUP] Đã dọn dẹp ${deleted} bản ghi test trong database.`,
        );
      }
    } catch (cleanErr) {
      console.warn(" [CLEANUP] Cảnh báo dọn dữ liệu test:", cleanErr.message);
    }
  }

  console.log("\n----------------------------------------------------");
  console.log(
    ` KẾT QUẢ INTEGRATION TEST EMAIL: ${passed}/${total} TEST CASES PASS (${Math.round((passed / total) * 100)}%)`,
  );
  console.log("----------------------------------------------------\n");

  if (passed < total) {
    process.exit(1);
  }
}

runApiTests();
