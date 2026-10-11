const express = require("express");
const { requireRole } = require("../auth");
const controller = require("../controllers/mentorWorkload.controller");

const router = express.Router();

// Chỉ HR xem khối lượng công việc của mentor để cân bằng phân công.
router.get("/mentors/workload", requireRole("HR"), controller.getWorkload);
router.get(
  "/mentors/:id/interns",
  requireRole("HR"),
  controller.getMentorInterns,
);

module.exports = router;
