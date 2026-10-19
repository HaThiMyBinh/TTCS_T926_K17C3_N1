// Bộ guard phân quyền dùng chung cho các file route (trước đây mỗi route tự khai báo lại).
const { requireRole } = require("../auth");
const { checkPermission } = require("./permissions");

const VALID_ROLES = ["Admin", "HR", "Mentor", "Intern"];

// Thực tập sinh; quyền SUBMIT_WORK do Admin cấu hình trong ma trận phân quyền.
const internOnly = [requireRole("Intern"), checkPermission("SUBMIT_WORK")];
// HR; cần quyền VIEW_REPORTS do Admin cấu hình.
const hrReport = [requireRole("HR"), checkPermission("VIEW_REPORTS")];

module.exports = { VALID_ROLES, internOnly, hrReport };
