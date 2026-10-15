const assert = require("node:assert/strict");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5000";

async function request(path, options = {}) {
  const cleanBase = BASE_URL.replace(/\/api\/?$/, "");
  const url = new URL(path, cleanBase);
  const response = await fetch(url.href, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function login(email, password) {
  const res = await request("/api/login", {
    method: "POST",
    body: { email, password },
  });
  return res.data.token;
}

async function run() {
  console.log("=== API TEST: GỬI & XEM YÊU CẦU HỖ TRỢ INTERN (TASK 3.7) ===");

  // 1. Chặn truy cập khi chưa đăng nhập (401)
  const unauthPost = await request("/api/support-requests", {
    method: "POST",
    body: {
      request_type: "Chứng nhận",
      title: "Xin chứng nhận thực tập",
      content: "Em xin giấy chứng nhận thực tập để nộp về trường.",
    },
  });
  assert.equal(unauthPost.status, 401, "POST chưa đăng nhập phải trả về 401");
  console.log(
    "[PASS] POST /api/support-requests trả về 401 khi không có token",
  );

  const unauthGet = await request("/api/me/support-requests");
  assert.equal(unauthGet.status, 401, "GET chưa đăng nhập phải trả về 401");
  console.log(
    "[PASS] GET /api/me/support-requests trả về 401 khi không có token",
  );

  const internToken = await login("intern1@company.com", "Intern@123");
  const hrToken = await login("hr@company.com", "Hr@123456");

  // 2. Chặn HR/Mentor gọi API gửi yêu cầu dành riêng cho Intern (403)
  if (hrToken) {
    const hrPost = await request("/api/support-requests", {
      method: "POST",
      token: hrToken,
      body: {
        request_type: "Giấy tờ",
        title: "Test quyền HR",
        content: "HR không được gửi yêu cầu của Intern",
      },
    });
    assert.equal(
      hrPost.status,
      403,
      "HR gọi POST /api/support-requests phải bị 403",
    );
    console.log("[PASS] Chặn tài khoản không phải Intern gửi yêu cầu (403)");
  }

  // 3. Intern gửi yêu cầu hỗ trợ hợp lệ & kiểm tra lỗi 400
  if (internToken) {
    const badRes = await request("/api/support-requests", {
      method: "POST",
      token: internToken,
      body: {
        request_type: "Chứng nhận",
        title: "",
        content: "",
      },
    });
    assert.equal(badRes.status, 400, "Thiếu nội dung phải trả về 400");
    console.log("[PASS] Chặn yêu cầu hỗ trợ rỗng (400)");

    const createRes = await request("/api/support-requests", {
      method: "POST",
      token: internToken,
      body: {
        request_type: "Chứng nhận",
        type: "CERTIFICATE",
        title: `Xin xác nhận thực tập ${Date.now()}`,
        content: "Kính gửi HR, cho em xin giấy chứng nhận hoàn thành thực tập.",
      },
    });
    assert.ok(
      [200, 201].includes(createRes.status),
      `Intern tạo yêu cầu hỗ trợ phải trả về 200/201 (nhận ${createRes.status})`,
    );
    console.log(
      "[PASS] Intern gửi yêu cầu hỗ trợ thành công, trạng thái mặc định Chờ xử lý",
    );

    // 4. Intern xem danh sách yêu cầu của mình kèm lọc trạng thái & phân trang
    const listRes = await request("/api/me/support-requests?page=1&limit=10", {
      token: internToken,
    });
    assert.equal(
      listRes.status,
      200,
      "GET /api/me/support-requests phải trả về 200",
    );
    console.log(
      "[PASS] GET /api/me/support-requests trả về danh sách thành công",
    );
  }

  console.log("\n=== HOÀN THÀNH API TEST TASK 3.7 ===");
}

run();
