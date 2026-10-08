const express = require("express");
const { requireRole } = require("../auth");
const { handleMulterUpload } = require("../middleware/upload");
const controller = require("../controllers/contracts.controller");

const router = express.Router();

router.get("/me/contracts", requireRole("Intern"), controller.listMine);
router.get(
  "/me/contracts/:contractId/download",
  requireRole("Intern"),
  controller.downloadMine,
);
router.post(
  "/me/contracts/:contractId/confirm",
  requireRole("Intern"),
  controller.confirmMine,
);

router.post(
  "/interns/:id/contracts",
  requireRole("HR"),
  handleMulterUpload,
  controller.upload,
);
router.get("/interns/:id/contracts", requireRole("HR"), controller.list);
router.get(
  "/interns/:id/contracts/:contractId/download",
  requireRole("HR"),
  controller.download,
);
router.patch(
  "/interns/:id/contracts/:contractId",
  requireRole("HR"),
  controller.updateContract,
);
router.delete(
  "/interns/:id/contracts/:contractId",
  requireRole("HR"),
  controller.remove,
);

module.exports = router;
