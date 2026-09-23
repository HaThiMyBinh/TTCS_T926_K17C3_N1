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

// 1. API TẠO TÀI KHOẢN (POST /api/users)
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

// 2. MIDDLEWARE KIỂM TRA PHÂN QUYỀN
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

// API thử nghiệm có phân quyền: GET /api/reports (Chỉ ai có quyền VIEW_REPORTS mới vào được)
app.get("/api/reports", checkPermission("VIEW_REPORTS"), (req, res) => {
  res.json({ message: "Dữ liệu báo cáo mật!", data: [1, 2, 3] });
});

app.listen(5000, () => {
  console.log(" Server Backend đang chạy tại http://localhost:5000");
});
