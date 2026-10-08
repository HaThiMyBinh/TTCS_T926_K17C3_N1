const express = require("express");
const { requireRole } = require("../auth");
const { checkPermission } = require("../middleware/permissions");
const controller = require("../controllers/tasks.controller");
const { handleMulterUpload } = require("../middleware/upload");

const router = express.Router();

// Mentor giao và quản lý nhiệm vụ; quyền ASSIGN_TASKS vẫn do Admin cấu hình
// được.
const mentorOnly = [requireRole("Mentor"), checkPermission("ASSIGN_TASKS")];

router.get("/tasks", ...mentorOnly, controller.listTasks);
router.post("/tasks", ...mentorOnly, controller.createTask);
router.patch("/tasks/:id", ...mentorOnly, controller.updateTask);
router.delete("/tasks/:id", ...mentorOnly, controller.deleteTask);

// Thực tập sinh xem nhiệm vụ được giao cho mình.
router.get("/me/tasks", requireRole("Intern"), controller.getMyTasks);

// Thực tập sinh cập nhật tiến độ việc của mình để mentor theo dõi (US12).
router.patch(
  "/me/tasks/:id/progress",
  requireRole("Intern"),
  controller.updateMyTaskProgress,
);

// Tệp đính kèm của cập nhật tiến độ: Intern tải lên/xóa file của mình.
router.post(
  "/me/tasks/:id/attachments",
  requireRole("Intern"),
  handleMulterUpload,
  controller.uploadMyTaskAttachment,
);
router.delete(
  "/me/tasks/:id/attachments/:attachmentId",
  requireRole("Intern"),
  controller.deleteMyTaskAttachment,
);

// Tải file: Intern chủ nhiệm vụ hoặc Mentor phụ trách (Mentor vẫn cần quyền ASSIGN_TASKS).
router.get(
  "/tasks/:id/attachments/:attachmentId/download",
  requireRole("Mentor", "Intern"),
  (req, res, next) =>
    req.user.role === "Mentor"
      ? checkPermission("ASSIGN_TASKS")(req, res, next)
      : next(),
  controller.downloadTaskAttachment,
);

module.exports = router;
