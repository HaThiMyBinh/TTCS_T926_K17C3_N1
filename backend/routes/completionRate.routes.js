const express = require("express");
const { requireRole } = require("../auth");
const { checkPermission } = require("../middleware/permissions");
const controller = require("../controllers/completionRate.controller");
const router = express.Router();
router.use("/reports/completion-rate", (req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});
const hrReport = [requireRole("HR"), checkPermission("VIEW_REPORTS")];
router.get("/reports/completion-rate", ...hrReport, controller.report);
router.get("/reports/completion-rate/interns", ...hrReport, controller.interns);
router.get(
  "/reports/completion-rate/export.csv",
  ...hrReport,
  controller.exportCsv,
);
module.exports = router;
