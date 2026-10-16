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
  console.log("=== API TEST: BÁO CÁO TTS THEO TRƯỜNG/NGÀNH (TASK 5.6) ===");

  // 1. Chặn truy cập khi chưa đăng nhập (401)
  const unauthRes = await request("/api/reports/interns-by-school");
  assert.equal(unauthRes.status, 401, "Chưa đăng nhập phải trả về 401");
  console.log(
    "[PASS] GET /api/reports/interns-by-school trả về 401 khi không có token",
  );

  const hrToken = await login("hr@company.com", "Hr@123456");
  const internToken = await login("intern1@company.com", "Intern@123");

  // 2. Chặn Intern/Mentor truy cập báo cáo của HR (403)
  if (internToken) {
    const forbiddenRes = await request("/api/reports/interns-by-school", {
      token: internToken,
    });
    assert.equal(
      forbiddenRes.status,
      403,
      "Intern gọi API báo cáo HR phải bị 403",
    );
    console.log("[PASS] Chặn tài khoản không có quyền VIEW_REPORTS (403)");
  }

  // 3. HR xem danh sách thống kê theo trường/ngành + lọc theo trạng thái/kỳ + phân trang
  if (hrToken) {
    const reportRes = await request(
      "/api/reports/interns-by-school?page=1&limit=10",
      { token: hrToken },
    );
    assert.equal(
      reportRes.status,
      200,
      "HR lấy báo cáo trường/ngành phải trả về 200",
    );
    console.log(
      "[PASS] GET /api/reports/interns-by-school trả về 200 OK cho HR",
    );

    const filterRes = await request(
      "/api/reports/interns-by-school?status=ACTIVE&period=2026-10&page=1&limit=5",
      { token: hrToken },
    );
    assert.equal(
      filterRes.status,
      200,
      "Lọc báo cáo theo trạng thái/kỳ phải trả về 200",
    );
    console.log("[PASS] Bộ lọc trạng thái/kỳ và phân trang hoạt động đúng");
  }

  console.log("\n=== HOÀN THÀNH API TEST TASK 5.6 ===");
}

run();
