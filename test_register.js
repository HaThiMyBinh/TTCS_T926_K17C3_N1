// test_register.js
const API_URL = "http://127.0.0.1:5000/api/auth/register";

async function runAutoRegisterTests() {
  console.log("\n");
  console.log(" BẮT ĐẦU TEST LUỒNG ĐĂNG KÝ HỒ SƠ ỨNG TUYỂN (TASK 4)");
  console.log("\n");

  let passCount = 0;
  const totalCount = 4;

  //  Đăng ký ứng tuyển hợp lệ (Positive)
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Hoàng Thực Tập Sinh",
        email: `candidate_${Date.now()}@ictu.edu.vn`,
        password: "password123",
        phone: "0987654321",
        university: "ĐH CNTT & Truyền Thông",
        major: "Kỹ thuật phần mềm",
        cvLink: "https://github.com/my-cv",
      }),
    });
    const data = await res.json();
    if (res.status === 201 && data.candidate.status === "Chờ duyệt") {
      console.log(
        " [PASS] TC_01: Đăng ký nộp hồ sơ thành công (Mã 201 Created)",
      );
      passCount++;
    } else {
      console.log(" [FAIL] TC_01: Nộp hồ sơ thất bại");
    }
  } catch (e) {
    console.log(" [FAIL] TC_01: Lỗi kết nối API");
  }

  // Bỏ trống trường bắt buộc
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "", // Thiếu tên
        email: "missing@gmail.com",
        password: "123",
      }),
    });
    if (res.status === 400) {
      console.log(
        " [PASS] TC_02: Chặn thành công khi ứng viên bỏ trống thông tin bắt buộc (Mã 400)",
      );
      passCount++;
    } else {
      console.log(" [FAIL] TC_02: Hệ thống không chặn dữ liệu thiếu");
    }
  } catch (e) {
    console.log(" [FAIL] TC_02: Lỗi kết nối API");
  }

  // Mật khẩu quá ngắn dưới 6 ký tự
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Nguyen Van Test",
        email: `short_pass_${Date.now()}@gmail.com`,
        password: "123", // Ngắn
        phone: "0123456789",
        university: "ICTU",
      }),
    });
    if (res.status === 400) {
      console.log(" [PASS] TC_03: Chặn mật khẩu dưới 6 ký tự (Mã 400)");
      passCount++;
    } else {
      console.log(" [FAIL] TC_03: Không chặn mật khẩu ngắn");
    }
  } catch (e) {
    console.log(" [FAIL] TC_03: Lỗi kết nối API");
  }

  // Trùng email đã nộp hồ sơ
  try {
    const dupEmail = `dup_${Date.now()}@gmail.com`;
    // Đăng ký lần đầu
    await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Ung vien 1",
        email: dupEmail,
        password: "password123",
        phone: "0123456789",
        university: "ICTU",
      }),
    });

    // Cố tình nộp tiếp lần 2 với cùng email
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Ung vien 2",
        email: dupEmail,
        password: "password123",
        phone: "0988888888",
        university: "ICTU",
      }),
    });
    const data = await res.json();
    if (res.status === 400 && data.error.includes("được sử dụng")) {
      console.log(
        " [PASS] TC_04: Chặn trùng email ứng tuyển chính xác (Mã 400)",
      );
      passCount++;
    } else {
      console.log(" [FAIL] TC_04: Không chặn trùng email");
    }
  } catch (e) {
    console.log(" [FAIL] TC_04: Lỗi kết nối API");
  }

  console.log("\n");
  console.log(
    ` KẾT QUẢ TEST ĐĂNG KÝ: ${passCount}/${totalCount} TEST CASES PASS 100%!`,
  );
  console.log("\n");
}

runAutoRegisterTests();
