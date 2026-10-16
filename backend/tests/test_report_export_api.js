// API test Story 7.1: HR xuất báo cáo Excel. Cần MySQL + backend đang chạy.
const assert = require("node:assert/strict");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5000";
const URL_PATH = "/api/reports/export/excel";

async function request(path, token) {
  const cleanBase = BASE_URL.replace(/\/api\/?$/, "");
  const response = await fetch(new URL(path, cleanBase).href, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, body };
}

async function login(email, password) {
  const cleanBase = BASE_URL.replace(/\/api\/?$/, "");
  const response = await fetch(new URL("/api/login", cleanBase).href, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json().catch(() => ({}));
  return data.token;
}

async function run() {
  console.log("=== API TEST: XUẤT BÁO CÁO EXCEL (TASK 7.1) ===");

  const unauth = await request(URL_PATH);
  assert.equal(unauth.status, 401, "Chưa đăng nhập phải trả về 401");
  console.log("[PASS] 401 khi không có token");

  const internToken = await login("intern1@company.com", "Intern@123");
  if (internToken) {
    const forbidden = await request(URL_PATH, internToken);
    assert.equal(forbidden.status, 403, "Intern phải bị chặn 403");
    console.log("[PASS] 403 với tài khoản không phải HR");
  }

  const hrToken = await login("hr@company.com", "Hr@123456");
  if (hrToken) {
    const ok = await request(`${URL_PATH}?from=2026-10-01&to=2026-10-16`, hrToken);
    assert.equal(ok.status, 200, "HR xuất báo cáo phải trả về 200");
    assert.match(
      ok.headers.get("content-type") || "",
      /spreadsheetml\.sheet/,
      "Content-Type phải là xlsx",
    );
    assert.match(ok.headers.get("content-disposition") || "", /attachment; filename="[^"]+\.xlsx"/);
    assert.equal(ok.body.readUInt32LE(0), 0x04034b50, "Nội dung phải là file ZIP/XLSX");
    console.log("[PASS] HR tải được file .xlsx hợp lệ");

    const bad = await request(`${URL_PATH}?from=2026-10-20&to=2026-10-01`, hrToken);
    assert.equal(bad.status, 400, "Kỳ báo cáo sai phải trả về 400");
    const unknown = await request(`${URL_PATH}?foo=bar`, hrToken);
    assert.equal(unknown.status, 400, "Tham số lạ phải trả về 400");
    console.log("[PASS] 400 với tham số không hợp lệ");
  }

  console.log("\n=== HOÀN THÀNH API TEST TASK 7.1 ===");
}

run().catch((err) => {
  console.error("[FAIL]", err.message);
  process.exit(1);
});
