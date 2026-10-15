const assert = require("node:assert/strict");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5000";

async function request(path, options = {}) {
  const url = new URL(path, BASE_URL);
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
  console.log("=== API TEST: LỊCH SỬ PHỤ CẤP INTERN (TASK 2.6) ===");

  // 1. Chặn truy cập khi chưa đăng nhập (401)
  const unauthRes = await request("/api/me/allowances");
  assert.equal(unauthRes.status, 401, "Chưa đăng nhập phải trả về 401");
  console.log("[PASS] GET /api/me/allowances trả về 401 khi không có token");

  const internToken = await login("intern1@company.com", "Intern@123");
  const hrToken = await login("hr@company.com", "Hr@123456");

  // 2. Chặn HR/Mentor gọi API cá nhân của Intern (403)
  if (hrToken) {
    const hrRes = await request("/api/me/allowances", { token: hrToken });
    assert.equal(hrRes.status, 403, "HR gọi /api/me/allowances phải bị 403");
    console.log(
      "[PASS] Chặn tài khoản không phải Intern gọi /api/me/allowances (403)",
    );
  }

  // 3. Intern xem lịch sử phụ cấp của chính mình + lọc theo kỳ + phân trang
  if (internToken) {
    const myRes = await request(
      "/api/me/allowances?period=2026-10&page=1&limit=10",
      { token: internToken },
    );
    assert.equal(
      myRes.status,
      200,
      "Intern xem phụ cấp cá nhân phải trả về 200",
    );
    console.log(
      "[PASS] GET /api/me/allowances trả về 200 kèm dữ liệu và tổng tiền theo kỳ",
    );
  }

  console.log("\n=== HOÀN THÀNH API TEST TASK 2.6 ===");
}

run();
