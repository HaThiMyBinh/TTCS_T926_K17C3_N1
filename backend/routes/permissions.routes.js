const express = require("express");
const { requireRole } = require("../auth");
const { VALID_ROLES } = require("../middleware/guards");
const {
  PERMISSIONS_FILE,
  readJson,
  writeJson,
} = require("../middleware/permissions");
const { HttpError, sendRouteError } = require("../errors");

const router = express.Router();
const VALID_PERMISSIONS = [
  "MANAGE_USERS",
  "ASSIGN_TASKS",
  "SUBMIT_WORK",
  "VIEW_REPORTS",
  "SYSTEM_SETTINGS",
];
router.get("/permissions", (req, res) => {
  try {
    const permissions = readJson(PERMISSIONS_FILE, {});
    if (!permissions.HR) permissions.HR = ["VIEW_REPORTS"];
    if (!permissions.Mentor) permissions.Mentor = ["ASSIGN_TASKS"];
    if (!permissions.Intern) permissions.Intern = ["SUBMIT_WORK"];
    res.json(permissions);
  } catch (err) {
    return sendRouteError(res, err, "Lỗi đọc ma trận quyền!");
  }
});

router.post("/permissions/update", requireRole("Admin"), (req, res) => {
  try {
    const { role, permissions } = req.body;
    if (!role || !Array.isArray(permissions)) {
      return sendRouteError(
        res,
        new HttpError(400, "Dữ liệu cập nhật quyền không hợp lệ!"),
      );
    }
    if (
      !VALID_ROLES.includes(role) ||
      !permissions.every((p) => VALID_PERMISSIONS.includes(p))
    ) {
      return sendRouteError(
        res,
        new HttpError(400, "Vai trò hoặc mã quyền không hợp lệ!"),
      );
    }

    const allPermissions = readJson(PERMISSIONS_FILE, {});
    allPermissions[role] = permissions;
    writeJson(PERMISSIONS_FILE, allPermissions);

    res.json({
      message: `Cập nhật quyền cho vai trò [${role}] thành công!`,
      permissions: allPermissions,
    });
  } catch (err) {
    return sendRouteError(res, err, "Lỗi lưu cấu hình quyền!");
  }
});

module.exports = router;
