const express = require("express");
const { requireRole } = require("../auth");
const controller = require("../controllers/internSchoolStats.controller");

const router = express.Router();

// Chỉ HR xem thống kê nguồn ứng viên theo trường/ngành.
// Đặt trước internsRouter (`/interns/:id`) trong server.js để không bị nuốt route.
router.get(
  "/interns/stats/school",
  requireRole("HR"),
  controller.getSchoolStats,
);

module.exports = router;
