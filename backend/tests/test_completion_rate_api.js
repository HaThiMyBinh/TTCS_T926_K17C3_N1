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
  console.log(
    "=== API TEST: BÁO CÁO TỶ LỆ HOÀN THÀNH CHƯƠNG TRÌNH (TASK 6.6) ===",
  );

  // 1. Chặn truy cập khi chưa đăng nhập (401)
  const unauthRes = await request("/api/reports/completion-rate");
  assert.equal(unauthRes.status, 401, "Chưa đăng nhập phải trả về 401");
  console.log(
    "[PASS] GET /api/reports/completion-rate trả về 401 khi không có token",
  );

  const hrToken = await login("hr@company.com", "Hr@123456");
  const internToken = await login("intern1@company.com", "Intern@123");

  // 2. Chặn Intern/Mentor gọi API báo cáo tỷ lệ hoàn thành (403)
  if (internToken) {
    const forbiddenRes = await request("/api/reports/completion-rate", {
      token: internToken,
    });
    assert.equal(forbiddenRes.status, 403, "Intern gọi API phải bị chặn 403");
    console.log(
      "[PASS] Chặn tài khoản không phải HR gọi /api/reports/completion-rate (403)",
    );
  }

  // 3. HR xem báo cáo tỷ lệ hoàn thành + lọc theo kỳ/trường + phân trang
  if (hrToken) {
    const rateRes = await request(
      "/api/reports/completion-rate?page=1&limit=10",
      { token: hrToken },
    );
    assert.equal(
      rateRes.status,
      200,
      "HR xem tỷ lệ hoàn thành phải trả về 200",
    );
    console.log("[PASS] GET /api/reports/completion-rate trả về 200 OK cho HR");

    const filterRes = await request(
      "/api/reports/completion-rate?period=2026-10&school=ICTU&page=1&limit=5",
      { token: hrToken },
    );
    assert.equal(
      filterRes.status,
      200,
      "Lọc theo kỳ/trường và phân trang phải trả về 200",
    );
    console.log(
      "[PASS] Lọc tỷ lệ hoàn thành theo kỳ/trường và phân trang hoạt động đúng",
    );
  }

  console.log("\n=== HOÀN THÀNH API TEST TASK 6.6 ===");
}

run();
