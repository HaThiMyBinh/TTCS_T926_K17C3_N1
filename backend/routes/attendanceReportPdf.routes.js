const express = require("express");
const { requireRole } = require("../auth");
const { checkPermission } = require("../middleware/permissions");
const controller = require("../controllers/attendanceReportPdf.controller");

const router = express.Router();

// Chỉ HR + có quyền VIEW_REPORTS
const hrReport = [
  requireRole("HR"),
  checkPermission("VIEW_REPORTS"),
];

router.get(
  "/attendance/report/export.pdf",
  ...hrReport,
  controller.exportPdf
);

module.exports = router;