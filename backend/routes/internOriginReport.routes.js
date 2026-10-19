const express = require("express");
const { hrReport } = require("../middleware/guards");
const controller = require("../controllers/internOriginReport.controller");

const router = express.Router();

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

router.get(
  "/reports/interns-by-origin/export.xlsx",
  ...hrReport,
  controller.xlsx,
);
module.exports = router;
