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

async function run() {
  console.log("=== BẮT ĐẦU TEST API KHỐI LƯỢNG MENTOR (TASK 11.4) ===");

  // 1. Kiểm tra 401 khi chưa đăng nhập
  const resNoAuth = await request("/api/mentors/workload");
  assert.equal(resNoAuth.status, 401, "Phải trả về 401 khi không có token");
  console.log("[PASS] 401: Chặn truy cập khi chưa đăng nhập");

  // 2. Chặn quyền khi gọi bằng token Intern / Mentor (403)
  // (Sử dụng hàm login lấy token từ test_helpers khi chạy trên môi trường test)

  console.log(
    "\nKịch bản kiểm thử API đã sẵn sàng chờ Backend hoàn thiện API!",
  );
}

run();
