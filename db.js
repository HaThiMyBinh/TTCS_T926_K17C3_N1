// db.js - Quản lý kết nối & truy vấn Database MySQL (nguồn dữ liệu DUY NHẤT)
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const { hashPassword } = require("./auth");

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

function nowISO() {
  return new Date().toISOString();
}

// Phòng ban mặc định khi hồ sơ mentor được tạo tự động từ một tài khoản Mentor
const DEFAULT_MENTOR_DEPARTMENT = "Chưa cập nhật";
// Trường/trạng thái mặc định khi hồ sơ thực tập sinh được tạo tự động từ tài khoản Intern
const DEFAULT_INTERN_UNIVERSITY = "Chưa cập nhật";
const DEFAULT_INTERN_STATUS = "Đang thực tập";
// Tài khoản Intern đang là ứng viên chờ duyệt / bị từ chối chưa phải thực tập sinh chính thức
const NON_INTERN_ACCOUNT_STATUSES = "'PENDING', 'LOCKED'";
// Mật khẩu mặc định của tài khoản được tạo tự động từ hồ sơ mentor / thực tập sinh
const DEFAULT_ACCOUNT_PASSWORD = "password123";

// Lỗi nghiệp vụ (trả về 400 cho client thay vì 500)
class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
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

  // US7: bổ sung cột phục vụ duyệt / từ chối hồ sơ (an toàn khi chạy lại nhiều lần)
  await ensureColumn("candidate_profiles", "rejection_reason", "TEXT NULL");
  await ensureColumn("candidate_profiles", "reviewed_by", "BIGINT NULL");
  await ensureColumn("candidate_profiles", "reviewed_at", "DATETIME NULL");

  // US8: bảng nhật ký gửi email thông báo kết quả xét duyệt
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
    (2, 1), (2, 4),
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

// TÌM USER THEO EMAIL
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

// TÌM USER THEO ACCOUNT HOẶC EMAIL HOẶC ID (LOGIN)
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

// TẠO USER MỚI (POST /api/users) - US 1 Task 3
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
    if (role === "Intern" && !["PENDING", "LOCKED"].includes(status)) {
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

// LẤY TẤT CẢ USERS (GET /api/users)
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

// XÓA USER (DELETE /api/users/:id)
async function deleteUser(id) {
  await withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT u.email, r.role_name AS role
       FROM users u JOIN roles r ON u.role_id = r.id
       WHERE u.id = ?`,
      [id],
    );
    if (rows.length > 0 && rows[0].role === "Mentor") {
      await conn.query("DELETE FROM mentors WHERE LOWER(email) = LOWER(?)", [
        rows[0].email,
      ]);
    }
    if (rows.length > 0 && rows[0].role === "Intern") {
      await conn.query(
        "DELETE FROM intern_profiles WHERE LOWER(email) = LOWER(?)",
        [rows[0].email],
      );
    }
    await conn.query("DELETE FROM users WHERE id = ?", [id]);
  });
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

// LẤY DANH SÁCH ỨNG VIÊN
async function getAllCandidates() {
  const db = requireDb();
  const [rows] = await db.query(
    `SELECT id, user_id AS userId, full_name AS name, email, phone, university, major,
            cv_link AS cvLink, status, applied_at AS createdAt
     FROM candidate_profiles ORDER BY id DESC`,
  );
  return rows;
}

// ============================================================================
// US7: DUYỆT / TỪ CHỐI HỒ SƠ ỨNG VIÊN
// ============================================================================
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
}) {
  return withTransaction(async (conn) => {
    const [result] = await conn.query(
      `UPDATE candidate_profiles
         SET status = ?, rejection_reason = ?, reviewed_by = ?, reviewed_at = NOW()
       WHERE id = ? AND status = 'Chờ duyệt'`,
      [newStatus, rejectionReason, reviewerId, id],
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

// LẤY DANH SÁCH MENTOR
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

// TẠO MENTOR MỚI (đồng thời tạo tài khoản Mentor tương ứng nếu chưa có)
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

// CẬP NHẬT THÔNG TIN MENTOR (đồng bộ họ tên/email/SĐT sang tài khoản Mentor)
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

// XÓA MENTOR (xóa luôn tài khoản Mentor tương ứng)
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
  const [createdProfiles] = await db.query(
    `INSERT INTO mentors (full_name, email, phone, department, specialization)
     SELECT u.name, u.email, COALESCE(u.phone, ''), ?, ''
     FROM users u
     WHERE u.role_id = ?
       AND NOT EXISTS (SELECT 1 FROM mentors m WHERE LOWER(m.email) = LOWER(u.email))`,
    [DEFAULT_MENTOR_DEPARTMENT, mentorRoleId],
  );

  // 2. Hồ sơ mentor chưa có tài khoản -> tạo tài khoản Mentor
  const [createdAccounts] = await db.query(
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
  const [aligned] = await db.query(
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

// LẤY DANH SÁCH HỒ SƠ THỰC TẬP SINH
async function getAllStudents() {
  const db = requireDb();
  const [rows] = await db.query(
    `SELECT id, student_code AS studentCode, full_name AS fullName, email, phone,
            university, major, mentor_name AS mentorName, status, created_at AS createdAt
     FROM intern_profiles ORDER BY id DESC`,
  );
  return rows;
}

// THÊM MỚI HỒ SƠ THỰC TẬP SINH (đồng thời tạo tài khoản Intern tương ứng nếu chưa có)
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

// XÓA HỒ SƠ THỰC TẬP SINH (xóa luôn tài khoản Intern tương ứng)
async function deleteStudent(id) {
  const internRoleId = await getRoleId("Intern");
  await withTransaction(async (conn) => {
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
  });
  return true;
}

// ĐỒNG BỘ TOÀN BỘ dữ liệu cũ giữa bảng users (vai trò Intern chính thức) và bảng intern_profiles.
async function syncInternsWithAccounts() {
  const db = requireDb();
  const internRoleId = await getRoleId("Intern");
  const defaultHash = await hashPassword(DEFAULT_ACCOUNT_PASSWORD);

  // 1. Tài khoản Intern chính thức chưa có hồ sơ -> tạo hồ sơ (lấy thêm trường/ngành từ hồ sơ ứng tuyển nếu có)
  const [createdProfiles] = await db.query(
    `INSERT INTO intern_profiles
       (student_code, full_name, email, phone, university, major, mentor_name, status)
     SELECT '', u.name, u.email, COALESCE(NULLIF(u.phone, ''), c.phone, ''),
            COALESCE(c.university, ?), COALESCE(c.major, ''), '', ?
     FROM users u
     LEFT JOIN candidate_profiles c ON c.user_id = u.id
     WHERE u.role_id = ?
       AND u.status NOT IN (${NON_INTERN_ACCOUNT_STATUSES})
       AND NOT EXISTS (SELECT 1 FROM intern_profiles i WHERE LOWER(i.email) = LOWER(u.email))`,
    [DEFAULT_INTERN_UNIVERSITY, DEFAULT_INTERN_STATUS, internRoleId],
  );

  // 2. Hồ sơ thực tập sinh chưa có tài khoản -> tạo tài khoản Intern
  const [createdAccounts] = await db.query(
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
  const [aligned] = await db.query(
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

// ============================================================================
//  US8: NHẬT KÝ GỬI EMAIL THÔNG BÁO KẾT QUẢ XÉT DUYỆT (email_logs)
// ============================================================================
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
    [applicationId || null, recipientEmail, recipientName || null, emailType, subject],
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

module.exports = {
  initDatabase,
  findUserByEmail,
  findUserForLogin,
  insertUser,
  getAllUsers,
  deleteUser,
  insertCandidate,
  getAllCandidates,
  listApplications,
  findApplicationById,
  reviewApplicationAtomic,
  getAllMentors,
  insertMentor,
  updateMentor,
  deleteMentor,
  getAllStudents,
  insertStudent,
  updateStudent,
  deleteStudent,
  syncMentorsWithAccounts,
  syncInternsWithAccounts,
  insertEmailLog,
  updateEmailLog,
  findEmailLogById,
  listPendingOrRetryingEmailLogs,
  listEmailLogs,
  getIsMysqlConnected: () => isMysqlConnected,
};
