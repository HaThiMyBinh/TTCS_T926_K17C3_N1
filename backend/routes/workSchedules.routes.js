const express = require("express");
const { requireRole } = require("../auth");
const controller = require("../controllers/workSchedules.controller");

const router = express.Router();

// Lịch làm việc theo nhóm: chỉ HR được xem và quản lý (CRUD).
const hrOnly = requireRole("HR");

router.get("/schedules", hrOnly, controller.list);
router.post("/schedules", hrOnly, controller.create);
router.get("/schedules/:id", hrOnly, controller.get);
router.put("/schedules/:id", hrOnly, controller.update);
router.delete("/schedules/:id", hrOnly, controller.remove);

module.exports = router;
