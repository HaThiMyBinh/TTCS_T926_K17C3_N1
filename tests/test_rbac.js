const { BASE_URL, loginAs } = require("./test_helpers");

async function request(endpoint, token, options = {}) {
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };
  return fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
}

async function updateInternPermissions(adminToken, permissions) {
  return request("/permissions/update", adminToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "Intern", permissions }),
  });
}

async function runAutoRBACTests() {
  console.log("\nBẮT ĐẦU KIỂM THỬ TỰ ĐỘNG PHÂN QUYỀN\n");

  let passCount = 0;
  const totalCount = 8;
  const adminToken = await loginAs("Admin");
  const hrToken = await loginAs("HR");
  const internToken = await loginAs("Intern");
  let originalInternPermissions = ["SUBMIT_WORK"];

  const check = (name, passed) => {
    if (passed) {
      passCount += 1;
      console.log(`[PASS] ${name}`);
    } else {
      console.error(`[FAIL] ${name}`);
    }
  };

  try {
    // Lấy và lưu cấu hình ban đầu trước khi test có thay đổi quyền.
    const permissionsResponse = await request("/permissions", adminToken);
    const permissions = await permissionsResponse.json();
    if (Array.isArray(permissions.Intern)) {
      originalInternPermissions = [...permissions.Intern];
    }

    check(
      "TC_01: Đọc được ma trận quyền",
      permissionsResponse.ok &&
        permissions.HR &&
        permissions.Mentor &&
        permissions.Intern,
    );

    const hrReportResponse = await request("/reports", hrToken);
    check("TC_02: HR truy cập báo cáo", hrReportResponse.status === 200);

    const internReportResponse = await request("/reports", internToken);
    check(
      "TC_03: Intern bị chặn khỏi báo cáo",
      internReportResponse.status === 403,
    );

    const updateResponse = await updateInternPermissions(adminToken, [
      "VIEW_REPORTS",
    ]);
    const updatedReportResponse = await request("/reports", internToken);
    check(
      "TC_04: Quyền mới có hiệu lực ngay",
      updateResponse.ok && updatedReportResponse.status === 200,
    );

    const selfUpdateResponse = await request("/permissions/update", internToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "Intern",
        permissions: ["SYSTEM_SETTINGS"],
      }),
    });
    check(
      "TC_05: Intern không tự thay đổi ma trận quyền",
      selfUpdateResponse.status === 403,
    );

    const spoofedRoleResponse = await fetch(`${BASE_URL}/reports`, {
      headers: { "x-user-role": "Admin" },
    });
    check(
      "TC_06: Từ chối header vai trò giả mạo",
      spoofedRoleResponse.status === 401,
    );

    const hrUsersResponse = await request("/users", hrToken);
    check(
      "TC_07: HR không còn quyền quản lý tài khoản",
      hrUsersResponse.status === 403,
    );
  } finally {
    // Khôi phục đúng quyền đã đọc, kể cả khi một assertion hoặc request lỗi.
    const restoreResponse = await updateInternPermissions(
      adminToken,
      originalInternPermissions,
    );
    const restoredSubmissionResponse = await request(
      "/submissions",
      internToken,
    );
    check(
      "TC_08: Khôi phục quyền ban đầu và giữ quyền nộp bài",
      restoreResponse.ok &&
        originalInternPermissions.includes("SUBMIT_WORK") &&
        restoredSubmissionResponse.status === 200,
    );
  }

  console.log(`\n${passCount}/${totalCount} test phân quyền pass\n`);
  if (passCount < totalCount) process.exitCode = 1;
}

runAutoRBACTests().catch((err) => {
  console.error("Lỗi khi chạy test phân quyền:", err);
  process.exitCode = 1;
});
