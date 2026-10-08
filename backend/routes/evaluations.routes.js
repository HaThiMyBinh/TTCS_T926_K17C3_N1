const express = require("express");
const { requireRole } = require("../auth");
const controller = require("../controllers/evaluations.controller");

const router = express.Router();

// Chỉ Mentor; và chỉ với thực tập sinh được phân công cho mình (service trả 403 nếu không).
const mentorOnly = requireRole("Mentor");

router.get("/evaluations/overview", mentorOnly, controller.getOverview);
router.get("/interns/:id/evaluation", mentorOnly, controller.getEvaluation);
router.put("/interns/:id/evaluation", mentorOnly, controller.saveEvaluation);
router.delete(
  "/interns/:id/evaluation",
  mentorOnly,
  controller.deleteEvaluation,
);

module.exports = router;
