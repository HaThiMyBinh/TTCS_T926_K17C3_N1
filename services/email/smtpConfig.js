// Đọc/ghi cấu hình SMTP trong backend/mail_config.json (đã .gitignore).
// Các module khác phải đọc/ghi cấu hình qua file này.
const fs = require("fs");
const path = require("path");

const CONFIG_FILE = path.join(__dirname, "..", "..", "mail_config.json");

// secure=false + port 587: STARTTLS; secure=true + port 465: SSL/TLS
const DEFAULT_CONFIG = {
  host: "",
  port: 587,
  secure: false,
  user: "",
  pass: "",
  fromName: "Hệ thống Quản lý Thực tập sinh",
  fromEmail: "",
};

// Các trường bắt buộc để coi là đã cấu hình xong
const REQUIRED_FIELDS = ["host", "port", "user", "pass"];

function readConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch (err) {
    console.warn(
      `[EMAIL] Không đọc được ${CONFIG_FILE} (JSON không hợp lệ?), dùng cấu hình rỗng.`,
    );
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(partial) {
  const current = readConfig();
  const merged = { ...current, ...partial };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

function isConfigured(config) {
  return REQUIRED_FIELDS.every(
    (field) => config && String(config[field] ?? "").trim() !== "",
  );
}

// Dạng trả về cho giao diện: không chứa mật khẩu, chỉ có cờ hasPassword
function toPublicView(config) {
  return {
    host: config.host || "",
    port: Number(config.port) || 587,
    secure: !!config.secure,
    user: config.user || "",
    fromName: config.fromName || "",
    fromEmail: config.fromEmail || "",
    hasPassword: !!(config.pass && String(config.pass).trim() !== ""),
    configured: isConfigured(config),
  };
}

module.exports = {
  CONFIG_FILE,
  readConfig,
  writeConfig,
  isConfigured,
  toPublicView,
};
