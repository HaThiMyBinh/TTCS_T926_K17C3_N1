// Lưu/xóa file tài liệu trong backend/uploads
// Tên file trên đĩa là UUID do server sinh; đường dẫn luôn bị ép nằm trong UPLOADS_DIR
// Thư mục này không phục vụ tĩnh, file chỉ ra ngoài qua API download có phân quyền
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { HttpError } = require("../errors");

const UPLOADS_DIR = path.resolve(__dirname, "..", "uploads");
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ensureUploadsDir() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function generateStoredName() {
  return crypto.randomUUID();
}

// stored_name -> đường dẫn tuyệt đối; ném lỗi nếu không phải UUID hoặc thoát khỏi UPLOADS_DIR
function resolveStoredPath(storedName) {
  if (typeof storedName !== "string" || !UUID_V4_REGEX.test(storedName)) {
    throw new HttpError(400, "Tên file lưu trữ không hợp lệ!");
  }
  const fullPath = path.resolve(UPLOADS_DIR, storedName);
  if (path.dirname(fullPath) !== UPLOADS_DIR) {
    throw new HttpError(400, "Đường dẫn file lưu trữ không hợp lệ!");
  }
  return fullPath;
}

// Ghi buffer với tên UUID mới (cờ "wx": không ghi đè); trả về storedName
function saveBuffer(buffer) {
  ensureUploadsDir();
  const storedName = generateStoredName();
  const fullPath = resolveStoredPath(storedName);
  try {
    fs.writeFileSync(fullPath, buffer, { flag: "wx", mode: 0o600 });
  } catch (err) {
    try {
      fs.unlinkSync(fullPath);
    } catch (e) {}
    console.error("[FILE STORAGE] Lỗi ghi file:", err.message);
    throw new HttpError(
      500,
      "Không thể lưu file lên máy chủ, vui lòng thử lại!",
    );
  }
  return storedName;
}

// Xóa file, không ném lỗi; trả về true nếu đã xóa
function removeFile(storedName) {
  if (!storedName) return false;
  try {
    fs.unlinkSync(resolveStoredPath(storedName));
    return true;
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn("[FILE STORAGE] Không thể xóa file:", err.message);
    }
    return false;
  }
}

function fileExists(storedName) {
  try {
    return fs.existsSync(resolveStoredPath(storedName));
  } catch (e) {
    return false;
  }
}

ensureUploadsDir();

module.exports = {
  UPLOADS_DIR,
  generateStoredName,
  resolveStoredPath,
  saveBuffer,
  removeFile,
  fileExists,
};
