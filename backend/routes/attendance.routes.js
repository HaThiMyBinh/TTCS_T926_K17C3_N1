const express = require("express");
const { requireRole } = require("../auth");
const controller = require("../controllers/attendance.controller");

const router = express.Router();

// Chỉ Intern được chấm công; giờ check-in do server quyết định, body bị bỏ qua.
router.post(
  "/attendance/check-in",
  requireRole("Intern"),
  controller.checkIn,
);

module.exports = router;
