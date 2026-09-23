// backend/server.js
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto"); // Có sẵn trong Node.js, không cần cài thêm

const app = express();
app.use(cors()); // Cho phép Frontend gọi sang
app.use(express.json());

const DB_FILE = path.join(__dirname, "users.json");

// Khởi tạo file database nếu chưa có
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify([]));
}

// TASK 3: API POST /api/users (Tạo tài khoản, mã hóa mật khẩu, kiểm tra trùng email)
app.post("/api/users", (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    // Validate dữ liệu đầu vào
    if (!name || !email || !password || !role) {
      return res
        .status(400)
        .json({ error: "Vui lòng điền đầy đủ tất cả các trường!" });
    }

    // TASK 2: Đọc dữ liệu từ Database (file users.json)
    const users = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));

    // Kiểm tra trùng email
    const isExist = users.some(
      (u) => u.email.toLowerCase() === email.toLowerCase(),
    );
    if (isExist) {
      return res
        .status(400)
        .json({ error: "Email này đã tồn tại trong hệ thống!" });
    }

    // Mã hóa mật khẩu bằng SHA-256
    const hashedPassword = crypto
      .createHash("sha256")
      .update(password)
      .digest("hex");

    // Lưu người dùng mới vào Database
    const newUser = {
      id: Date.now(),
      name,
      email,
      password_hash: hashedPassword,
      role,
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2), "utf-8");

    // Trả về kết quả thành công cho Frontend
    res.status(201).json({
      message: "Tạo tài khoản thành công!",
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Lỗi server!" });
  }
});

// Chạy server tại cổng 5000
app.listen(5000, () => {
  console.log("🚀 Backend Server đang chạy tại http://localhost:5000");
});
