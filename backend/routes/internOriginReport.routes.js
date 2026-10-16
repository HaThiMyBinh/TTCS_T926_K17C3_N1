const express = require("express");
const { requireRole } = require("../auth");
const { checkPermission } = require("../middleware/permissions");
const controller = require("../controllers/internOriginReport.controller");

const router = express.Router();
const hrReport = [requireRole("HR"), checkPermission("VIEW_REPORTS")];

router.get("/reports/interns-by-origin", ...hrReport, controller.report);
router.get(
  "/reports/interns-by-origin/export.csv",
  ...hrReport,
  controller.exportCsv,
);
router.get(
  "/reports/interns-by-origin/interns",
  ...hrReport,
  controller.interns,
);

module.exports = router;
