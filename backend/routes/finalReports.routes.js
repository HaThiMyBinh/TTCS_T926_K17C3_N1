const express = require("express");
const { requireRole } = require("../auth");
const { checkPermission } = require("../middleware/permissions");
const controller = require("../controllers/finalReports.controller");
const router = express.Router(); // HR cần quyền VIEW_REPORTS (Admin cấu hình trong ma trận phân quyền).
const hrOnly = [requireRole("HR"), checkPermission("VIEW_REPORTS")];
router.use("/final-reports", (req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});
router.get("/final-reports/preview", ...hrOnly, controller.preview);
router.get("/final-reports/recipients", ...hrOnly, controller.recipients);
router.delete("/final-reports/recipients/:id", ...hrOnly, controller.removeRecipient);
router.get("/final-reports", ...hrOnly, controller.list);
router.post("/final-reports", ...hrOnly, controller.create);
router.get("/final-reports/:id/export.csv", ...hrOnly, controller.csv);
router.get("/final-reports/:id", ...hrOnly, controller.detail);
router.put("/final-reports/:id", ...hrOnly, controller.update);
router.post("/final-reports/:id/finalize", ...hrOnly, controller.finalize);
router.post("/final-reports/:id/send", ...hrOnly, controller.send);
router.delete("/final-reports/:id", ...hrOnly, controller.remove);
module.exports = router;
