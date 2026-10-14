const express = require("express");
const { requireRole } = require("../auth");
const controller = require("../controllers/allowances.controller");

const router = express.Router();

// Intern xem lịch sử phụ cấp của chính mình.
// Tài khoản phải đăng nhập và có role Intern.
router.get(
  "/me/allowances",
  requireRole("Intern"),
  controller.listMyAllowances
);

// Chỉ HR được nhập phụ cấp.
// Người nhập lấy từ token, không nhận từ body.
router.post(
  "/allowances",
  requireRole("HR"),
  controller.createAllowance
);

module.exports = router;
