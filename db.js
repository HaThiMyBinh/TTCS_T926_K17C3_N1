// db.js - Quản lý kết nối & truy vấn Database MySQL (nguồn dữ liệu DUY NHẤT)
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const { hashPassword } = require("./auth");
const fileStorage = require("./services/fileStorage");

const CONFIG_FILE = path.join(__dirname, "db_config.json");

let config = {
  host: "localhost",
  port: 3306,
  user: "root",
  password: "",
  database: "user_management",
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    config = {
      ...config,
      ...JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")),
    };
  } catch (e) {
    console.warn(
      `[DATABASE] Không đọc được ${CONFIG_FILE}, dùng cấu hình mặc định.`,
    );
  }
}

// Cảnh báo nếu mật khẩu MySQL vẫn còn là giá trị mẫu (chưa được thay bằng
// mật khẩu thật) - tránh trường hợp deploy nhầm với cấu hình demo.
if (config.password === "your_password_here" && !process.env.DB_PASSWORD) {
  console.warn(
    "[DATABASE] CẢNH BÁO: backend/db_config.json vẫn đang dùng mật khẩu mẫu " +
      "'your_password_here'. Vui lòng cập nhật mật khẩu MySQL thật của bạn " +
      "(hoặc dùng biến môi trường DB_PASSWORD) trước khi triển khai.",
  );
}

// Biến môi trường (nếu có) sẽ ghi đè db_config.json
config = {
  host: process.env.DB_HOST || config.host,
  port: Number(process.env.DB_PORT) || config.port,
  user: process.env.DB_USER || config.user,
  password: process.env.DB_PASSWORD ?? config.password,
  database: process.env.DB_NAME || config.database,
};

let pool = null;
let isMysqlConnected = false;

function requireDb() {
  if (!isMysqlConnected || !pool) {
    throw new Error(
      "MySQL chưa sẵn sàng. Vui lòng kiểm tra cấu hình db_config.json và đảm bảo MySQL Server đang chạy.",
    );
  }
  return pool;
}

// Cho phép script xuất demo dùng pool hiện tại sau khi initDatabase() hoàn tất.
function getPool() {
  return requireDb();
}

function nowISO() {
  return new Date().toISOString();
}

// Phòng ban mặc định khi hồ sơ mentor được tạo tự động từ một tài khoản Mentor
const DEFAULT_MENTOR_DEPARTMENT = "Chưa cập nhật";
// Trường/trạng thái mặc định khi hồ sơ thực tập sinh được tạo tự động từ tài khoản Intern
const DEFAULT_INTERN_UNIVERSITY = "Chưa cập nhật";
const DEFAULT_INTERN_STATUS = "Đang thực tập";
// Tài khoản Intern đang là ứng viên chờ duyệt / bị từ chối chưa phải thực tập sinh chính thức
const NON_INTERN_ACCOUNT_STATUSES = ["PENDING", "LOCKED"];
const NON_INTERN_ACCOUNT_STATUSES_SQL = NON_INTERN_ACCOUNT_STATUSES
  .map((status) => `'${status}'`)
  .join(", ");
// Mật khẩu mặc định của tài khoản được tạo tự động từ hồ sơ mentor / thực tập sinh
const DEFAULT_ACCOUNT_PASSWORD = "password123";

// Lỗi nghiệp vụ; mặc định 400, có thể dùng status khác cho xung đột trạng thái.
class ConflictError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Chạy nhiều câu lệnh trong 1 transaction để 2 bảng users & mentors luôn khớp nhau
async function withTransaction(work) {
  const conn = await requireDb().getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Tra cứu role_id từ tên vai trò (Admin/HR/Mentor/Intern) trong bảng roles
async function getRoleId(roleName) {
  const db = requireDb();
  const [rows] = await db.query(
    "SELECT id FROM roles WHERE role_name = ? LIMIT 1",
    [roleName],
  );
  if (rows.length === 0) {
    throw new Error(
      `Vai trò không hợp lệ: '${roleName}' không tồn tại trong bảng roles.`,
    );
  }
  return rows[0].id;
}

// Thêm cột nếu chưa có (MySQL không hỗ trợ ADD COLUMN IF NOT EXISTS ở mọi phiên bản)
async function ensureColumn(table, column, definition) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [config.database, table, column],
  );
  if (rows.length === 0) {
    await pool.query(
      `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`,
    );
  }
}

async function ensureForeignKey(table, constraintName, definition) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?
       AND CONSTRAINT_TYPE = 'FOREIGN KEY' LIMIT 1`,
    [config.database, table, constraintName],
  );
  if (rows.length === 0) {
    await pool.query(
      `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${constraintName}\` ${definition}`,
    );
  }
}

// Đổi tên index FK MySQL tự sinh để database cũ dùng chung tên khai báo trong schema.sql.
async function ensureIndex(table, indexName, columnName) {
  const [namedIndexes] = await pool.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [config.database, table, indexName],
  );
  if (namedIndexes.length > 0) return;

  const [supportingIndexes] = await pool.query(
    `SELECT INDEX_NAME AS indexName
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME <> 'PRIMARY'
     GROUP BY INDEX_NAME
     HAVING COUNT(*) = 1 AND SUM(CASE WHEN SEQ_IN_INDEX = 1 AND COLUMN_NAME = ? THEN 1 ELSE 0 END) = 1
     LIMIT 1`,
    [config.database, table, columnName],
  );
  const existingName = supportingIndexes[0]?.indexName;
  if (existingName) {
    const safeOldName = String(existingName).replace(/`/g, "``");
    await pool.query(
      `ALTER TABLE \`${table}\` RENAME INDEX \`${safeOldName}\` TO \`${indexName}\``,
    );
    return;
  }

  await pool.query(
    `ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` (\`${columnName}\`)`,
  );
}

// Khởi tạo kết nối MySQL, tạo bảng & seed dữ liệu mặc định nếu chưa có
async function initDatabase() {
  // 1. Kết nối không chọn DB để tạo DB nếu chưa tồn tại
  const rootConn = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
  });

  await rootConn.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
  );
  await rootConn.end();

  // Tạo Pool kết nối tới database chính
  pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    dateStrings: ["DATE"],
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  // Tạo các bảng đúng theo thiết kế quan hệ trong schema.sql
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`roles\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`role_name\` VARCHAR(50) NOT NULL UNIQUE,
      \`description\` VARCHAR(255) NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`permissions\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`perm_code\` VARCHAR(50) NOT NULL UNIQUE,
      \`perm_name\` VARCHAR(100) NOT NULL,
      \`description\` VARCHAR(255) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`role_permissions\` (
      \`role_id\` INT NOT NULL,
      \`permission_id\` INT NOT NULL,
      PRIMARY KEY (\`role_id\`, \`permission_id\`),
      FOREIGN KEY (\`role_id\`) REFERENCES \`roles\`(\`id\`) ON DELETE CASCADE,
      FOREIGN KEY (\`permission_id\`) REFERENCES \`permissions\`(\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // users.role_id -> roles.id
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`users\` (
      \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
      \`name\` VARCHAR(100) NOT NULL,
      \`email\` VARCHAR(150) NOT NULL UNIQUE,
      \`password_hash\` VARCHAR(255) NOT NULL,
      \`role_id\` INT NOT NULL,
      \`phone\` VARCHAR(20) NULL,
      \`status\` ENUM('ACTIVE', 'INACTIVE', 'LOCKED', 'PENDING') DEFAULT 'ACTIVE',
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (\`role_id\`) REFERENCES \`roles\`(\`id\`) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`candidate_profiles\` (
      \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
      \`user_id\` BIGINT NULL,
      \`full_name\` VARCHAR(100) NOT NULL,
      \`email\` VARCHAR(150) NOT NULL UNIQUE,
      \`phone\` VARCHAR(20) NOT NULL,
      \`university\` VARCHAR(150) NOT NULL,
      \`major\` VARCHAR(100) NULL,
      \`cv_link\` VARCHAR(255) NULL,
      \`password_hash\` VARCHAR(255) NOT NULL,
      \`status\` ENUM('Chờ duyệt', 'Đã duyệt', 'Từ chối') DEFAULT 'Chờ duyệt',
      \`applied_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`mentors\` (
      \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
      \`full_name\` VARCHAR(100) NOT NULL,
      \`email\` VARCHAR(150) NOT NULL UNIQUE,
      \`phone\` VARCHAR(20) NULL,
      \`department\` VARCHAR(150) NULL,
      \`specialization\` VARCHAR(150) NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`intern_profiles\` (
      \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
      \`student_code\` VARCHAR(30) NULL,
      \`full_name\` VARCHAR(100) NOT NULL,
      \`email\` VARCHAR(150) NOT NULL UNIQUE,
      \`phone\` VARCHAR(20) NULL,
      \`university\` VARCHAR(150) NULL,
      \`major\` VARCHAR(100) NULL,
      \`mentor_name\` VARCHAR(100) NULL,
      \`status\` VARCHAR(50) DEFAULT 'Đang thực tập',
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // cột phục vụ duyệt / từ chối hồ sơ
  await ensureColumn("candidate_profiles", "rejection_reason", "TEXT NULL");
  await ensureColumn("candidate_profiles", "reviewed_by", "BIGINT NULL");
  await ensureColumn("candidate_profiles", "reviewed_at", "DATETIME NULL");

  // bảng nhật ký gửi email thông báo kết quả xét duyệt
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`email_logs\` (
      \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
      \`application_id\` BIGINT NULL,
      \`recipient_email\` VARCHAR(150) NOT NULL,
      \`recipient_name\` VARCHAR(100) NULL,
      \`email_type\` ENUM('APPROVED', 'REJECTED') NOT NULL,
      \`subject\` VARCHAR(255) NOT NULL,
      \`status\` ENUM('PENDING', 'RETRYING', 'SENT', 'FAILED') NOT NULL DEFAULT 'PENDING',
      \`attempts\` INT NOT NULL DEFAULT 0,
      \`error_message\` TEXT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`sent_at\` DATETIME NULL,
      FOREIGN KEY (\`application_id\`) REFERENCES \`candidate_profiles\`(\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // bảng tài liệu hồ sơ ứng tuyển (CV & Đơn xin thực tập)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`application_documents\` (
      \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
      \`application_id\` BIGINT NOT NULL,
      \`doc_type\` ENUM('CV', 'APPLICATION_LETTER') NOT NULL,
      \`original_name\` VARCHAR(255) NOT NULL,
      \`stored_name\` VARCHAR(255) NOT NULL,
      \`mime_type\` VARCHAR(100) NOT NULL,
      \`size_bytes\` BIGINT NOT NULL,
      \`uploaded_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY \`uq_application_doc_type\` (\`application_id\`, \`doc_type\`),
      FOREIGN KEY (\`application_id\`) REFERENCES \`candidate_profiles\`(\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Hợp đồng thực tập sinh chính thức, tách biệt tài liệu ứng tuyển
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`internship_contracts\` (
      \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
      \`intern_id\` BIGINT NOT NULL, \`title\` VARCHAR(255) NULL,
      \`start_date\` DATE NULL, \`end_date\` DATE NULL, \`note\` TEXT NULL,
      \`original_name\` VARCHAR(255) NOT NULL, \`stored_name\` VARCHAR(255) NOT NULL,
      \`mime_type\` VARCHAR(100) NOT NULL, \`size_bytes\` BIGINT NOT NULL,
      \`uploaded_by\` BIGINT NULL, \`uploaded_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`confirmation_status\` ENUM('PENDING', 'CONFIRMED') NOT NULL DEFAULT 'PENDING',
      \`confirmed_at\` DATETIME NULL, \`confirmed_by\` BIGINT NULL,
      FOREIGN KEY (\`intern_id\`) REFERENCES \`intern_profiles\`(\`id\`) ON DELETE CASCADE,
      FOREIGN KEY (\`uploaded_by\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL,
      CONSTRAINT \`fk_contract_confirmed_by\` FOREIGN KEY (\`confirmed_by\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL,
      INDEX \`idx_contract_intern\` (\`intern_id\`),
      INDEX \`idx_contract_confirmed_by\` (\`confirmed_by\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  // CREATE TABLE khai báo đủ cột cho database mới; ensureColumn bổ sung chúng vào database cũ.
  // Hợp đồng cũ tự nhận PENDING, giữ nguyên dữ liệu và cho phép Intern xác nhận sau này.
  await ensureColumn(
    "internship_contracts",
    "confirmation_status",
    "ENUM('PENDING', 'CONFIRMED') NOT NULL DEFAULT 'PENDING'",
  );
  await ensureColumn("internship_contracts", "confirmed_at", "DATETIME NULL");
  await ensureColumn("internship_contracts", "confirmed_by", "BIGINT NULL");
  await ensureIndex("internship_contracts", "idx_contract_confirmed_by", "confirmed_by");
  await ensureForeignKey(
    "internship_contracts",
    "fk_contract_confirmed_by",
    "FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL",
  );

  // Seed dữ liệu mặc định: roles, permissions, role_permissions
  await pool.query(`
    INSERT IGNORE INTO roles (id, role_name, description) VALUES
    (1, 'Admin', 'Quản trị viên toàn quyền hệ thống'),
    (2, 'HR', 'Quản lý nhân sự & tuyển dụng thực tập sinh'),
    (3, 'Mentor', 'Người hướng dẫn thực tập sinh'),
    (4, 'Intern', 'Thực tập sinh tham gia chương trình');
  `);

  await pool.query(`
    INSERT IGNORE INTO permissions (id, perm_code, perm_name, description) VALUES
    (1, 'MANAGE_USERS', 'Quản lý tài khoản', 'Tạo, sửa, xóa tài khoản người dùng'),
    (2, 'ASSIGN_TASKS', 'Giao nhiệm vụ & Task', 'Phân công nhiệm vụ cho thực tập sinh'),
    (3, 'SUBMIT_WORK', 'Nộp báo cáo công việc', 'Thực tập sinh gửi báo cáo/tiến độ'),
    (4, 'VIEW_REPORTS', 'Xem báo cáo & Thống kê', 'Xem số liệu thống kê đào tạo'),
    (5, 'SYSTEM_SETTINGS', 'Cài đặt hệ thống', 'Cấu hình phân quyền và hệ thống');
  `);

  await pool.query(`
    INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES
    (1, 1), (1, 5),
    (2, 4),
    (3, 2);
  `);

  isMysqlConnected = true;
  console.log(
    `[DATABASE] Đã kết nối MySQL thành công tới database '${config.database}'!`,
  );

  // Seed tài khoản mẫu mặc định (mật khẩu: password123)
  await seedDefaultAccounts();
  await syncMentorsWithAccounts();
  await syncInternsWithAccounts();
}

async function seedDefaultAccounts() {
  if (process.env.NODE_ENV === "production") {
    console.log("[DATABASE] NODE_ENV=production: bỏ qua seed tài khoản mẫu.");
    return;
  }
  const defaultPassHash = await hashPassword("password123");
  const defaultAccounts = [
    { name: "Admin", email: "admin@gmail.com", role: "Admin" },
    { name: "Hr", email: "hr@company.com", role: "HR" },
    { name: "Mentor", email: "mentor@gmail.com", role: "Mentor" },
    { name: "Intern", email: "intern@gmail.com", role: "Intern" },
  ];

  for (const acc of defaultAccounts) {
    const existing = await findUserByEmail(acc.email);
    if (!existing) {
      await insertUser({
        name: acc.name,
        email: acc.email,
        password_hash: defaultPassHash,
        role: acc.role,
        status: "ACTIVE",
      });
    }
  }
}

async function findUserByEmail(email) {
  const db = requireDb();
  const [rows] = await db.query(
    `SELECT u.*, r.role_name AS role
     FROM users u
     JOIN roles r ON u.role_id = r.id
     WHERE LOWER(u.email) = LOWER(?) LIMIT 1`,
    [email],
  );
  return rows[0] || null;
}

// Tra cứu theo account, email hoặc id (dùng khi đăng nhập)
async function findUserForLogin(account) {
  const db = requireDb();
  const [rows] = await db.query(
    `SELECT u.*, r.role_name AS role
     FROM users u
     JOIN roles r ON u.role_id = r.id
     WHERE LOWER(u.email) = LOWER(?) OR LOWER(u.name) = LOWER(?) OR u.id = ?
     LIMIT 1`,
    [account, account, isNaN(Number(account)) ? 0 : Number(account)],
  );
  return rows[0] || null;
}

async function insertUser({
  name,
  email,
  password_hash,
  role,
  status = "ACTIVE",
}) {
  const roleId = await getRoleId(role);

  const insertId = await withTransaction(async (conn) => {
    const [result] = await conn.query(
      "INSERT INTO users (name, email, password_hash, role_id, status) VALUES (?, ?, ?, ?, ?)",
      [name, email, password_hash, roleId, status],
    );
    // Đồng bộ: tài khoản Mentor luôn có hồ sơ tương ứng trong bảng mentors
    if (role === "Mentor") {
      await conn.query(
        `INSERT INTO mentors (full_name, email, phone, department, specialization)
         VALUES (?, ?, '', ?, '')
         ON DUPLICATE KEY UPDATE id = id`,
        [name, email, DEFAULT_MENTOR_DEPARTMENT],
      );
    }
    // Đồng bộ: tài khoản Intern chính thức luôn có hồ sơ trong bảng intern_profiles
    if (role === "Intern" && !NON_INTERN_ACCOUNT_STATUSES.includes(status)) {
      await conn.query(
        `INSERT INTO intern_profiles
           (student_code, full_name, email, phone, university, major, mentor_name, status)
         VALUES ('', ?, ?, '', ?, '', '', ?)
         ON DUPLICATE KEY UPDATE id = id`,
        [name, email, DEFAULT_INTERN_UNIVERSITY, DEFAULT_INTERN_STATUS],
      );
    }
    return result.insertId;
  });

  return {
    id: insertId,
    name,
    email,
    password_hash,
    role,
    status,
    createdAt: nowISO(),
  };
}

async function getAllUsers() {
  const db = requireDb();
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.email, r.role_name AS role, u.status, u.phone,
            u.created_at AS createdAt
     FROM users u
     JOIN roles r ON u.role_id = r.id
     ORDER BY u.id DESC`,
  );
  return rows;
}

async function deleteUser(id) {
  const storedNames = await withTransaction(async (conn) => {
    const [users] = await conn.query(
      `SELECT u.email, r.role_name AS role
       FROM users u JOIN roles r ON u.role_id = r.id
       WHERE u.id = ?`,
      [id],
    );
    if (users.length === 0) return [];

    const user = users[0];
    let contracts = [];
    if (user.role === "Mentor") {
      await conn.query("DELETE FROM mentors WHERE LOWER(email) = LOWER(?)", [
        user.email,
      ]);
    }
    if (user.role === "Intern") {
      const [rows] = await conn.query(
        `SELECT c.stored_name AS storedName,
                c.confirmation_status AS confirmationStatus
         FROM internship_contracts c
         JOIN intern_profiles i ON i.id = c.intern_id
         WHERE LOWER(i.email) = LOWER(?) FOR UPDATE`,
        [user.email],
      );
      if (rows.some((contract) => contract.confirmationStatus === "CONFIRMED")) {
        throw new ConflictError("Không thể xóa tài khoản Intern vì hồ sơ có hợp đồng đã được xác nhận!", 409);
      }
      contracts = rows;
      await conn.query(
        "DELETE FROM intern_profiles WHERE LOWER(email) = LOWER(?)",
        [user.email],
      );
    }

    await conn.query("DELETE FROM users WHERE id = ?", [id]);
    return contracts.map((contract) => contract.storedName);
  });

  // Chỉ xóa file sau khi transaction đã commit thành công.
  storedNames.forEach((storedName) => fileStorage.removeFile(storedName));
  return true;
}

async function insertCandidate({
  name,
  email,
  phone,
  university,
  major,
  cvLink,
  password_hash,
  status = "Chờ duyệt",
}) {
  const db = requireDb();
  const roleId = await getRoleId("Intern");

  const [userResult] = await db.query(
    "INSERT INTO users (name, email, password_hash, role_id, status) VALUES (?, ?, ?, ?, 'PENDING')",
    [name, email, password_hash, roleId],
  );
  const userId = userResult.insertId;

  const [candResult] = await db.query(
    `INSERT INTO candidate_profiles
      (user_id, full_name, email, phone, university, major, cv_link, password_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      name,
      email,
      phone,
      university,
      major || "",
      cvLink || "",
      password_hash,
      status,
    ],
  );

  return {
    id: candResult.insertId,
    userId,
    name,
    email,
    phone,
    university,
    major: major || "Chưa cập nhật",
    cvLink: cvLink || "",
    status,
    createdAt: nowISO(),
  };
}

// ---  DUYỆT / TỪ CHỐI HỒ SƠ ỨNG VIÊN ---
const APPLICATION_COLUMNS = `
  id, user_id AS userId, full_name AS name, email, phone, university, major,
  cv_link AS cvLink, status, rejection_reason AS rejectionReason,
  reviewed_by AS reviewedBy, reviewed_at AS reviewedAt, applied_at AS createdAt`;

async function listApplications() {
  const [rows] = await requireDb().query(
    `SELECT ${APPLICATION_COLUMNS} FROM candidate_profiles ORDER BY id DESC`,
  );
  return rows;
}

// Hồ sơ ứng tuyển khớp theo email (liên kết hồ sơ thực tập sinh <-> tài liệu); email so sánh không phân biệt hoa thường
async function findApplicationsByEmails(emails) {
  if (!Array.isArray(emails) || emails.length === 0) return [];
  const [rows] = await requireDb().query(
    `SELECT ${APPLICATION_COLUMNS} FROM candidate_profiles WHERE LOWER(email) IN (?)`,
    [emails],
  );
  return rows;
}

async function findApplicationById(id) {
  const [rows] = await requireDb().query(
    `SELECT ${APPLICATION_COLUMNS} FROM candidate_profiles WHERE id = ?`,
    [id],
  );
  return rows[0] || null;
}

// Đổi trạng thái ATOMIC: chỉ cập nhật khi hồ sơ còn 'Chờ duyệt'.
// Trả về hồ sơ sau cập nhật, hoặc null nếu không có dòng nào được đổi
// (không tồn tại hoặc đã được người khác xử lý trước).
async function reviewApplicationAtomic({
  id,
  newStatus, // 'Đã duyệt' | 'Từ chối'
  rejectionReason,
  reviewerId,
  requiredDocs = 0, // > 0: chỉ đổi khi hồ sơ có ĐỦ ngần ấy loại tài liệu (kiểm tra trong cùng câu UPDATE)
}) {
  return withTransaction(async (conn) => {
    const [result] = await conn.query(
      `UPDATE candidate_profiles
         SET status = ?, rejection_reason = ?, reviewed_by = ?, reviewed_at = NOW()
       WHERE id = ? AND status = 'Chờ duyệt'
         AND (? = 0 OR (SELECT COUNT(DISTINCT doc_type) FROM application_documents
                        WHERE application_id = ?) >= ?)`,
      [newStatus, rejectionReason, reviewerId, id, requiredDocs, id, requiredDocs],
    );
    if (result.affectedRows === 0) return null;

    const [rows] = await conn.query(
      `SELECT ${APPLICATION_COLUMNS} FROM candidate_profiles WHERE id = ?`,
      [id],
    );
    const application = rows[0];

    // Đồng bộ tài khoản đăng nhập của ứng viên
    if (application.userId) {
      await conn.query("UPDATE users SET status = ? WHERE id = ?", [
        newStatus === "Đã duyệt" ? "ACTIVE" : "LOCKED",
        application.userId,
      ]);
    }

    // Được duyệt -> trở thành thực tập sinh chính thức
    if (newStatus === "Đã duyệt") {
      await conn.query(
        `INSERT INTO intern_profiles
           (student_code, full_name, email, phone, university, major, mentor_name, status)
         VALUES ('', ?, ?, ?, ?, ?, '', ?)
         ON DUPLICATE KEY UPDATE id = id`,
        [
          application.name,
          application.email,
          application.phone || "",
          application.university || DEFAULT_INTERN_UNIVERSITY,
          application.major || "",
          DEFAULT_INTERN_STATUS,
        ],
      );
    }
    return application;
  });
}

async function getAllMentors() {
  const db = requireDb();
  const [rows] = await db.query(
    `SELECT id, full_name AS fullName, email, phone, department, specialization,
            created_at AS createdAt
     FROM mentors ORDER BY id DESC`,
  );
  return rows;
}

// Đảm bảo mỗi hồ sơ (mentor / thực tập sinh) có ĐÚNG 1 tài khoản cùng vai trò khớp email/họ tên/SĐT.
// oldEmail = email hiện tại của hồ sơ trước khi đổi (bằng email mới nếu là tạo mới).
async function upsertProfileAccount(
  conn,
  roleName,
  { oldEmail, fullName, email, phone },
) {
  const roleId = await getRoleId(roleName);
  const [current] = await conn.query(
    "SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND role_id = ? LIMIT 1",
    [oldEmail, roleId],
  );
  const [target] = await conn.query(
    `SELECT u.id, r.role_name AS role
     FROM users u JOIN roles r ON u.role_id = r.id
     WHERE LOWER(u.email) = LOWER(?) LIMIT 1`,
    [email],
  );

  if (current.length > 0) {
    if (target.length > 0 && target[0].id !== current[0].id) {
      throw new ConflictError("Email này đã được dùng cho một tài khoản khác!");
    }
    await conn.query(
      "UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?",
      [fullName, email, phone || null, current[0].id],
    );
  } else if (target.length > 0) {
    if (target[0].role !== roleName) {
      throw new ConflictError(
        `Email này đã được dùng cho tài khoản vai trò ${target[0].role}!`,
      );
    }
    await conn.query("UPDATE users SET name = ?, phone = ? WHERE id = ?", [
      fullName,
      phone || null,
      target[0].id,
    ]);
  } else {
    const passwordHash = await hashPassword(DEFAULT_ACCOUNT_PASSWORD);
    await conn.query(
      `INSERT INTO users (name, email, password_hash, role_id, phone, status)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE')`,
      [fullName, email, passwordHash, roleId, phone || null],
    );
  }
}

// Tạo mentor, kèm tài khoản Mentor tương ứng nếu chưa có
async function insertMentor({
  fullName,
  email,
  phone,
  department,
  specialization,
}) {
  const insertId = await withTransaction(async (conn) => {
    const [result] = await conn.query(
      "INSERT INTO mentors (full_name, email, phone, department, specialization) VALUES (?, ?, ?, ?, ?)",
      [fullName, email, phone || "", department || "", specialization || ""],
    );
    await upsertProfileAccount(conn, "Mentor", {
      oldEmail: email,
      fullName,
      email,
      phone,
    });
    return result.insertId;
  });
  return {
    id: insertId,
    fullName,
    email,
    phone: phone || "",
    department: department || "",
    specialization: specialization || "",
    createdAt: nowISO(),
  };
}

// Đồng bộ họ tên/email/SĐT sang tài khoản Mentor
async function updateMentor(
  id,
  { fullName, email, phone, department, specialization },
) {
  return withTransaction(async (conn) => {
    const [oldRows] = await conn.query(
      "SELECT email FROM mentors WHERE id = ?",
      [id],
    );
    if (oldRows.length === 0) return null;

    const [dup] = await conn.query(
      "SELECT id FROM mentors WHERE LOWER(email) = LOWER(?) AND id <> ?",
      [email, id],
    );
    if (dup.length > 0) {
      throw new ConflictError("Email mentor này đã tồn tại trong hệ thống!");
    }

    await conn.query(
      "UPDATE mentors SET full_name = ?, email = ?, phone = ?, department = ?, specialization = ? WHERE id = ?",
      [
        fullName,
        email,
        phone || "",
        department || "",
        specialization || "",
        id,
      ],
    );
    await upsertProfileAccount(conn, "Mentor", {
      oldEmail: oldRows[0].email,
      fullName,
      email,
      phone,
    });

    const [rows] = await conn.query(
      `SELECT id, full_name AS fullName, email, phone, department, specialization,
              created_at AS createdAt
       FROM mentors WHERE id = ?`,
      [id],
    );
    return rows[0] || null;
  });
}

// Xóa mentor kèm tài khoản Mentor tương ứng
async function deleteMentor(id) {
  const mentorRoleId = await getRoleId("Mentor");
  await withTransaction(async (conn) => {
    const [rows] = await conn.query("SELECT email FROM mentors WHERE id = ?", [
      id,
    ]);
    await conn.query("DELETE FROM mentors WHERE id = ?", [id]);
    if (rows.length > 0) {
      await conn.query(
        "DELETE FROM users WHERE LOWER(email) = LOWER(?) AND role_id = ?",
        [rows[0].email, mentorRoleId],
      );
    }
  });
  return true;
}

// ĐỒNG BỘ TOÀN BỘ dữ liệu cũ giữa bảng users (vai trò Mentor) và bảng mentors.
async function syncMentorsWithAccounts() {
  const db = requireDb();
  const mentorRoleId = await getRoleId("Mentor");
  const defaultHash = await hashPassword(DEFAULT_ACCOUNT_PASSWORD);

  // 1. Tài khoản Mentor chưa có hồ sơ -> tạo hồ sơ mentor
  await db.query(
    `INSERT INTO mentors (full_name, email, phone, department, specialization)
     SELECT u.name, u.email, COALESCE(u.phone, ''), ?, ''
     FROM users u
     WHERE u.role_id = ?
       AND NOT EXISTS (SELECT 1 FROM mentors m WHERE LOWER(m.email) = LOWER(u.email))`,
    [DEFAULT_MENTOR_DEPARTMENT, mentorRoleId],
  );

  // 2. Hồ sơ mentor chưa có tài khoản -> tạo tài khoản Mentor
  await db.query(
    `INSERT INTO users (name, email, password_hash, role_id, phone, status)
     SELECT m.full_name, m.email, ?, ?, NULLIF(m.phone, ''), 'ACTIVE'
     FROM mentors m
     WHERE NOT EXISTS (SELECT 1 FROM users u WHERE LOWER(u.email) = LOWER(m.email))`,
    [defaultHash, mentorRoleId],
  );

  // 3. Hồ sơ đã có SĐT trống mà tài khoản có SĐT -> bổ sung sang hồ sơ
  await db.query(
    `UPDATE mentors m JOIN users u ON LOWER(u.email) = LOWER(m.email)
     SET m.phone = u.phone
     WHERE u.role_id = ? AND (m.phone IS NULL OR m.phone = '')
       AND u.phone IS NOT NULL AND u.phone <> ''`,
    [mentorRoleId],
  );

  // 4. Cặp đã khớp email -> đưa họ tên & SĐT của tài khoản về giống hồ sơ mentor
  await db.query(
    `UPDATE users u JOIN mentors m ON LOWER(m.email) = LOWER(u.email)
     SET u.name = m.full_name, u.phone = NULLIF(m.phone, '')
     WHERE u.role_id = ?
       AND (u.name <> m.full_name OR NOT (u.phone <=> NULLIF(m.phone, '')))`,
    [mentorRoleId],
  );

  // 5. Cảnh báo các mentor trùng email với tài khoản thuộc vai trò khác
  const [conflicts] = await db.query(
    `SELECT m.email, r.role_name AS role
     FROM mentors m
     JOIN users u ON LOWER(u.email) = LOWER(m.email)
     JOIN roles r ON r.id = u.role_id
     WHERE u.role_id <> ?`,
    [mentorRoleId],
  );
  conflicts.forEach((c) =>
    console.warn(
      `[SYNC] Cảnh báo: mentor '${c.email}' trùng email với tài khoản vai trò ${c.role}, cần xử lý thủ công.`,
    ),
  );
}

async function getAllStudents({ includeContractCount = false } = {}) {
  const db = requireDb();
  const [rows] = await db.query(
    `SELECT id, student_code AS studentCode, full_name AS fullName, email, phone,
            university, major, mentor_name AS mentorName, status, created_at AS createdAt
            ${includeContractCount ? `, (SELECT COUNT(*) FROM internship_contracts c WHERE c.intern_id = intern_profiles.id) AS contract_count` : ""}
     FROM intern_profiles ORDER BY id DESC`,
  );
  return rows;
}

// Tạo hồ sơ thực tập sinh, kèm tài khoản Intern tương ứng nếu chưa có
async function insertStudent({
  studentCode,
  fullName,
  email,
  phone,
  university,
  major,
  mentorName,
  status,
}) {
  const finalStatus = status || DEFAULT_INTERN_STATUS;

  const insertId = await withTransaction(async (conn) => {
    const [result] = await conn.query(
      "INSERT INTO intern_profiles (student_code, full_name, email, phone, university, major, mentor_name, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        studentCode || "",
        fullName,
        email,
        phone || "",
        university || "",
        major || "",
        mentorName || "",
        finalStatus,
      ],
    );
    await upsertProfileAccount(conn, "Intern", {
      oldEmail: email,
      fullName,
      email,
      phone,
    });
    return result.insertId;
  });

  return {
    id: insertId,
    studentCode: studentCode || "",
    fullName,
    email,
    phone: phone || "",
    university: university || "",
    major: major || "",
    mentorName: mentorName || "",
    status: finalStatus,
    createdAt: nowISO(),
  };
}

// CHỈNH SỬA HỒ SƠ THỰC TẬP SINH (chỉ cập nhật field nào được truyền vào, giữ nguyên các field còn lại)
// Họ tên / email / SĐT được đồng bộ sang tài khoản Intern tương ứng.
async function updateStudent(
  id,
  {
    studentCode,
    fullName,
    email,
    phone,
    university,
    major,
    mentorName,
    status,
  },
) {
  return withTransaction(async (conn) => {
    const [existingRows] = await conn.query(
      "SELECT * FROM intern_profiles WHERE id = ?",
      [id],
    );
    if (existingRows.length === 0) return null;
    const existing = existingRows[0];

    const merged = {
      studentCode: studentCode ?? existing.student_code,
      fullName: fullName ?? existing.full_name,
      email: email ?? existing.email,
      phone: phone ?? existing.phone,
      university: university ?? existing.university,
      major: major ?? existing.major,
      mentorName: mentorName ?? existing.mentor_name,
      status: status ?? existing.status,
    };

    await conn.query(
      "UPDATE intern_profiles SET student_code = ?, full_name = ?, email = ?, phone = ?, university = ?, major = ?, mentor_name = ?, status = ? WHERE id = ?",
      [
        merged.studentCode,
        merged.fullName,
        merged.email,
        merged.phone,
        merged.university,
        merged.major,
        merged.mentorName,
        merged.status,
        id,
      ],
    );
    await upsertProfileAccount(conn, "Intern", {
      oldEmail: existing.email,
      fullName: merged.fullName,
      email: merged.email,
      phone: merged.phone,
    });

    return { id: Number(id), ...merged };
  });
}

// Xóa hồ sơ kèm tài khoản Intern tương ứng
async function deleteStudent(id) {
  const internRoleId = await getRoleId("Intern");
  const contractRows = await withTransaction(async (conn) => {
    const [contracts] = await conn.query(
      `SELECT stored_name AS storedName, confirmation_status AS confirmationStatus
       FROM internship_contracts WHERE intern_id = ? FOR UPDATE`,
      [id],
    );
    if (contracts.some((contract) => contract.confirmationStatus === "CONFIRMED")) {
      throw new ConflictError("Không thể xóa hồ sơ thực tập sinh vì có hợp đồng đã được xác nhận!", 409);
    }
    const [rows] = await conn.query(
      "SELECT email FROM intern_profiles WHERE id = ?",
      [id],
    );
    await conn.query("DELETE FROM intern_profiles WHERE id = ?", [id]);
    if (rows.length > 0) {
      await conn.query(
        "DELETE FROM users WHERE LOWER(email) = LOWER(?) AND role_id = ?",
        [rows[0].email, internRoleId],
      );
    }
    return contracts;
  });
  return contractRows.map((row) => row.storedName);
}

// ĐỒNG BỘ TOÀN BỘ dữ liệu cũ giữa bảng users (vai trò Intern chính thức) và bảng intern_profiles.
async function syncInternsWithAccounts() {
  const db = requireDb();
  const internRoleId = await getRoleId("Intern");
  const defaultHash = await hashPassword(DEFAULT_ACCOUNT_PASSWORD);

  // 1. Tài khoản Intern chính thức chưa có hồ sơ -> tạo hồ sơ (lấy thêm trường/ngành từ hồ sơ ứng tuyển nếu có)
  await db.query(
    `INSERT INTO intern_profiles
       (student_code, full_name, email, phone, university, major, mentor_name, status)
     SELECT '', u.name, u.email, COALESCE(NULLIF(u.phone, ''), c.phone, ''),
            COALESCE(c.university, ?), COALESCE(c.major, ''), '', ?
     FROM users u
     LEFT JOIN candidate_profiles c ON c.user_id = u.id
     WHERE u.role_id = ?
       AND u.status NOT IN (${NON_INTERN_ACCOUNT_STATUSES_SQL})
       AND NOT EXISTS (SELECT 1 FROM intern_profiles i WHERE LOWER(i.email) = LOWER(u.email))`,
    [DEFAULT_INTERN_UNIVERSITY, DEFAULT_INTERN_STATUS, internRoleId],
  );

  // 2. Hồ sơ thực tập sinh chưa có tài khoản -> tạo tài khoản Intern
  await db.query(
    `INSERT INTO users (name, email, password_hash, role_id, phone, status)
     SELECT i.full_name, i.email, ?, ?, NULLIF(i.phone, ''), 'ACTIVE'
     FROM intern_profiles i
     WHERE NOT EXISTS (SELECT 1 FROM users u WHERE LOWER(u.email) = LOWER(i.email))`,
    [defaultHash, internRoleId],
  );

  // 3. Hồ sơ có SĐT trống mà tài khoản có SĐT -> bổ sung sang hồ sơ
  await db.query(
    `UPDATE intern_profiles i JOIN users u ON LOWER(u.email) = LOWER(i.email)
     SET i.phone = u.phone
     WHERE u.role_id = ? AND (i.phone IS NULL OR i.phone = '')
       AND u.phone IS NOT NULL AND u.phone <> ''`,
    [internRoleId],
  );

  // 4. Cặp đã khớp email -> đưa họ tên & SĐT của tài khoản về giống hồ sơ thực tập sinh
  await db.query(
    `UPDATE users u JOIN intern_profiles i ON LOWER(i.email) = LOWER(u.email)
     SET u.name = i.full_name, u.phone = NULLIF(i.phone, '')
     WHERE u.role_id = ?
       AND (u.name <> i.full_name OR NOT (u.phone <=> NULLIF(i.phone, '')))`,
    [internRoleId],
  );

  // 5. Cảnh báo hồ sơ thực tập sinh trùng email với tài khoản thuộc vai trò khác
  const [conflicts] = await db.query(
    `SELECT i.email, r.role_name AS role
     FROM intern_profiles i
     JOIN users u ON LOWER(u.email) = LOWER(i.email)
     JOIN roles r ON r.id = u.role_id
     WHERE u.role_id <> ?`,
    [internRoleId],
  );
  conflicts.forEach((c) =>
    console.warn(
      `[SYNC] Cảnh báo: thực tập sinh '${c.email}' trùng email với tài khoản vai trò ${c.role}, cần xử lý thủ công.`,
    ),
  );
}

// --- NHẬT KÝ GỬI EMAIL THÔNG BÁO KẾT QUẢ XÉT DUYỆT (email_logs) ---
const EMAIL_LOG_COLUMNS = `
  id, application_id AS applicationId, recipient_email AS recipientEmail,
  recipient_name AS recipientName, email_type AS emailType, subject,
  status, attempts, error_message AS errorMessage,
  created_at AS createdAt, updated_at AS updatedAt, sent_at AS sentAt
`;

// Tạo 1 dòng nhật ký mới (trạng thái PENDING, attempts = 0) - trả về id vừa tạo
async function insertEmailLog({
  applicationId,
  recipientEmail,
  recipientName,
  emailType,
  subject,
}) {
  const [result] = await requireDb().query(
    `INSERT INTO email_logs
       (application_id, recipient_email, recipient_name, email_type, subject, status, attempts)
     VALUES (?, ?, ?, ?, ?, 'PENDING', 0)`,
    [
      applicationId || null,
      recipientEmail,
      recipientName || null,
      emailType,
      subject,
    ],
  );
  return result.insertId;
}

// Cập nhật 1 phần thông tin nhật ký (chỉ ghi các trường thật sự được truyền vào)
async function updateEmailLog(id, { status, attempts, errorMessage, sentAt }) {
  const fields = [];
  const values = [];
  if (status !== undefined) {
    fields.push("status = ?");
    values.push(status);
  }
  if (attempts !== undefined) {
    fields.push("attempts = ?");
    values.push(attempts);
  }
  if (errorMessage !== undefined) {
    fields.push("error_message = ?");
    values.push(errorMessage);
  }
  if (sentAt !== undefined) {
    fields.push("sent_at = ?");
    values.push(sentAt);
  }
  if (fields.length === 0) return;
  values.push(id);
  await requireDb().query(
    `UPDATE email_logs SET ${fields.join(", ")} WHERE id = ?`,
    values,
  );
}

async function findEmailLogById(id) {
  const [rows] = await requireDb().query(
    `SELECT ${EMAIL_LOG_COLUMNS} FROM email_logs WHERE id = ?`,
    [id],
  );
  return rows[0] || null;
}

// Các job còn dang dở khi server bị tắt/crash giữa chừng - nạp lại lúc khởi động
async function listPendingOrRetryingEmailLogs() {
  const [rows] = await requireDb().query(
    `SELECT ${EMAIL_LOG_COLUMNS} FROM email_logs
     WHERE status IN ('PENDING', 'RETRYING') ORDER BY id ASC`,
  );
  return rows;
}

// Danh sách nhật ký có lọc + phân trang, dùng cho trang "Nhật ký Email"
async function listEmailLogs({
  status,
  emailType,
  search,
  page = 1,
  pageSize = 20,
} = {}) {
  const where = [];
  const values = [];
  if (status) {
    where.push("status = ?");
    values.push(status);
  }
  if (emailType) {
    where.push("email_type = ?");
    values.push(emailType);
  }
  if (search) {
    where.push("(recipient_email LIKE ? OR recipient_name LIKE ?)");
    values.push(`%${search}%`, `%${search}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [[{ total }]] = await requireDb().query(
    `SELECT COUNT(*) AS total FROM email_logs ${whereSql}`,
    values,
  );

  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const offset = (safePage - 1) * safePageSize;

  const [rows] = await requireDb().query(
    `SELECT ${EMAIL_LOG_COLUMNS} FROM email_logs ${whereSql}
     ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...values, safePageSize, offset],
  );

  return { rows, total, page: safePage, pageSize: safePageSize };
}

// --- TÀI LIỆU HỒ SƠ ỨNG TUYỂN (CV & ĐƠN XIN THỰC TẬP - application_documents) ---
const DOCUMENT_COLUMNS = `
  id, application_id AS applicationId, doc_type AS docType,
  original_name AS originalName, stored_name AS storedName,
  mime_type AS mimeType, size_bytes AS sizeBytes,
  uploaded_at AS uploadedAt, updated_at AS updatedAt
`;

async function findApplicationByUserIdOrEmail(userId, email) {
  const [rows] = await requireDb().query(
    `SELECT ${APPLICATION_COLUMNS} FROM candidate_profiles
     WHERE (user_id = ? AND user_id IS NOT NULL) OR LOWER(email) = LOWER(?)
     ORDER BY id DESC LIMIT 1`,
    [userId || 0, email || ""],
  );
  return rows[0] || null;
}

async function findDocumentsByApplicationId(applicationId) {
  const [rows] = await requireDb().query(
    `SELECT ${DOCUMENT_COLUMNS} FROM application_documents
     WHERE application_id = ?
     ORDER BY id ASC`,
    [applicationId],
  );
  return rows;
}

async function findDocumentById(docId) {
  const [rows] = await requireDb().query(
    `SELECT ${DOCUMENT_COLUMNS} FROM application_documents
     WHERE id = ? LIMIT 1`,
    [docId],
  );
  return rows[0] || null;
}

// Lấy tài liệu của NHIỀU hồ sơ trong 1 truy vấn (HR xem danh sách ứng viên, tránh N+1)
async function findDocumentsByApplicationIds(applicationIds) {
  if (!Array.isArray(applicationIds) || applicationIds.length === 0) return [];
  const [rows] = await requireDb().query(
    `SELECT ${DOCUMENT_COLUMNS} FROM application_documents
     WHERE application_id IN (?)
     ORDER BY application_id ASC, id ASC`,
    [applicationIds],
  );
  return rows;
}

// Tài khoản Intern được Admin tạo trực tiếp (không qua form ứng tuyển) chưa có hồ sơ.
// Tạo hồ sơ 'Chờ duyệt' GẮN VỚI user hiện có (KHÔNG tạo thêm user mới như insertCandidate).
async function createCandidateProfileForUser(userId) {
  const db = requireDb();
  const [users] = await db.query(
    "SELECT id, name, email FROM users WHERE id = ? LIMIT 1",
    [userId],
  );
  if (users.length === 0) return null;
  const u = users[0];
  try {
    await db.query(
      `INSERT INTO candidate_profiles
         (user_id, full_name, email, phone, university, major, cv_link, password_hash, status)
       VALUES (?, ?, ?, '', 'Chưa cập nhật', '', '', '', 'Chờ duyệt')`,
      [u.id, u.name, u.email],
    );
  } catch (err) {
    // Hai request đồng thời cùng tạo: UNIQUE(email) chặn bản thứ hai -> dùng bản đã có
    if (err.code !== "ER_DUP_ENTRY") throw err;
  }
  return findApplicationByUserIdOrEmail(u.id, u.email);
}

// Hồ sơ 'Chờ duyệt' và 'Đã duyệt' cho phép Intern thay đổi tài liệu; chỉ 'Từ chối' bị khóa.
// Nếu hồ sơ đã duyệt mà tài liệu bị thay đổi -> chuyển về 'Chờ duyệt' để HR duyệt lại tài liệu
// (KHÔNG đổi trạng thái tài khoản đăng nhập, Intern vẫn dùng hệ thống bình thường).
async function reopenIfApproved(conn, applicationId, status) {
  if (status !== "Đã duyệt") return;
  await conn.query(
    `UPDATE candidate_profiles
        SET status = 'Chờ duyệt', rejection_reason = NULL, reviewed_by = NULL, reviewed_at = NULL
      WHERE id = ? AND status = 'Đã duyệt'`,
    [applicationId],
  );
}

// Lưu (thêm mới hoặc ghi đè) tài liệu khi hồ sơ 'Chờ duyệt' hoặc 'Đã duyệt' (bị 'Từ chối' thì khóa).
// Khóa dòng hồ sơ bằng FOR UPDATE trong cùng transaction: HR không thể duyệt/từ chối
// xen giữa bước kiểm tra trạng thái và bước ghi. Lỗi bất kỳ -> rollback toàn bộ.
// Trả về { outcome: 'SAVED' | 'LOCKED' | 'NOT_FOUND', ... }
async function saveDocumentIfPending({
  applicationId,
  docType,
  originalName,
  storedName,
  mimeType,
  sizeBytes,
}) {
  return withTransaction(async (conn) => {
    const [apps] = await conn.query(
      "SELECT status FROM candidate_profiles WHERE id = ? FOR UPDATE",
      [applicationId],
    );
    if (apps.length === 0) return { outcome: "NOT_FOUND" };
    if (apps[0].status === "Từ chối") {
      return { outcome: "LOCKED", status: apps[0].status };
    }

    const [old] = await conn.query(
      `SELECT stored_name AS storedName FROM application_documents
       WHERE application_id = ? AND doc_type = ? FOR UPDATE`,
      [applicationId, docType],
    );

    await conn.query(
      `INSERT INTO application_documents
         (application_id, doc_type, original_name, stored_name, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         original_name = VALUES(original_name),
         stored_name = VALUES(stored_name),
         mime_type = VALUES(mime_type),
         size_bytes = VALUES(size_bytes),
         updated_at = CURRENT_TIMESTAMP`,
      [applicationId, docType, originalName, storedName, mimeType, sizeBytes],
    );

    await reopenIfApproved(conn, applicationId, apps[0].status);

    const [rows] = await conn.query(
      `SELECT ${DOCUMENT_COLUMNS} FROM application_documents
       WHERE application_id = ? AND doc_type = ? LIMIT 1`,
      [applicationId, docType],
    );
    return {
      outcome: "SAVED",
      document: rows[0],
      previousStoredName: old.length > 0 ? old[0].storedName : null,
    };
  });
}

// Xóa bản ghi tài liệu khi hồ sơ không bị 'Từ chối' (cùng cơ chế khóa như trên).
// Trả về { outcome: 'DELETED' | 'LOCKED' | 'NOT_FOUND', storedName?, status? }
async function deleteDocumentIfPending({ applicationId, docId }) {
  return withTransaction(async (conn) => {
    const [apps] = await conn.query(
      "SELECT status FROM candidate_profiles WHERE id = ? FOR UPDATE",
      [applicationId],
    );
    if (apps.length === 0) return { outcome: "NOT_FOUND" };
    if (apps[0].status === "Từ chối") {
      return { outcome: "LOCKED", status: apps[0].status };
    }

    const [docs] = await conn.query(
      `SELECT stored_name AS storedName FROM application_documents
       WHERE id = ? AND application_id = ? FOR UPDATE`,
      [docId, applicationId],
    );
    if (docs.length === 0) return { outcome: "NOT_FOUND" };

    await conn.query("DELETE FROM application_documents WHERE id = ?", [docId]);
    await reopenIfApproved(conn, applicationId, apps[0].status);
    return { outcome: "DELETED", storedName: docs[0].storedName };
  });
}

// --- HỢP ĐỒNG THỰC TẬP SINH ---
const CONTRACT_COLUMNS =
  "id, intern_id AS internId, title, start_date AS startDate, " +
  "end_date AS endDate, note, original_name AS originalName, " +
  "stored_name AS storedName, mime_type AS mimeType, " +
  "size_bytes AS sizeBytes, uploaded_by AS uploadedBy, " +
  "uploaded_at AS uploadedAt, updated_at AS updatedAt, " +
  "confirmation_status AS confirmationStatus, confirmed_at AS confirmedAt, " +
  "confirmed_by AS confirmedBy";

async function findInternProfileById(id) {
  const [rows] = await requireDb().query(
    "SELECT id FROM intern_profiles WHERE id = ? LIMIT 1",
    [id],
  );
  return rows[0] || null;
}

async function findInternProfileByEmail(email) {
  const [rows] = await requireDb().query(
    `SELECT id, email FROM intern_profiles
     WHERE LOWER(email) = LOWER(?) LIMIT 1`,
    [email],
  );
  return rows[0] || null;
}

async function listContractsByInternId(internId) {
  const [rows] = await requireDb().query(
    `SELECT ${CONTRACT_COLUMNS} FROM internship_contracts
     WHERE intern_id = ? ORDER BY uploaded_at DESC, id DESC`,
    [internId],
  );
  return rows;
}

async function insertContract(contract) {
  return withTransaction(async (conn) => {
    const [result] = await conn.query(
      `INSERT INTO internship_contracts
         (intern_id, title, start_date, end_date, note, original_name,
          stored_name, mime_type, size_bytes, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        contract.internId,
        contract.title,
        contract.startDate,
        contract.endDate,
        contract.note,
        contract.originalName,
        contract.storedName,
        contract.mimeType,
        contract.sizeBytes,
        contract.uploadedBy || null,
      ],
    );

    const [rows] = await conn.query(
      `SELECT ${CONTRACT_COLUMNS} FROM internship_contracts WHERE id = ?`,
      [result.insertId],
    );
    return rows[0];
  });
}

async function findContractById(internId, contractId) {
  const [rows] = await requireDb().query(
    `SELECT ${CONTRACT_COLUMNS} FROM internship_contracts
     WHERE id = ? AND intern_id = ? LIMIT 1`,
    [contractId, internId],
  );
  return rows[0] || null;
}

async function deleteContract(internId, contractId) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT stored_name AS storedName,
              confirmation_status AS confirmationStatus
       FROM internship_contracts
       WHERE id = ? AND intern_id = ? FOR UPDATE`,
      [contractId, internId],
    );
    if (rows.length === 0) return { outcome: "NOT_FOUND" };
    if (rows[0].confirmationStatus !== "PENDING") {
      return { outcome: "CONFIRMED" };
    }

    const [result] = await conn.query(
      `DELETE FROM internship_contracts
       WHERE id = ? AND intern_id = ? AND confirmation_status = 'PENDING'`,
      [contractId, internId],
    );
    if (result.affectedRows === 0) return { outcome: "CONFIRMED" };
    return { outcome: "DELETED", storedName: rows[0].storedName };
  });
}

async function confirmContractAtomic(internId, contractId, userId) {
  return withTransaction(async (conn) => {
    const [result] = await conn.query(
      `UPDATE internship_contracts
       SET confirmation_status = 'CONFIRMED', confirmed_at = NOW(), confirmed_by = ?
       WHERE id = ? AND intern_id = ? AND confirmation_status = 'PENDING'`,
      [userId, contractId, internId],
    );
    if (result.affectedRows === 1) {
      const [rows] = await conn.query(
        `SELECT ${CONTRACT_COLUMNS} FROM internship_contracts
         WHERE id = ? AND intern_id = ? LIMIT 1`,
        [contractId, internId],
      );
      return { outcome: "CONFIRMED", contract: rows[0] || null };
    }

    const [rows] = await conn.query(
      `SELECT confirmation_status AS confirmationStatus
       FROM internship_contracts WHERE id = ? AND intern_id = ? LIMIT 1`,
      [contractId, internId],
    );
    if (rows.length === 0) return { outcome: "NOT_FOUND" };
    if (rows[0].confirmationStatus === "CONFIRMED") {
      return { outcome: "ALREADY_CONFIRMED" };
    }
    return { outcome: "NOT_PENDING" };
  });
}

module.exports = {
  initDatabase,
  getPool,
  findUserByEmail,
  findUserForLogin,
  insertUser,
  getAllUsers,
  deleteUser,
  insertCandidate,
  listApplications,
  findApplicationById,
  findApplicationsByEmails,
  reviewApplicationAtomic,
  getAllMentors,
  insertMentor,
  updateMentor,
  deleteMentor,
  getAllStudents,
  insertStudent,
  updateStudent,
  deleteStudent,
  insertEmailLog,
  updateEmailLog,
  findEmailLogById,
  listPendingOrRetryingEmailLogs,
  listEmailLogs,
  findApplicationByUserIdOrEmail,
  findDocumentsByApplicationId,
  findDocumentById,
  findDocumentsByApplicationIds,
  createCandidateProfileForUser,
  saveDocumentIfPending,
  deleteDocumentIfPending,
  findInternProfileById,
  findInternProfileByEmail,
  listContractsByInternId,
  insertContract,
  findContractById,
  deleteContract,
  confirmContractAtomic,
};
