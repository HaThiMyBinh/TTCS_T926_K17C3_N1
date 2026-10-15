const express = require("express");
const { requireRole } = require("../auth");
const { checkPermission } = require("../middleware/permissions");
const controller = require("../controllers/attendanceReport.controller");

const router = express.Router();
const hrReport = [requireRole("HR"), checkPermission("VIEW_REPORTS")];

router.get("/attendance/report", ...hrReport, controller.report);
router.get("/attendance/report/export.csv", ...hrReport, controller.exportCsv);
router.get("/attendance/report/interns/:id/days", ...hrReport, controller.detail);

module.exports = router;
