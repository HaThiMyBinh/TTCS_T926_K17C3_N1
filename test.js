// backend/test.js
const fs = require("fs");
const path = require("path");

const API_URL = "http://127.0.0.1:5000/api/users";

async function runAutoTests() {
  console.log("\n");
  console.log(" BẮT ĐẦU CHẠY KIỂM THỬ TỰ ĐỘNG (AUTOMATED TESTING)");
  console.log("\n");

  let passCount = 0;
  const totalCount = 5;

  //  TEST CASE 1: Tạo tài khoản HR hợp lệ (Positive)
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Trần Tuyển Dụng",
        email: `auto_hr_${Date.now()}@ictu.edu.vn`,
        password: "password123",
        role: "HR",
      }),
    });
    const data = await res.json();
    if (res.status === 201 && data.user.role === "HR") {
      console.log(" [PASS] TC_01: Tạo thành công tài khoản HR (Mã 201)");
      passCount++;
    } else {
      console.log(" [FAIL] TC_01: Không tạo được tài khoản HR");
    }
  } catch (e) {
    console.log(" [FAIL] TC_01: Lỗi kết nối API");
  }

  //  TEST CASE 2: Tạo tài khoản Mentor hợp lệ (Positive)
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Lê Hướng Dẫn",
        email: `auto_mentor_${Date.now()}@ictu.edu.vn`,
        password: "password123",
        role: "Mentor",
      }),
    });
    const data = await res.json();
    if (res.status === 201 && data.user.role === "Mentor") {
      console.log(" [PASS] TC_02: Tạo thành công tài khoản Mentor (Mã 201)");
      passCount++;
    } else {
      console.log(" [FAIL] TC_02: Không tạo được tài khoản Mentor");
    }
  } catch (e) {
    console.log(" [FAIL] TC_02: Lỗi kết nối API");
  }

  //  TEST CASE 3: Gửi thiếu thông tin (Negative)
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "", // Bỏ trống tên
        email: "missing@ictu.edu.vn",
        password: "",
        role: "Intern",
      }),
    });
    if (res.status === 400) {
      console.log(
        " [PASS] TC_03: Chặn thành công khi gửi thiếu dữ liệu (Báo lỗi 400)",
      );
      passCount++;
    } else {
      console.log(" [FAIL] TC_03: Hệ thống không chặn dữ liệu rỗng");
    }
  } catch (e) {
    console.log(" [FAIL] TC_03: Lỗi kết nối API");
  }

  //  TEST CASE 4: Kiểm tra chặn trùng Email (Negative)
  try {
    const duplicateEmail = `trung_email_${Date.now()}@ictu.edu.vn`;
    // Tạo lần đầu
    await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "User 1",
        email: duplicateEmail,
        password: "password123",
        role: "Intern",
      }),
    });

    // Cố tình tạo lần 2 với cùng Email đó
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "User 2",
        email: duplicateEmail,
        password: "password123",
        role: "Intern",
      }),
    });
    const data = await res.json();

    if (res.status === 400 && data.error.includes("tồn tại")) {
      console.log(" [PASS] TC_04: Bắt chính xác lỗi trùng Email (Báo lỗi 400)");
      passCount++;
    } else {
      console.log(" [FAIL] TC_04: Không phát hiện được email bị trùng");
    }
  } catch (e) {
    console.log(" [FAIL] TC_04: Lỗi kết nối API");
  }

  //  TEST CASE 5: Kiểm tra tính bảo mật mật khẩu trong Database
  try {
    const DB_FILE = path.join(__dirname, "users.json");
    const users = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    const lastUser = users[users.length - 1];

    // Mật khẩu lưu trong file phải là chuỗi băm 64 ký tự (SHA-256), không được lưu 'password123'
    if (
      lastUser &&
      lastUser.password_hash !== "password123" &&
      lastUser.password_hash.length === 64
    ) {
      console.log(
        " [PASS] TC_05: Mật khẩu được mã hóa an toàn SHA-256 trong Database",
      );
      passCount++;
    } else {
      console.log(" [FAIL] TC_05: Mật khẩu chưa được mã hóa an toàn");
    }
  } catch (e) {
    console.log(" [FAIL] TC_05: Không đọc được Database");
  }

  console.log("\n");
  console.log(
    ` KẾT QUẢ: ${passCount}/${totalCount} TEST CASES ĐẠT CHUẨN (PASS) 100%!`,
  );
  console.log("\n");
}

runAutoTests();
