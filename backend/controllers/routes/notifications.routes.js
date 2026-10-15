const express = require("express");
const controller = require("../controllers/notifications.controller");

// Mọi vai trò đã đăng nhập đều có chuông; dữ liệu luôn lấy theo id trong token.
const router = express.Router();
router.get("/notifications", controller.list);
router.post("/notifications/read-all", controller.markAllRead);
router.post("/notifications/:id/read", controller.markRead);

module.exports = router;
