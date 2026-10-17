const express = require("express");
const { requireRole } = require("../auth");
const controller = require("../controllers/programs.controller");

const { checkPermission } = require("../middleware/permissions");
const completion = require("../controllers/programCompletion.controller");
const router = express.Router();
router.put(
  "/programs/:id/interns/:internId/completion",
  (req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  },
  requireRole("HR"),
  checkPermission("VIEW_REPORTS"),
  completion.save,
);

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
router.get("/programs/:id/interns", requireRole("HR"), controller.interns);
router.get(
  "/programs/:id/available-interns",
  requireRole("HR"),
  controller.availableInterns,
);
router.post("/programs/:id/interns", requireRole("HR"), controller.addInterns);
router.delete(
  "/programs/:id/interns/:internId",
  requireRole("HR"),
  controller.removeIntern,
);
router.put("/programs/:id/mentor", requireRole("HR"), controller.assignMentor);
router.delete("/programs/:id", requireRole("HR"), controller.remove);

module.exports = router;
