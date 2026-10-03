const express = require("express");
const { requireRole } = require("../auth");
const controller = require("../controllers/programs.controller");

const router = express.Router();

router.get(
  "/departments",
  requireRole("Admin", "HR", "Mentor"),
  controller.departments,
);
router.post("/departments", requireRole("HR"), controller.addDepartment);
router.delete(
  "/departments/:id",
  requireRole("HR"),
  controller.removeDepartment,
);

router.get("/programs", requireRole("Admin", "HR"), controller.list);
router.post("/programs", requireRole("HR"), controller.create);
router.get("/programs/:id", requireRole("Admin", "HR"), controller.get);
router.put("/programs/:id", requireRole("HR"), controller.update);
router.delete("/programs/:id", requireRole("HR"), controller.remove);

module.exports = router;
