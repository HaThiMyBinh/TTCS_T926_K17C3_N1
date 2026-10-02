const express = require("express");
const db = require("../db");
const { hashPassword } = require("../auth");
const { sendRouteError } = require("../errors");
const { checkPermission } = require("../middleware/permissions");
const { trimOrDefault } = require("../utils/request");
const router = express.Router();
const VALID_ROLES = ["Admin", "HR", "Mentor", "Intern"];
// --- TẠO & QUẢN LÝ TÀI KHOẢN (ADMIN & HR) ---

// POST /api/users - chỉ vai trò có quyền MANAGE_USERS
router.post("/users", checkPermission("MANAGE_USERS"), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
      return res
        .status(400)
        .json({ error: "Vui lòng điền đầy đủ tất cả các trường!" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: "Mật khẩu phải từ 6 ký tự trở lên!" });
    }

    if (!VALID_ROLES.includes(trimOrDefault(role))) {
      return res.status(400).json({
        error: `Vai trò không hợp lệ! Chỉ chấp nhận: ${VALID_ROLES.join(", ")}.`,
      });
    }

    const existing = await db.findUserByEmail(email);
    if (existing) {
      return res
        .status(400)
        .json({ error: "Email này đã tồn tại trong hệ thống!" });
    }

    const newUser = await db.insertUser({
      name: trimOrDefault(name),
      email: trimOrDefault(email).toLowerCase(),
      password_hash: await hashPassword(password),
      role: trimOrDefault(role),
      status: "ACTIVE",
    });

    res.status(201).json({
      message: "Tạo tài khoản thành công!",
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        status: newUser.status,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi server khi tạo tài khoản!" });
  }
});

// GET /api/users - chỉ vai trò có quyền MANAGE_USERS
router.get("/users", checkPermission("MANAGE_USERS"), async (req, res) => {
  try {
    const users = await db.getAllUsers();
    const safeUsers = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role || "Intern",
      status: u.status || "ACTIVE",
      phone: u.phone || "",
      university: u.university || "",
      major: u.major || "",
      cvLink: u.cvLink || "",
      createdAt: u.createdAt || u.created_at,
    }));
    res.json(safeUsers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi đọc danh sách tài khoản!" });
  }
});

// DELETE /api/users/:id - chỉ vai trò có quyền MANAGE_USERS
router.delete(
  "/users/:id",
  checkPermission("MANAGE_USERS"),
  async (req, res) => {
    try {
      await db.deleteUser(req.params.id);
      res.json({ message: "Đã xóa tài khoản thành công!" });
    } catch (err) {
      return sendRouteError(res, err, "Lỗi khi xóa tài khoản!");
    }
  },
);

// GET /api/stats - chỉ vai trò có quyền MANAGE_USERS
router.get("/stats", checkPermission("MANAGE_USERS"), async (req, res) => {
  try {
    const users = await db.getAllUsers();
    const stats = {
      totalUsers: users.length,
      adminCount: users.filter((u) => u.role === "Admin").length,
      hrCount: users.filter((u) => u.role === "HR").length,
      mentorCount: users.filter((u) => u.role === "Mentor").length,
      internCount: users.filter((u) => u.role === "Intern").length,
      candidatesCount: users.filter((u) => u.status === "PENDING").length,
    };
    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi thống kê dữ liệu!" });
  }
});


module.exports = router;


