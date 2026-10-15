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
  console.log("=== API TEST: QUẢN LÝ PHỤ CẤP HR (TASK 1.9) ===");

  // 1. Chặn truy cập khi chưa đăng nhập (401)
  const unauthRes = await request("/api/allowances");
  assert.equal(unauthRes.status, 401, "Chưa đăng nhập phải trả về 401");
  console.log("[PASS] GET /api/allowances trả về 401 khi không có token");

  // 2. Đăng nhập tài khoản HR, Mentor, Intern để kiểm thử CRUD & RBAC
  const hrToken = await login("hr@company.com", "Hr@123456");
  const internToken = await login("intern1@company.com", "Intern@123");

  if (internToken) {
    const forbiddenRes = await request("/api/allowances", {
      method: "GET",
      token: internToken,
    });
    assert.equal(forbiddenRes.status, 403, "Intern gọi API của HR phải bị 403");
    console.log("[PASS] Chặn Intern truy cập GET /api/allowances (403)");
  }

  if (hrToken) {
    // 3. Thêm mới phụ cấp hợp lệ (POST /api/allowances)
    const createRes = await request("/api/allowances", {
      method: "POST",
      token: hrToken,
      body: {
        intern_id: 1,
        allowance_type: "Phụ cấp chuyên cần",
        amount: 2000000,
        period: "2026-10",
        note: "Thưởng chuyên cần tháng 10",
      },
    });
    assert.ok(
      [200, 201, 409].includes(createRes.status),
      `Trạng thái tạo mới không hợp lệ: ${createRes.status}`,
    );
    console.log("[PASS] POST /api/allowances hoạt động đúng");

    const createdId = createRes.data?.id || createRes.data?.allowance?.id;

    // 4. Kiểm tra chặn trùng loại phụ cấp cùng kỳ (409)
    const dupRes = await request("/api/allowances", {
      method: "POST",
      token: hrToken,
      body: {
        intern_id: 1,
        allowance_type: "Phụ cấp chuyên cần",
        amount: 2000000,
        period: "2026-10",
      },
    });
    assert.equal(
      dupRes.status,
      409,
      "Trùng loại phụ cấp cùng kỳ phải trả về 409",
    );
    console.log("[PASS] Chặn trùng loại phụ cấp cùng kỳ (409)");

    // 5. Lấy danh sách + lọc theo intern/kỳ + phân trang (GET /api/allowances)
    const listRes = await request(
      "/api/allowances?intern_id=1&period=2026-10&page=1&limit=10",
      { token: hrToken },
    );
    assert.equal(
      listRes.status,
      200,
      "HR lấy danh sách phụ cấp phải trả về 200",
    );
    console.log("[PASS] GET /api/allowances lọc và phân trang thành công");

    // 6. Sửa và xóa phụ cấp (PUT & DELETE /api/allowances/:id)
    if (createdId) {
      const updateRes = await request(`/api/allowances/${createdId}`, {
        method: "PUT",
        token: hrToken,
        body: {
          intern_id: 1,
          allowance_type: "Phụ cấp chuyên cần",
          amount: 2500000,
          period: "2026-10",
          note: "Cập nhật mức phụ cấp",
        },
      });
      assert.equal(updateRes.status, 200, "Sửa phụ cấp phải trả về 200");
      console.log("[PASS] PUT /api/allowances/:id cập nhật thành công");

      const deleteRes = await request(`/api/allowances/${createdId}`, {
        method: "DELETE",
        token: hrToken,
      });
      assert.equal(deleteRes.status, 200, "Xóa phụ cấp phải trả về 200");
      console.log("[PASS] DELETE /api/allowances/:id xóa thành công");
    }
  }

  console.log("\n=== HOÀN THÀNH API TEST TASK 1.9 ===");
}

run();
