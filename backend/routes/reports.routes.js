const express = require("express");
const db = require("../db");
const { checkPermission } = require("../middleware/permissions");
const { sendRouteError } = require("../errors");

const router = express.Router();

// Tỷ lệ phần trăm làm tròn; null khi chưa có mẫu số để tránh hiển thị 0% gây hiểu nhầm.
function roundedPercent(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

// GET /api/reports - thống kê tổng quan (quyền VIEW_REPORTS)
router.get("/reports", checkPermission("VIEW_REPORTS"), async (req, res) => {
  try {
    const stats = await db.getOverviewStats();
    const reviewed = stats.applications.approved + stats.applications.rejected;
    res.json({
      generatedAt: new Date().toISOString(),
      ...stats,
      rates: {
        applicationApproval: roundedPercent(
          stats.applications.approved,
          reviewed,
        ),
        contractConfirmation: roundedPercent(
          stats.contracts.confirmed,
          stats.contracts.total,
        ),
        internMentorAssigned: roundedPercent(
          stats.interns.assigned,
          stats.interns.total,
        ),
      },
    });
  } catch (err) {
    return sendRouteError(res, err, "Lỗi tải số liệu thống kê!");
  }
});

// GET /api/stats - số lượng tài khoản theo vai trò (quyền MANAGE_USERS); đếm bằng SQL, không tải cả bảng
router.get("/stats", checkPermission("MANAGE_USERS"), async (req, res) => {
  try {
    res.json(await db.getUserStats());
  } catch (err) {
    return sendRouteError(res, err, "Lỗi thống kê dữ liệu!");
  }
});

// Giao nhiệm vụ đã có API thật ở routes/tasks.routes.js.
// Nộp báo cáo công việc chưa có bảng dữ liệu/nghiệp vụ nên chưa được triển khai.
// Endpoint chỉ giữ lại kiểm tra quyền và trả danh sách rỗng, không trả dữ liệu mẫu.
router.get("/submissions", checkPermission("SUBMIT_WORK"), (req, res) => {
  res.json({ implemented: false, submissions: [] });
});

module.exports = router;
