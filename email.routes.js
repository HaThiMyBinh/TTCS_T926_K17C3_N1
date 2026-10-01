// routes/email.routes.js - Cấu hình Email (chỉ Admin) & Nhật ký Email (chỉ HR) - US8
const express = require("express");
const { requireRole } = require("../auth");
const controller = require("../controllers/email.controller");

const router = express.Router();

// Cấu hình SMTP: chỉ Admin được xem / sửa / gửi thử
router.get("/config", requireRole("Admin"), controller.getConfig);
router.put("/config", requireRole("Admin"), controller.updateConfig);
router.post("/config/test", requireRole("Admin"), controller.testConfig);

// Nhật ký gửi email: chỉ HR được xem và gửi lại (Admin không truy cập)
router.get("/logs", requireRole("HR"), controller.listLogs);
router.post("/logs/:id/retry", requireRole("HR"), controller.retryLog);

module.exports = router;
