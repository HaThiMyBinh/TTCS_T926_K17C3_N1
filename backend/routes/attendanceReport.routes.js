const express = require("express");
const { hrReport } = require("../middleware/guards");
const controller = require("../controllers/attendanceReport.controller");

const router = express.Router();

router.get("/attendance/report", ...hrReport, controller.report);
router.get("/attendance/report/export.csv", ...hrReport, controller.exportCsv);
router.get(
  "/attendance/report/interns/:id/days",
  ...hrReport,
  controller.detail,
);

router.get("/attendance/report/export.xlsx", ...hrReport, controller.xlsx);
module.exports = router;
