// test_rbac.js
const BASE_URL = "http://127.0.0.1:5000/api";

async function runAutoRBACTests() {
  console.log("\n");
  console.log("  BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG PHÂN QUYỀN (RBAC TESTS)");
  console.log("\n");

  let passCount = 0;
  const totalCount = 4;

  // --- Lấy danh sách ma trận phân quyền ---
  try {
    const res = await fetch(`${BASE_URL}/permissions`);
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

  // --- Cho phép HR truy cập API báo cáo (Có quyền VIEW_REPORTS) ---
  try {
    const res = await fetch(`${BASE_URL}/reports`, {
      method: "GET",
      headers: { "x-user-role": "HR" }, // Gửi vai trò HR
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

  // --- Chặn Intern truy cập API báo cáo (Intern không có quyền) ---
  try {
    const res = await fetch(`${BASE_URL}/reports`, {
      method: "GET",
      headers: { "x-user-role": "Intern" }, // Gửi vai trò Intern
    });
    const data = await res.json();
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

  // --- Cập nhật quyền mới cho vai trò ---
  try {
    // Admin cấp thêm quyền VIEW_REPORTS cho Intern
    const resUpdate = await fetch(`${BASE_URL}/permissions/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "Intern",
        permissions: ["VIEW_REPORTS"],
      }),
    });

    // Thử cho Intern truy cập lại sau khi vừa được cấp quyền
    const resCheck = await fetch(`${BASE_URL}/reports`, {
      method: "GET",
      headers: { "x-user-role": "Intern" },
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

  console.log("\n");
  console.log(
    ` KẾT QUẢ KIỂM THỬ PHÂN QUYỀN: ${passCount}/${totalCount} TEST CASES PASS!`,
  );
  console.log("\n");
}

runAutoRBACTests();
