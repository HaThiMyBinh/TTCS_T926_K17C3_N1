const express = require("express");
const { requireRole } = require("../auth");
const controller = require("../controllers/allowances.controller");

const router = express.Router();

// Dữ liệu tiền bạc: không để trình duyệt/proxy lưu cache.
const noStore = (req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
};
const hrOnly = [noStore, requireRole("HR")];

// Thực tập sinh xem phụ cấp của chính mình (chỉ đọc).
router.get(
  "/me/allowances",
  noStore,
  requireRole("Intern"),
  controller.listMine,
);

router.get("/allowances/overview", ...hrOnly, controller.overview);
router.get("/interns/:id/allowances", ...hrOnly, controller.list);
router.post("/interns/:id/allowances", ...hrOnly, controller.create);
router.patch(
  "/interns/:id/allowances/:allowanceId",
  ...hrOnly,
  controller.update,
);
router.delete(
  "/interns/:id/allowances/:allowanceId",
  ...hrOnly,
  controller.remove,
);

module.exports = router;
