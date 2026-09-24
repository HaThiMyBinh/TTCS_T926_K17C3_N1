const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

const USERS_FILE = path.join(__dirname, "users.json");
const PERMISSIONS_FILE = path.join(__dirname, "permissions.json");

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify([]));
}

if (!fs.existsSync(PERMISSIONS_FILE)) {
  fs.writeFileSync(
    PERMISSIONS_FILE,
    JSON.stringify(
      {
        HR: ["MANAGE_USERS", "EVALUATE_INTERN", "VIEW_REPORTS"],
        Mentor: ["ASSIGN_TASKS", "EVALUATE_INTERN"],
        Intern: ["SUBMIT_WORK"],
      },
      null,
      2,
    ),
  );
}

// API TẠO TÀI KHOẢN (POST /api/users)
app.post("/api/users", (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
      return res
        .status(400)
        .json({ error: "Vui lòng điền đầy đủ tất cả các trường!" });
    }

    const users = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
    if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      return res
        .status(400)
        .json({ error: "Email này đã tồn tại trong hệ thống!" });
    }

    const hashedPassword = crypto
      .createHash("sha256")
      .update(password)
      .digest("hex");
    const newUser = {
      id: Date.now(),
      name,
      email,
      password_hash: hashedPassword,
      role,
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");

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

// MIDDLEWARE KIỂM TRA PHÂN QUYỀN
function checkPermission(requiredPermission) {
  return (req, res, next) => {
    const userRole = req.headers["x-user-role"];
    if (!userRole) {
      return res.status(401).json({ error: "Chưa xác thực vai trò!" });
    }

    const permissions = JSON.parse(fs.readFileSync(PERMISSIONS_FILE, "utf-8"));
    const rolePermissions = permissions[userRole] || [];

    if (!rolePermissions.includes(requiredPermission)) {
      return res.status(403).json({
        error: `Từ chối truy cập: [${userRole}] không có quyền [${requiredPermission}]!`,
      });
    }

    next();
  };
}

// API lấy danh sách quyền: GET /api/permissions
app.get("/api/permissions", (req, res) => {
  try {
    const permissions = JSON.parse(fs.readFileSync(PERMISSIONS_FILE, "utf-8"));
    res.json(permissions);
  } catch (err) {
    res.status(500).json({ error: "Lỗi đọc quyền" });
  }
});

// API cập nhật quyền: POST /api/permissions/update
app.post("/api/permissions/update", (req, res) => {
  try {
    const { role, permissions } = req.body;
    const allPermissions = JSON.parse(
      fs.readFileSync(PERMISSIONS_FILE, "utf-8"),
    );

    allPermissions[role] = permissions;
    fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(allPermissions, null, 2));

    res.json({
      message: "Cập nhật quyền thành công!",
      permissions: allPermissions,
    });
  } catch (err) {
    res.status(500).json({ error: "Lỗi lưu quyền" });
  }
});

// API thử nghiệm có phân quyền: GET /api/reports
app.get("/api/reports", checkPermission("VIEW_REPORTS"), (req, res) => {
  res.json({ message: "Dữ liệu báo cáo mật!", data: [1, 2, 3] });
});

// API ĐĂNG KÝ HỒ SƠ THỰC TẬP SINH (POST /api/auth/register)
app.post("/api/auth/register", (req, res) => {
  try {
    const { name, email, password, phone, university, major, cvLink } =
      req.body;

    // Validate dữ liệu bắt buộc
    if (!name || !email || !password || !phone || !university) {
      return res
        .status(400)
        .json({ error: "Vui lòng điền đầy đủ các thông tin bắt buộc (*)" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: "Mật khẩu phải từ 6 ký tự trở lên!" });
    }

    // Đọc database kiểm tra trùng email
    const users = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
    if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      return res.status(400).json({
        error: "Email này đã được sử dụng! Vui lòng nhập email khác.",
      });
    }

    // Mã hóa mật khẩu an toàn
    const hashedPassword = crypto
      .createHash("sha256")
      .update(password)
      .digest("hex");

    // Lưu hồ sơ ứng tuyển vào Database
    const newCandidate = {
      id: Date.now(),
      name,
      email,
      phone,
      university,
      major: major || "Chưa cập nhật",
      cvLink: cvLink || "",
      password_hash: hashedPassword,
      role: "Intern",
      status: "Chờ duyệt",
      createdAt: new Date().toISOString(),
    };

    users.push(newCandidate);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");

    // Phản hồi thành công
    res.status(201).json({
      message:
        "Nộp hồ sơ ứng tuyển thành công! Nhà tuyển dụng sẽ sớm liên hệ với bạn.",
      candidate: {
        id: newCandidate.id,
        name: newCandidate.name,
        email: newCandidate.email,
        status: newCandidate.status,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi server xử lý hồ sơ ứng tuyển!" });
  }
});

app.listen(5000, () => {
  console.log(" Server Backend đang chạy tại http://localhost:5000");
});
