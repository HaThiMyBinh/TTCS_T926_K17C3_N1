const express = require("express");
const { noStore } = require("../middleware/noStore");
const { requireRole } = require("../auth");
const { internOnly } = require("../middleware/guards");
const controller = require("../controllers/attendance.controller");
const router = express.Router();
// HR xem mọi thực tập sinh; Mentor chỉ xem thực tập sinh mình phụ trách (kiểm tra trong service).
const staffOnly = requireRole("HR", "Mentor");
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
