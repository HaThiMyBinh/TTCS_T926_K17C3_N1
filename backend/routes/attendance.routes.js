const express = require("express");
const { requireRole } = require("../auth");
const { checkPermission } = require("../middleware/permissions");
const controller = require("../controllers/attendance.controller");
const router = express.Router();
// Thực tập sinh chấm công; quyền SUBMIT_WORK do Admin cấu hình (cùng cơ chế với báo cáo tuần).
const internOnly = [requireRole("Intern"), checkPermission("SUBMIT_WORK")];
// HR xem mọi thực tập sinh; Mentor chỉ xem thực tập sinh mình phụ trách (kiểm tra trong service).
const staffOnly = requireRole("HR", "Mentor");
const noStore = (req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
};
router.use("/me/attendance", noStore);
router.use("/attendance", noStore);
router.get("/me/attendance/today", ...internOnly, controller.today);
router.get("/me/attendance", ...internOnly, controller.history);
router.post("/me/attendance/check-in", ...internOnly, controller.checkIn);
router.post("/me/attendance/check-out", ...internOnly, controller.checkOut);
router.post(
  "/me/attendance/:id/correction",
  ...internOnly,
  controller.requestCorrection,
);
router.get(
  "/attendance/corrections/pending",
  staffOnly,
  controller.pendingCorrections,
);
router.post(
  "/attendance/:id/correction/review",
  staffOnly,
  controller.reviewCorrection,
);
router.get("/interns/:id/attendance", staffOnly, controller.internAttendance);
module.exports = router;
