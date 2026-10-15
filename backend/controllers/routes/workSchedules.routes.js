const express = require("express");
const { requireRole } = require("../auth");
const controller = require("../controllers/workSchedules.controller");

const router = express.Router();
const viewers = requireRole("HR", "Admin"); // xem
const hrOnly = requireRole("HR"); // thay đổi

router.get("/me/work-schedule", requireRole("Intern"), controller.mine);

router.get("/work-schedules", viewers, controller.list);
router.post("/work-schedules", hrOnly, controller.create);
// Các đường dẫn cố định phải khai báo trước "/work-schedules/:id".
router.get("/work-schedules/assignments", viewers, controller.assignments);
router.post("/work-schedules/assignments", hrOnly, controller.assign);
router.delete("/work-schedules/assignments/:id", hrOnly, controller.removeAssignment);
router.get("/work-schedules/preview", viewers, controller.preview);
router.get("/work-schedules/resolved", viewers, controller.resolved);
router.get("/work-schedules/options", viewers, controller.options);
router.get("/work-schedules/:id", viewers, controller.get);
router.put("/work-schedules/:id", hrOnly, controller.update);
router.delete("/work-schedules/:id", hrOnly, controller.remove);

router.get("/work-holidays", viewers, controller.holidays);
router.post("/work-holidays", hrOnly, controller.addHoliday);
router.delete("/work-holidays/:id", hrOnly, controller.removeHoliday);

module.exports = router;
