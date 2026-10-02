const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const SALT_ROUNDS = 10;

const JWT_SECRET =
  process.env.JWT_SECRET || "dev-only-insecure-secret-change-me";
if (!process.env.JWT_SECRET) {
  console.warn(
    "[AUTH] CẢNH BÁO: Chưa cấu hình biến môi trường JWT_SECRET, đang dùng khóa mặc định " +
      "CHỈ PHÙ HỢP CHO MÔI TRƯỜNG DEV/DEMO. Vui lòng đặt JWT_SECRET thật khi triển khai thật.",
  );
}

const TOKEN_EXPIRES_IN = "8h";

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

function isLegacySha256Hash(hash) {
  return typeof hash === "string" && /^[a-f0-9]{64}$/i.test(hash);
}

async function verifyPassword(plainPassword, storedHash) {
  if (isLegacySha256Hash(storedHash)) {
    const legacyHash = crypto
      .createHash("sha256")
      .update(plainPassword)
      .digest("hex");
    const a = Buffer.from(legacyHash.toLowerCase());
    const b = Buffer.from(storedHash.toLowerCase());
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return bcrypt.compare(plainPassword, storedHash);
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRES_IN },
  );
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    const message =
      "Chưa đăng nhập hoặc thiếu token xác thực (Authorization: Bearer <token>)!";
    return res.status(401).json({ success: false, message, error: message });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    const message = "Token không hợp lệ hoặc đã hết hạn!";
    return res.status(401).json({ success: false, message, error: message });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      const message = "Chưa xác thực người dùng!";
      return res.status(401).json({ success: false, message, error: message });
    }
    if (!allowedRoles.includes(req.user.role)) {
      const message = `Từ chối truy cập: Vai trò [${req.user.role}] không đủ quyền cho thao tác này!`;
      return res.status(403).json({
        success: false,
        message,
        error: message,
        requiredRoles: allowedRoles,
      });
    }
    next();
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  authenticateToken,
  requireRole,
};
