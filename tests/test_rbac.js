const { BASE_URL, loginAs } = require("./test_helpers");

async function runAutoRBACTests() {
  console.log("\n");
  console.log("  BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG PHÂN QUYỀN ");
  console.log("\n");

  let passCount = 0;
  const totalCount = 6;

  const adminToken = await loginAs("Admin").catch(() => null);
  const hrToken = await loginAs("HR").catch(() => null);
  const internToken = await loginAs("Intern").catch(() => null);

  try {
    await fetch(`${BASE_URL}/permissions/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ role: "Intern", permissions: [] }),
    });
  } catch { /* best-effort cleanup */ }

  // --- TC_01: Lấy danh sách ma trận phân quyền (yêu cầu đã đăng nhập) ---
  try {
    const res = await fetch(`${BASE_URL}/permissions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    if (res.status === 200 && data.HR && data.Mentor && data.Intern) {
      console.log(
        " [PASS] TC_01: Lấy thành công ma trận quyền của HR, Mentor, Intern",
      );
      passCount++;
    } else {
      console.log(" [FAIL] TC_01: Không lấy được danh sách quyền");
    }
  } catch (e) {
    console.log(" [FAIL] TC_01: Lỗi kết nối API permissions");
  }

  // --- TC_02: Cho phép HR (đã đăng nhập thật) truy cập API báo cáo ---
  try {
    const res = await fetch(`${BASE_URL}/reports`, {
      method: "GET",
      headers: { Authorization: `Bearer ${hrToken}` },
    });
    if (res.status === 200) {
      console.log(
        " [PASS] TC_02: Cho phép đúng vai trò HR truy cập báo cáo (Mã 200 OK)",
      );
      passCount++;
    } else {
      console.log(" [FAIL] TC_02: HR có quyền nhưng bị chặn nhầm");
    }
  } catch (e) {
    console.log(" [FAIL] TC_02: Lỗi kết nối API reports");
  }

  // --- TC_03: Chặn Intern truy cập API báo cáo (Intern không có quyền) ---
  try {
    const res = await fetch(`${BASE_URL}/reports`, {
      method: "GET",
      headers: { Authorization: `Bearer ${internToken}` },
    });
    if (res.status === 403) {
      console.log(
        " [PASS] TC_03: Chặn thành công Intern truy cập trái phép (Mã 403 Forbidden)",
      );
      passCount++;
    } else {
      console.log(
        " [FAIL] TC_03: Lỗi bảo mật: Intern không có quyền nhưng vẫn vào được!",
      );
    }
  } catch (e) {
    console.log(" [FAIL] TC_03: Lỗi kết nối API");
  }

  // --- TC_04: Cập nhật quyền mới cho vai trò (chỉ Admin được phép) ---
  try {
    const resUpdate = await fetch(`${BASE_URL}/permissions/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ role: "Intern", permissions: ["VIEW_REPORTS"] }),
    });

    // Thử cho Intern truy cập lại sau khi vừa được cấp quyền
    const resCheck = await fetch(`${BASE_URL}/reports`, {
      method: "GET",
      headers: { Authorization: `Bearer ${internToken}` },
    });

    if (resUpdate.status === 200 && resCheck.status === 200) {
      console.log(
        " [PASS] TC_04: Cập nhật quyền thành công & Intern truy cập được ngay sau khi cấp quyền",
      );
      passCount++;
    } else {
      console.log(" [FAIL] TC_04: Cập nhật quyền không có hiệu lực");
    }
  } catch (e) {
    console.log(" [FAIL] TC_04: Lỗi kết nối API update");
  }

  // --- TC_05: Chặn Intern tự cập nhật ma trận phân quyền (chỉ Admin được phép) ---
  try {
    const res = await fetch(`${BASE_URL}/permissions/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${internToken}`,
      },
      body: JSON.stringify({
        role: "Intern",
        permissions: ["SYSTEM_SETTINGS"],
      }),
    });
    if (res.status === 403) {
      console.log(
        " [PASS] TC_05: Chặn thành công Intern tự cấp quyền cho chính mình (Mã 403 Forbidden)",
      );
      passCount++;
    } else {
      console.log(
        " [FAIL] TC_05: LỖ HỔNG LEO THANG ĐẶC QUYỀN: Intern tự cấp quyền được!",
      );
    }
  } catch (e) {
    console.log(" [FAIL] TC_05: Lỗi kết nối API");
  }

  // --- TC_06: Header "x-user-role" giả mạo không còn được server tin tưởng ---
  try {
    const res = await fetch(`${BASE_URL}/reports`, {
      method: "GET",
      // Không gửi Authorization hợp lệ, chỉ gửi header giả mạo cũ
      headers: { "x-user-role": "Admin" },
    });
    if (res.status === 401) {
      console.log(
        " [PASS] TC_06: Header x-user-role giả mạo bị từ chối (Mã 401), yêu cầu JWT hợp lệ",
      );
      passCount++;
    } else {
      console.log(
        " [FAIL] TC_06: LỖ HỔNG: Server vẫn tin vào header x-user-role giả mạo!",
      );
    }
  } catch (e) {
    console.log(" [FAIL] TC_06: Lỗi kết nối API");
  }

  // Khôi phục lại quyền mặc định cho Intern để giữ nguyên vẹn dữ liệu hệ thống
  try {
    await fetch(`${BASE_URL}/permissions/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ role: "Intern", permissions: [] }),
    });
  } catch { /* best-effort cleanup */ }

  console.log("\n");
  console.log(
    ` KẾT QUẢ KIỂM THỬ PHÂN QUYỀN: ${passCount}/${totalCount} TEST CASES PASS!`,
  );
  console.log("\n");

  // Trả mã thoát khác 0 khi có test FAIL để `npm test` / CI nhận biết được
  if (passCount < totalCount) process.exitCode = 1;
}

runAutoRBACTests();
