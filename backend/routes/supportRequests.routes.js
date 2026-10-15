const express = require("express");
const { requireRole } = require("../auth");
const controller = require("../controllers/supportRequests.controller");
const router = express.Router();
router.get(
  "/me/support-requests",
  requireRole("Intern"),
  controller.mine
);
module.exports = router;
