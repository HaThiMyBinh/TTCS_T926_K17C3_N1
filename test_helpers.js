const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const BASE_URL = "http://127.0.0.1:5000/api";

// Tài khoản mẫu mặc định do backend/db.js tự seed lúc khởi động (mật khẩu password123)
const DEMO_ACCOUNTS = {
  Admin: "admin@gmail.com",
  HR: "hr@company.com",
  Mentor: "mentor@gmail.com",
  Intern: "intern@gmail.com",
};

// Đọc cấu hình MySQL giống backend/db.js (db_config.json, biến môi trường ghi đè)
function readDbConfig() {
  const file = path.join(__dirname, "..", "db_config.json");
  const cfg = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf-8"))
    : {};
  return {
    host: process.env.DB_HOST || cfg.host || "localhost",
    port: Number(process.env.DB_PORT) || cfg.port || 3306,
    user: process.env.DB_USER || cfg.user || "root",
    password: process.env.DB_PASSWORD ?? cfg.password ?? "",
    database: process.env.DB_NAME || cfg.database || "user_management",
  };
}

// Dọn dữ liệu test: chỉ xóa các bản ghi có ĐÚNG email mà test đã tạo.
// Xóa trực tiếp trong MySQL vì DELETE /api/users/:id không xóa candidate_profiles
// (khóa ngoại ON DELETE SET NULL sẽ để lại hồ sơ mồ côi chiếm email).
// Trả về số bản ghi đã xóa.
async function cleanupTestData(emails) {
  const list = [
    ...new Set(emails.filter(Boolean).map((e) => String(e).toLowerCase())),
  ];
  if (list.length === 0) return 0;

  const conn = await mysql.createConnection(readDbConfig());
  try {
    let total = 0;
    // US8: email_logs tham chiếu candidate_profiles bằng ON DELETE SET NULL -> xóa hồ sơ
    // KHÔNG xóa log (log chỉ bị đổi application_id thành NULL và vẫn hiện trên giao diện).
    // Vì vậy phải xóa log theo recipient_email, và làm TRƯỚC các bảng còn lại.
    const [logResult] = await conn.query(
      "DELETE FROM `email_logs` WHERE LOWER(recipient_email) IN (?)",
      [list],
    );
    total += logResult.affectedRows;

    // users để cuối cùng vì các bảng kia có thể tham chiếu tới nó
    for (const table of [
      "candidate_profiles",
      "intern_profiles",
      "mentors",
      "users",
    ]) {
      const [result] = await conn.query(
        `DELETE FROM \`${table}\` WHERE LOWER(email) IN (?)`,
        [list],
      );
      total += result.affectedRows;
    }
    return total;
  } finally {
    await conn.end();
  }
}

// Dọn dữ liệu test CÒN SÓT từ các lần chạy trước (ví dụ test bị Ctrl+C giữa chừng,
// hoặc một bug khiến email không kịp ghi vào danh sách cleanupTestData ở trên).
// Khác cleanupTestData(emails cụ thể): hàm này xóa MỌI bản ghi có email BẮT ĐẦU BẰNG
// 1 trong các tiền tố cho trước, dùng cho tests/cleanup_test_data.js (công cụ dọn tay).
async function cleanupByPattern(prefixes) {
  const list = [...new Set((prefixes || []).filter(Boolean))];
  if (list.length === 0) return 0;

  const conn = await mysql.createConnection(readDbConfig());
  try {
    let total = 0;
    // US8: dọn cả nhật ký email của các ứng viên test (xem giải thích ở cleanupTestData)
    for (const prefix of list) {
      const [logResult] = await conn.query(
        "DELETE FROM `email_logs` WHERE LOWER(recipient_email) LIKE ?",
        [`${prefix.toLowerCase()}%`],
      );
      total += logResult.affectedRows;
    }
    for (const table of [
      "candidate_profiles",
      "intern_profiles",
      "mentors",
      "users",
    ]) {
      for (const prefix of list) {
        const [result] = await conn.query(
          `DELETE FROM \`${table}\` WHERE LOWER(email) LIKE ?`,
          [`${prefix.toLowerCase()}%`],
        );
        total += result.affectedRows;
      }
    }
    return total;
  } finally {
    await conn.end();
  }
}

async function loginAs(role, password = "password123") {
  const account = DEMO_ACCOUNTS[role];
  if (!account) {
    throw new Error(`Không có tài khoản mẫu cho vai trò: ${role}`);
  }

  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account, password }),
  });

  const data = await res.json();
  if (res.status !== 200 || !data.token) {
    throw new Error(
      `Đăng nhập thất bại cho vai trò ${role}: ${JSON.stringify(data)}`,
    );
  }
  return data.token;
}

// Trả về headers có kèm Authorization Bearer token cho một vai trò cụ thể.
async function authHeadersFor(role, extra = {}) {
  const token = await loginAs(role);
  return { Authorization: `Bearer ${token}`, ...extra };
}

module.exports = {
  BASE_URL,
  DEMO_ACCOUNTS,
  loginAs,
  authHeadersFor,
  cleanupTestData,
  cleanupByPattern,
  readDbConfig,
};
