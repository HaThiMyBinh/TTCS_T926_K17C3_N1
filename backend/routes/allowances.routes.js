const express = require("express");
const { requireRole } = require("../auth");
const controller = require("../controllers/allowances.controller");

const router = express.Router();

// Chỉ HR được nhập phụ cấp; người nhập lấy từ token, không nhận từ body.
router.post("/allowances", requireRole("HR"), controller.createAllowance);

module.exports = router;
