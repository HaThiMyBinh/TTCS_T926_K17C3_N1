// test.js
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { loginAs, cleanupTestData } = require("./test_helpers");

// Sử dụng 127.0.0.1 để tránh lỗi mạng Windows
const API_URL = "http://127.0.0.1:5000/api/users";

async function runAutoTests() {
  console.log("\n");
  console.log(" BẮT ĐẦU CHẠY TEST TẠO TÀI KHOẢN (TASK 5)");
  console.log("\n");

  let passCount = 0;
  const totalCount = 5;
  let hrEmail = null; // dùng lại ở TC_05 để kiểm tra password_hash trong MySQL
  const createdEmails = []; // email các tài khoản test tạo ra -> dọn cuối phiên

  // API tạo tài khoản yêu cầu quyền MANAGE_USERS (Admin/HR) - phải đăng nhập
  // thật để lấy token
  const adminToken = await loginAs("Admin");
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${adminToken}`,
  };

  // Tạo tài khoản HR hợp lệ
  try {
    hrEmail = `auto_hr_${Date.now()}@ictu.edu.vn`;
    createdEmails.push(hrEmail);
    const res = await fetch(API_URL, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "Hà Thị Mỹ Bình",
        email: hrEmail,
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

  // Tạo tài khoản Mentor hợp lệ
  try {
    const mentorEmail = `auto_mentor_${Date.now()}@ictu.edu.vn`;
    createdEmails.push(mentorEmail);
    const res = await fetch(API_URL, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "Hà Thị Mỹ Bình",
        email: mentorEmail,
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

  // Gửi thiếu thông tin
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "",
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

  // Kiểm tra chặn trùng Email
  try {
    const duplicateEmail = `trung_email_${Date.now()}@ictu.edu.vn`;
    createdEmails.push(duplicateEmail);
    await fetch(API_URL, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "Hà Thị Mỹ Bình",
        email: duplicateEmail,
        password: "password123",
        role: "Intern",
      }),
    });

    const res = await fetch(API_URL, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "Hà Thị Mỹ Bình",
        email: duplicateEmail,
        password: "password123",
        role: "Intern",
      }),
    });
    const data = await res.json();

    if (res.status === 400 && data.error.includes("tồn tại")) {
      console.log("[PASS] TC_04: Bắt chính xác lỗi trùng Email (Báo lỗi 400)");
      passCount++;
    } else {
      console.log(" [FAIL] TC_04: Không phát hiện được email bị trùng");
    }
  } catch (e) {
    console.log(" [FAIL] TC_04: Lỗi kết nối API");
  }

  // Kiểm tra tính bảo mật mật khẩu trong Database (đọc trực tiếp từ MySQL)
  try {
    const configPath = path.join(__dirname, "..", "db_config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const conn = await mysql.createConnection(config);

    const [rows] = await conn.query(
      "SELECT password_hash FROM users WHERE email = ? LIMIT 1",
      [hrEmail],
    );
    await conn.end();

    const lastUser = rows[0];

    // Hash bcrypt hợp lệ có dạng "$2a$10$..." hoặc "$2b$10$..." (~60 ký tự)
    const isBcryptHash =
      lastUser &&
      typeof lastUser.password_hash === "string" &&
      /^\$2[aby]\$\d{2}\$.{53}$/.test(lastUser.password_hash);

    if (lastUser && lastUser.password_hash !== "password123" && isBcryptHash) {
      console.log(
        " [PASS] TC_05: Mật khẩu được mã hóa an toàn bằng bcrypt (có salt)",
      );
      passCount++;
    } else {
      console.log(
        " [FAIL] TC_05: Mật khẩu chưa được mã hóa an toàn bằng bcrypt",
      );
    }
  } catch (e) {
    console.log(
      " [FAIL] TC_05: Không đọc được Database MySQL (" + e.message + ")",
    );
  }

  // Dọn dữ liệu test (không ảnh hưởng kết quả PASS/FAIL ở trên)
  try {
    const removed = await cleanupTestData(createdEmails);
    console.log(` [CLEANUP] Đã xóa ${removed} bản ghi dữ liệu test.`);
  } catch (e) {
    console.log(" [CLEANUP] Không dọn được dữ liệu test: " + e.message);
  }

  console.log("\n");
  console.log(` KẾT QUẢ: ${passCount}/${totalCount} TEST CASES PASS`);
  console.log("\n");

  // Trả mã thoát khác 0 khi có test FAIL để `npm test` / CI nhận biết được
  if (passCount < totalCount) process.exitCode = 1;
}

runAutoTests();
