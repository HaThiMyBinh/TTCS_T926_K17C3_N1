// routes/applications.routes.js - Khai báo endpoint + phân quyền (chỉ HR)
const express = require("express");
const { requireRole } = require("../auth");
const controller = require("../controllers/applications.controller");

const router = express.Router();

router.get("/", requireRole("Admin", "HR"), controller.list);
router.patch("/:id/status", requireRole("HR"), controller.updateStatus);

module.exports = router;
