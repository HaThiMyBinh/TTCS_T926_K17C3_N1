const express = require("express");
const { requireRole } = require("../auth");
const controller = require("../controllers/schedule.controller");

const router = express.Router();

// Lịch thực tập cá nhân dành riêng cho tài khoản Intern
router.get("/me/schedule", requireRole("Intern"), controller.getMySchedule);

// Tra cứu lịch thực tập theo ID dành cho Admin, HR, Mentor
router.get(
  "/interns/:id/schedule",
  requireRole("Admin", "HR", "Mentor"),
  controller.getInternSchedule,
);

router.post(
  "/interns/:id/schedule/milestones",
  requireRole("HR", "Mentor"),
  controller.createMilestone,
);
router.post(
  "/interns/:id/schedule/template",
  requireRole("HR", "Mentor"),
  controller.createTemplate,
);
router.patch(
  "/interns/:id/schedule/milestones/:milestoneId",
  requireRole("HR", "Mentor"),
  controller.updateMilestone,
);
router.delete(
  "/interns/:id/schedule/milestones/:milestoneId",
  requireRole("HR", "Mentor"),
  controller.deleteMilestone,
);

module.exports = router;
