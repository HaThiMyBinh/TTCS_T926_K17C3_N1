const express = require("express");
const { requireRole } = require("../auth");
const {
  PERMISSIONS_FILE,
  readJson,
  writeJson,
  checkPermission,
} = require("../middleware/permissions");

const router = express.Router();
const VALID_ROLES = ["Admin", "HR", "Mentor", "Intern"];
const VALID_PERMISSIONS = [
  "MANAGE_USERS",
  "ASSIGN_TASKS",
  "SUBMIT_WORK",
  "VIEW_REPORTS",
  "SYSTEM_SETTINGS",
];
router.get("/permissions", (req, res) => {
  try {
    const permissions = readJson(PERMISSIONS_FILE, {});
    if (!permissions.HR) permissions.HR = ["VIEW_REPORTS"];
    if (!permissions.Mentor) permissions.Mentor = ["ASSIGN_TASKS"];
    if (!permissions.Intern) permissions.Intern = [];
    res.json(permissions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi đọc ma trận quyền!" });
  }
});

router.post("/permissions/update", requireRole("Admin"), (req, res) => {
  try {
    const { role, permissions } = req.body;
    if (!role || !Array.isArray(permissions)) {
      return res
        .status(400)
        .json({ error: "Dữ liệu cập nhật quyền không hợp lệ!" });
    }
    if (
      !VALID_ROLES.includes(role) ||
      !permissions.every((p) => VALID_PERMISSIONS.includes(p))
    ) {
      return res
        .status(400)
        .json({ error: "Vai trò hoặc mã quyền không hợp lệ!" });
    }

    const allPermissions = readJson(PERMISSIONS_FILE, {});
    allPermissions[role] = permissions;
    writeJson(PERMISSIONS_FILE, allPermissions);

    res.json({
      message: `Cập nhật quyền cho vai trò [${role}] thành công!`,
      permissions: allPermissions,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi lưu cấu hình quyền!" });
  }
});

router.get("/reports", checkPermission("VIEW_REPORTS"), (req, res) => {
  res.json({
    message: "Dữ liệu báo cáo thống kê đào tạo mật!",
    data: [
      { month: "Tháng 1", interns: 12, completed: 10 },
      { month: "Tháng 2", interns: 15, completed: 14 },
      { month: "Tháng 3", interns: 20, completed: 18 },
    ],
  });
});

router.get("/tasks", checkPermission("ASSIGN_TASKS"), (req, res) => {
  res.json({
    message: "Danh sách nhiệm vụ đào tạo thực tập sinh",
    tasks: [
      {
        id: 1,
        title: "Tìm hiểu kiến trúc MVC",
        deadline: "2026-10-01",
        status: "In Progress",
      },
      {
        id: 2,
        title: "Xây dựng RESTful API",
        deadline: "2026-10-05",
        status: "Todo",
      },
    ],
  });
});

router.get("/submissions", checkPermission("SUBMIT_WORK"), (req, res) => {
  res.json({
    message: "Danh sách báo cáo công việc của thực tập sinh",
    submissions: [
      {
        id: 101,
        title: "Báo cáo tuần 1: Tổng quan dự án",
        date: "2026-09-20",
        status: "Đã nộp",
      },
    ],
  });
});

router.get("/settings", checkPermission("SYSTEM_SETTINGS"), (req, res) => {
  res.json({
    message: "Cài đặt tham số hệ thống nội bộ",
    settings: { allowPublicRegistration: true, maxInternPerMentor: 5 },
  });
});

module.exports = router;



