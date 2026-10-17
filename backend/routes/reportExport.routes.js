const express = require("express");
const { requireRole } = require("../auth");
const { checkPermission } = require("../middleware/permissions");
const controller = require("../controllers/reportExport.controller");

const router = express.Router();
// Chỉ HR có quyền VIEW_REPORTS (Admin cấu hình trong ma trận phân quyền) mới được xuất báo cáo.
const hrReport = [requireRole("HR"), checkPermission("VIEW_REPORTS")];

router.get("/reports/export/excel", ...hrReport, controller.exportExcel);

module.exports = router;
