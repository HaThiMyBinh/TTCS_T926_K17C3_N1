const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const BASE_URL = "http://127.0.0.1:5000/api";

// Tài khoản mẫu do db.js seed (mật khẩu password123)
const DEMO_ACCOUNTS = {
  Admin: "admin@gmail.com",
  HR: "hr@company.com",
  Mentor: "mentor@gmail.com",
  Intern: "intern@gmail.com",
};

// Cấu hình MySQL giống db.js (biến môi trường ghi đè db_config.json)
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

// Xóa các bản ghi có đúng email mà test đã tạo (xóa thẳng trong MySQL vì DELETE /api/users/:id
// để lại candidate_profiles mồ côi chiếm email). Trả về số bản ghi đã xóa.
async function cleanupTestData(emails) {
  const list = [
    ...new Set(emails.filter(Boolean).map((e) => String(e).toLowerCase())),
  ];
  if (list.length === 0) return 0;

  const conn = await mysql.createConnection(readDbConfig());
  try {
    let total = 0;
    // email_logs chỉ bị SET NULL khi xóa hồ sơ nên phải xóa theo recipient_email, trước các bảng khác
    const [logResult] = await conn.query(
      "DELETE FROM `email_logs` WHERE LOWER(recipient_email) IN (?)",
      [list],
    );
    total += logResult.affectedRows;

    // Xóa file trên đĩa và application_documents trước candidate_profiles
    try {
      const [docs] = await conn.query(
        `SELECT d.stored_name FROM application_documents d
         JOIN candidate_profiles c ON d.application_id = c.id
         WHERE LOWER(c.email) IN (?)`,
        [list],
      );
      const uploadsDir = path.join(__dirname, "..", "uploads");
      for (const d of docs) {
        if (d.stored_name) {
          const f = path.join(uploadsDir, d.stored_name);
          if (fs.existsSync(f)) {
            try { fs.unlinkSync(f); } catch { /* best-effort cleanup */ }
          }
        }
      }
      const [docResult] = await conn.query(
        `DELETE d FROM application_documents d
         JOIN candidate_profiles c ON d.application_id = c.id
         WHERE LOWER(c.email) IN (?)`,
        [list],
      );
      total += docResult.affectedRows;
    } catch (e) {
      // Bảng application_documents có thể chưa tồn tại
    }

    // users xóa cuối vì các bảng kia tham chiếu tới nó
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

// Xóa dữ liệu test còn sót (ví dụ test bị Ctrl+C): mọi bản ghi có email bắt đầu bằng một trong các tiền tố
async function cleanupByPattern(prefixes) {
  const list = [...new Set((prefixes || []).filter(Boolean))];
  if (list.length === 0) return 0;

  const conn = await mysql.createConnection(readDbConfig());
  try {
    let total = 0;
    for (const prefix of list) {
      const [logResult] = await conn.query(
        "DELETE FROM `email_logs` WHERE LOWER(recipient_email) LIKE ?",
        [`${prefix.toLowerCase()}%`],
      );
      total += logResult.affectedRows;
    }

    try {
      for (const prefix of list) {
        const [docs] = await conn.query(
          `SELECT d.stored_name FROM application_documents d
           JOIN candidate_profiles c ON d.application_id = c.id
           WHERE LOWER(c.email) LIKE ?`,
          [`${prefix.toLowerCase()}%`],
        );
        const uploadsDir = path.join(__dirname, "..", "uploads");
        for (const d of docs) {
          if (d.stored_name) {
            const f = path.join(uploadsDir, d.stored_name);
            if (fs.existsSync(f)) {
              try { fs.unlinkSync(f); } catch { /* best-effort cleanup */ }
            }
          }
        }
        const [docResult] = await conn.query(
          `DELETE d FROM application_documents d
           JOIN candidate_profiles c ON d.application_id = c.id
           WHERE LOWER(c.email) LIKE ?`,
          [`${prefix.toLowerCase()}%`],
        );
        total += docResult.affectedRows;
      }
    } catch { /* best-effort cleanup */ }

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


// Gắn đủ CV + Đơn xin thực tập (bản ghi giả, không có file thật) để test duyệt hồ sơ (US10 yêu cầu 2/2).
// Dữ liệu tự bị xóa theo hồ sơ khi cleanupTestData / ON DELETE CASCADE.
async function seedFullDocuments(applicationId) {
  const conn = await mysql.createConnection(readDbConfig());
  try {
    for (const [type, name] of [["CV", "cv_test.pdf"], ["APPLICATION_LETTER", "don_test.pdf"]]) {
      await conn.query(
        `INSERT INTO application_documents
           (application_id, doc_type, original_name, stored_name, mime_type, size_bytes)
         VALUES (?, ?, ?, ?, 'application/pdf', 100)
         ON DUPLICATE KEY UPDATE original_name = VALUES(original_name)`,
        [applicationId, type, name, crypto.randomUUID()],
      );
    }
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

// Headers kèm Bearer token của một vai trò
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
  seedFullDocuments,
};
