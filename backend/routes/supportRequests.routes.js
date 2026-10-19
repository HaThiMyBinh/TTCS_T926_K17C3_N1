const express = require("express");
const { noStore } = require("../middleware/noStore");
const { requireRole } = require("../auth");
const { checkPermission } = require("../middleware/permissions");
const { handleMulterUpload } = require("../middleware/upload");
const c = require("../controllers/supportRequests.controller");
const router = express.Router();
const intern = [noStore, requireRole("Intern"), checkPermission("SUBMIT_WORK")];
const hr = [noStore, requireRole("HR")];
router.get("/me/support-requests", ...intern, c.mine);
router.post("/me/support-requests", ...intern, c.create);
router.post(
  "/me/support-requests/:id/attachments",
  ...intern,
  handleMulterUpload,
  c.uploadMine,
);
router.delete(
  "/me/support-requests/:id/attachments/:attachmentId",
  ...intern,
  c.removeAttachment,
);
router.post("/me/support-requests/:id/cancel", ...intern, c.cancel);
router.get(
  "/support-requests/:id/attachments/:attachmentId/download",
  noStore,
  requireRole("Intern", "HR"),
  c.download,
);
router.get("/support-requests", ...hr, c.list);
router.get("/support-requests/:id", ...hr, c.detail);
router.post("/support-requests/:id/process", ...hr, c.process);
router.post(
  "/support-requests/:id/result-attachments",
  ...hr,
  handleMulterUpload,
  c.uploadResult,
);
router.delete(
  "/support-requests/:id/result-attachments/:attachmentId",
  ...hr,
  c.removeResultAttachment,
);
module.exports = router;
