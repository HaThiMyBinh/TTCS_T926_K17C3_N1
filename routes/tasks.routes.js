const express = require("express");
const { requireRole } = require("../auth");
const { checkPermission } = require("../middleware/permissions");
const controller = require("../controllers/tasks.controller");

const router = express.Router();

// Mentor giao và quản lý nhiệm vụ; quyền ASSIGN_TASKS vẫn do Admin cấu hình
// được.
const mentorOnly = [requireRole("Mentor"), checkPermission("ASSIGN_TASKS")];

router.get("/tasks", ...mentorOnly, controller.listTasks);
router.post("/tasks", ...mentorOnly, controller.createTask);
router.patch("/tasks/:id", ...mentorOnly, controller.updateTask);
router.delete("/tasks/:id", ...mentorOnly, controller.deleteTask);

// Thực tập sinh xem nhiệm vụ được giao cho mình (chỉ đọc).
router.get("/me/tasks", requireRole("Intern"), controller.getMyTasks);

module.exports = router;
