const express = require("express");
const router = express.Router();

// GET /api/health - dùng cho run.bat và các bộ test để chờ backend sẵn sàng
router.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", time: new Date().toISOString() });
});

module.exports = router;
