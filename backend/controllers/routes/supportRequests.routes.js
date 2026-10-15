const express = require("express");
const { requireRole } = require("../auth");
const { checkPermission } = require("../middleware/permissions");
const controller = require("../controllers/supportRequests.controller");

const router = express.Router();

// Chỉ Intern được gửi yêu cầu hỗ trợ (người gửi lấy từ token, không nhận từ body).
const internOnly = [requireRole("Intern"), checkPermission("SUBMIT_WORK")];

router.post("/support-requests", ...internOnly, controller.create);

module.exports = router;
