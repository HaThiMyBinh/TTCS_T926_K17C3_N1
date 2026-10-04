const express = require("express");
const db = require("../db");
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

// Tỷ lệ phần trăm làm tròn; null khi chưa có mẫu số để tránh hiển thị 0% gây hiểu nhầm.
function percent(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

router.get("/reports", checkPermission("VIEW_REPORTS"), async (req, res) => {
  try {
    const stats = await db.getOverviewStats();
    const reviewed = stats.applications.approved + stats.applications.rejected;
    res.json({
      generatedAt: new Date().toISOString(),
      ...stats,
      rates: {
        applicationApproval: percent(stats.applications.approved, reviewed),
        contractConfirmation: percent(
          stats.contracts.confirmed,
          stats.contracts.total,
        ),
        internMentorAssigned: percent(
          stats.interns.assigned,
          stats.interns.total,
        ),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi tải số liệu thống kê!" });
  }
});

// Giao nhiệm vụ và nộp báo cáo công việc chưa có bảng dữ liệu/nghiệp vụ nên chưa được triển khai.
// Endpoint chỉ giữ lại kiểm tra quyền và trả danh sách rỗng, không trả dữ liệu mẫu.
router.get("/tasks", checkPermission("ASSIGN_TASKS"), (req, res) => {
  res.json({ implemented: false, tasks: [] });
});

router.get("/submissions", checkPermission("SUBMIT_WORK"), (req, res) => {
  res.json({ implemented: false, submissions: [] });
});

module.exports = router;
