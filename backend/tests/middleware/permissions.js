const fs = require("fs");
const path = require("path");

const PERMISSIONS_FILE = path.join(__dirname, "..", "permissions.json");

function readJson(filePath, defaultVal = []) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    return defaultVal;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function ensurePermissionsFile() {
  if (fs.existsSync(PERMISSIONS_FILE)) return;

  const defaultPermissions = {
    Admin: ["MANAGE_USERS", "SYSTEM_SETTINGS"],
    HR: ["VIEW_REPORTS"],
    Mentor: ["ASSIGN_TASKS"],
    Intern: ["SUBMIT_WORK"],
  };

  writeJson(PERMISSIONS_FILE, defaultPermissions);
}

function checkPermission(requiredPermission) {
  return (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ error: "Chưa xác thực (thiếu hoặc sai token đăng nhập)!" });
    }

    const userRole = req.user.role;
    const permissions = readJson(PERMISSIONS_FILE, {});
    const rolePermissions = permissions[userRole] || [];

    if (!rolePermissions.includes(requiredPermission)) {
      return res.status(403).json({
        error: `Từ chối truy cập: Vai trò [${userRole}] không có quyền [${requiredPermission}]!`,
        requiredPermission,
        userRole,
      });
    }

    next();
  };
}

module.exports = {
  PERMISSIONS_FILE,
  readJson,
  writeJson,
  ensurePermissionsFile,
  checkPermission,
};
