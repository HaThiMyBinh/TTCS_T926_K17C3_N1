const express = require("express");
const { requireRole } = require("../auth");
const { checkPermission } = require("../middleware/permissions");
const controller = require("../controllers/leaves.controller");

const router = express.Router();
const internOnly = [requireRole("Intern"), checkPermission("SUBMIT_WORK")];
const staffOnly = requireRole("HR", "Mentor");

router.get("/me/leaves", ...internOnly, controller.mine);
router.post("/me/leaves", ...internOnly, controller.submit);
router.post("/me/leaves/:id/cancel", ...internOnly, controller.cancel);

router.get("/leaves/pending", staffOnly, controller.pending);
router.get("/leaves", requireRole("HR"), controller.list);
router.post("/leaves/:id/review", staffOnly, controller.review);

module.exports = router;
