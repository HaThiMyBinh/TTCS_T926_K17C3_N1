const express = require("express");
const { requireRole } = require("../auth");
const { checkPermission } = require("../middleware/permissions");
const controller = require("../controllers/leaves.controller");
const router = express.Router();
// Thực tập sinh gửi / xem / hủy đơn của chính mình; quyền SUBMIT_WORK do Admin cấu hình.
const internOnly = [requireRole("Intern"), checkPermission("SUBMIT_WORK")];
// HR xem mọi đơn; Mentor chỉ xem/duyệt đơn của thực tập sinh mình phụ trách (kiểm tra trong service).
const hrOnly = requireRole("HR");
const staffOnly = requireRole("HR", "Mentor");
const noStore = (req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
};
router.use("/me/leaves", noStore);
router.use("/leaves", noStore);
router.post("/me/leaves", ...internOnly, controller.create);
router.get("/me/leaves", ...internOnly, controller.mine);
router.post("/me/leaves/:id/cancel", ...internOnly, controller.cancel);
// GET /api/leaves — HR xem đơn nghỉ của mọi thực tập sinh.
//   ?status=PENDING|APPROVED|REJECTED|CANCELLED &from=YYYY-MM-DD &to=YYYY-MM-DD &intern_id=<id> &page=1 &page_size=20
// Phải khai báo "/leaves/pending" trước "/leaves/:id/..." để không bị nuốt.
router.get("/leaves", hrOnly, controller.list);
router.get("/leaves/pending", staffOnly, controller.pending);
router.post("/leaves/:id/review", staffOnly, controller.review);
module.exports = router;
