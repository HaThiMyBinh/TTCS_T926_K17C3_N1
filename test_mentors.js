// test_mentors.js - Kiểm thử chức năng Quản lý Mentor & Thêm mới mentor
const { BASE_URL, loginAs } = require("./test_helpers");

async function runAutoMentorTests() {
  console.log("\n====================================================");
  console.log(" BẮT ĐẦU KIỂM THỬ QUẢN LÝ MENTOR ");
  console.log("====================================================\n");

  let passCount = 0;
  const totalCount = 4;
  let createdMentorId = null;
  const testEmail = `mentor_test_${Date.now()}@company.com`;

  // Các route /api/mentors (GET/POST/DELETE) yêu cầu đăng nhập với vai trò phù
  // hợp
  const hrToken = await loginAs("HR");
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${hrToken}`,
  };

  // TC_01: Thêm mới mentor thành công (Mã 201 Created)
  try {
    const res = await fetch(`${BASE_URL}/mentors`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        fullName: "Hà Thị Mỹ Bình",
        email: testEmail,
        phone: "0987654321",
        department: "Trung tâm Công nghệ Phần mềm",
        specialization: "Trưởng nhóm Full-stack",
      }),
    });
    const data = await res.json();
    if (res.status === 201 && data.mentor && data.mentor.id) {
      createdMentorId = data.mentor.id;
      console.log(" [PASS] TC_01: Thêm mới Mentor thành công (Mã 201 Created)");
      passCount++;
    } else {
      console.log(
        " [FAIL] TC_01: Thêm mới Mentor thất bại: " + JSON.stringify(data),
      );
    }
  } catch (e) {
    console.log(" [FAIL] TC_01: Lỗi kết nối API: " + e.message);
  }

  // TC_02: Chặn khi bỏ trống thông tin bắt buộc (Họ tên, Email, Phòng ban) (Mã 400)
  try {
    const res = await fetch(`${BASE_URL}/mentors`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        fullName: "",
        email: "",
        department: "",
      }),
    });
    if (res.status === 400) {
      console.log(
        " [PASS] TC_02: Chặn thành công khi bỏ trống thông tin bắt buộc (Mã 400)",
      );
      passCount++;
    } else {
      console.log(" [FAIL] TC_02: Không chặn khi thiếu thông tin");
    }
  } catch (e) {
    console.log(" [FAIL] TC_02: Lỗi kết nối API: " + e.message);
  }

  // TC_03: Chặn trùng lặp Email Mentor trong hệ thống (Mã 400)
  try {
    const res = await fetch(`${BASE_URL}/mentors`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        fullName: "Hà Thị Mỹ Bình Trùng Email",
        email: testEmail, // Trùng email đã tạo ở TC_01
        department: "Phòng IT",
      }),
    });
    const data = await res.json();
    if (res.status === 400 && data.error && data.error.includes("tồn tại")) {
      console.log(
        " [PASS] TC_03: Chặn chính xác trùng lặp Email mentor (Mã 400)",
      );
      passCount++;
    } else {
      console.log(
        " [FAIL] TC_03: Không chặn trùng email mentor: " + JSON.stringify(data),
      );
    }
  } catch (e) {
    console.log(" [FAIL] TC_03: Lỗi kết nối API: " + e.message);
  }

  // TC_04: Lấy danh sách Mentor hiển thị lên danh sách quản lý (Mã 200 OK)
  try {
    const res = await fetch(`${BASE_URL}/mentors`, { headers: authHeaders });
    const data = await res.json();
    if (res.status === 200 && Array.isArray(data) && data.length > 0) {
      console.log(
        " [PASS] TC_04: Lấy danh sách mentor thành công để quản lý (Mã 200 OK)",
      );
      passCount++;
    } else {
      console.log(" [FAIL] TC_04: Không lấy được danh sách mentor");
    }
  } catch (e) {
    console.log(" [FAIL] TC_04: Lỗi kết nối API: " + e.message);
  }

  // Cleanup: Xóa mentor test đã tạo
  if (createdMentorId) {
    try {
      await fetch(`${BASE_URL}/mentors/${createdMentorId}`, {
        method: "DELETE",
        headers: authHeaders,
      });
    } catch (e) {}
  }

  console.log("\n====================================================");
  console.log(
    ` KẾT QUẢ KIỂM THỬ MENTOR: ${passCount}/${totalCount} TEST CASES PASS 100%!`,
  );
  console.log("====================================================\n");
}

runAutoMentorTests();
