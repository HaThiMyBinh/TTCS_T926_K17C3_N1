const express = require("express");
const { requireRole } = require("../auth");
const controller = require("../controllers/applications.controller");
const documentsController = require("../controllers/documents.controller");
const { handleMulterUpload } = require("../middleware/upload");

const router = express.Router();

// Tài liệu của Intern
router.post(
  "/me/documents",
  requireRole("Intern"),
  handleMulterUpload,
  documentsController.uploadMyDocument,
);

router.get(
  "/me/documents",
  requireRole("Intern"),
  documentsController.getMyDocuments,
);

router.delete(
  "/me/documents/:docId",
  requireRole("Intern"),
  documentsController.deleteMyDocument,
);

// Duyệt / từ chối hồ sơ
router.get("/", requireRole("Admin", "HR"), controller.list);
router.patch("/:id/status", requireRole("HR"), controller.updateStatus);

// HR xem danh sách tài liệu + tiến độ x/2 (đặt sau /me/documents để "me" không bị coi là :id)
router.get(
  "/:id/documents",
  requireRole("HR"),
  documentsController.listApplicationDocuments,
);

// Tải xuống tài liệu: chủ hồ sơ hoặc HR
router.get(
  "/:id/documents/:docId/download",
  requireRole("HR", "Intern"),
  documentsController.downloadDocument,
);

module.exports = router;
