const express = require("express");
const { noStore } = require("../middleware/noStore");
const { hrReport } = require("../middleware/guards");
const controller = require("../controllers/completionRate.controller");
const router = express.Router();
router.use("/reports/completion-rate", noStore);
router.get("/reports/completion-rate", ...hrReport, controller.report);
router.get("/reports/completion-rate/interns", ...hrReport, controller.interns);
router.get(
  "/reports/completion-rate/export.csv",
  ...hrReport,
  controller.exportCsv,
);
router.get(
  "/reports/completion-rate/export.xlsx",
  ...hrReport,
  controller.xlsx,
);
module.exports = router;
