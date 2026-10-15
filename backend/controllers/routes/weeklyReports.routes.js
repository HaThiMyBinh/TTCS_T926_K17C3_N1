const express = require("express");
const { requireRole } = require("../auth");
const { checkPermission } = require("../middleware/permissions");
const { handleMulterUpload } = require("../middleware/upload");
const controller = require("../controllers/weeklyReports.controller");

const router = express.Router();

// Thực tập sinh nộp báo cáo tuần; quyền SUBMIT_WORK do Admin cấu hình.
const internOnly = [requireRole("Intern"), checkPermission("SUBMIT_WORK")];

router.put("/me/weekly-reports", ...internOnly, controller.submitMyReport);
router.get("/me/weekly-reports", ...internOnly, controller.listMyReports);
router.get("/me/weekly-reports/status", ...internOnly, controller.getMyStatus);
router.post(
  "/me/weekly-reports/:id/attachments",
  ...internOnly,
  handleMulterUpload,
  controller.uploadMyReportAttachment,
);
router.delete(
  "/me/weekly-reports/:id/attachments/:attachmentId",
  ...internOnly,
  controller.deleteMyReportAttachment,
);

// Tải file: chủ báo cáo (cần SUBMIT_WORK) hoặc Mentor phụ trách.
router.get(
  "/weekly-reports/:id/attachments/:attachmentId/download",
  requireRole("Mentor", "Intern"),
  (req, res, next) =>
    req.user.role === "Intern"
      ? checkPermission("SUBMIT_WORK")(req, res, next)
      : next(),
  controller.downloadReportAttachment,
);

// Mentor chỉ xem (chỉ đọc) nội dung báo cáo của thực tập sinh được phân công cho mình.
router.get(
  "/weekly-reports/overview",
  requireRole("Mentor"),
  controller.getMentorOverview,
);
router.get(
  "/weekly-reports",
  requireRole("Mentor"),
  controller.listReportsForMentor,
);

// Mentor viết / sửa / xóa phản hồi cho báo cáo của thực tập sinh mình phụ trách.
// Thực tập sinh chỉ đọc phản hồi qua GET /me/weekly-reports.
router.put(
  "/weekly-reports/:id/feedback",
  requireRole("Mentor"),
  controller.submitFeedback,
);
router.delete(
  "/weekly-reports/:id/feedback",
  requireRole("Mentor"),
  controller.deleteFeedback,
);

module.exports = router;
