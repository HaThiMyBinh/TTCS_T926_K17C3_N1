// services/email/smtpConfig.js - Đọc/ghi cấu hình SMTP (US8)
//
// Cấu hình được lưu trong backend/mail_config.json (giống cách backend/permissions.json
// và backend/db_config.json hoạt động) - KHÔNG lưu trong MySQL, không commit lên Git
// (xem backend/.gitignore). File này là nơi DUY NHẤT được phép đọc/ghi mail_config.json;
// mọi module khác (controller, emailQueue...) đều phải đi qua đây, không tự ý fs.readFile.
const fs = require("fs");
const path = require("path");

const CONFIG_FILE = path.join(__dirname, "..", "..", "mail_config.json");

// secure=false + port 587: STARTTLS (nodemailer tự nâng cấp kết nối) - khuyến nghị dùng với Gmail.
// secure=true + port 465: SSL/TLS ngay từ đầu.
const DEFAULT_CONFIG = {
  host: "",
  port: 587,
  secure: false,
  user: "",
  pass: "",
  fromName: "Hệ thống Quản lý Thực tập sinh",
  fromEmail: "",
};

// 4 trường bắt buộc để coi là "đã cấu hình xong", đủ để thử kết nối SMTP thật
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

// Dạng rút gọn trả về cho giao diện - KHÔNG bao giờ chứa mật khẩu thật.
// hasPassword chỉ báo "có/chưa có" để frontend biết hiển thị placeholder phù hợp,
// tuyệt đối không phải một phiên bản che một phần của mật khẩu.
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
