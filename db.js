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
    config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) };
  } catch (e) {
    console.warn(`[DATABASE] Không đọc được ${CONFIG_FILE}, dùng cấu hình mặc định.`);
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

// Biến môi trường (nếu có) sẽ ghi đè db_config.json - hữu ích khi deploy hoặc
// khi không muốn commit mật khẩu thật vào file cấu hình.
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

// Timestamp ISO dùng chung cho các bản ghi vừa tạo (tránh gọi lặp new Date().toISOString())
function nowISO() {
  return new Date().toISOString();
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
}

async function seedDefaultAccounts() {
  // Mật khẩu mẫu được băm bằng bcrypt (thay cho SHA-256 cũ, xem backend/auth.js)
  const defaultPassHash = await hashPassword("password123");
  const defaultAccounts = [
    { name: "Hà Thị Mỹ Bình", email: "admin@gmail.com", role: "Admin" },
    { name: "Hà Thị Mỹ Bình", email: "hr@company.com", role: "HR" },
    { name: "Hà Thị Mỹ Bình", email: "mentor@gmail.com", role: "Mentor" },
    { name: "Hà Thị Mỹ Bình", email: "intern@gmail.com", role: "Intern" },
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
  const db = requireDb();
  const roleId = await getRoleId(role);

  const [result] = await db.query(
    "INSERT INTO users (name, email, password_hash, role_id, status) VALUES (?, ?, ?, ?, ?)",
    [name, email, password_hash, roleId, status],
  );

  return {
    id: result.insertId,
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
  const db = requireDb();
  await db.query("DELETE FROM users WHERE id = ?", [id]);
  return true;
}

// TẠO ỨNG VIÊN MỚI (đăng ký công khai) - đồng thời tạo bản ghi users PENDING
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

// CẬP NHẬT TRẠNG THÁI ỨNG VIÊN
// Đồng bộ trạng thái sang cả users.status (ENUM khác với candidate_profiles.status)
async function updateCandidateStatus(id, newStatus) {
  const db = requireDb();

  const statusMap = {
    "Đã duyệt": "ACTIVE",
    "Từ chối": "LOCKED",
    "Chờ duyệt": "PENDING",
  };

  const [rows] = await db.query(
    "SELECT user_id AS userId FROM candidate_profiles WHERE id = ?",
    [id],
  );
  if (rows.length === 0) return null;

  await db.query("UPDATE candidate_profiles SET status = ? WHERE id = ?", [
    newStatus,
    id,
  ]);

  const userId = rows[0].userId;
  if (userId && statusMap[newStatus]) {
    await db.query("UPDATE users SET status = ? WHERE id = ?", [
      statusMap[newStatus],
      userId,
    ]);
  }

  const [updated] = await db.query(
    `SELECT id, user_id AS userId, full_name AS name, email, phone, university, major,
            cv_link AS cvLink, status, applied_at AS createdAt
     FROM candidate_profiles WHERE id = ?`,
    [id],
  );
  return updated[0] || null;
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

// TẠO MENTOR MỚI
async function insertMentor({
  fullName,
  email,
  phone,
  department,
  specialization,
}) {
  const db = requireDb();
  const [result] = await db.query(
    "INSERT INTO mentors (full_name, email, phone, department, specialization) VALUES (?, ?, ?, ?, ?)",
    [fullName, email, phone || "", department || "", specialization || ""],
  );
  return {
    id: result.insertId,
    fullName,
    email,
    phone: phone || "",
    department: department || "",
    specialization: specialization || "",
    createdAt: nowISO(),
  };
}

// CẬP NHẬT THÔNG TIN MENTOR
async function updateMentor(
  id,
  { fullName, email, phone, department, specialization },
) {
  const db = requireDb();
  const [result] = await db.query(
    "UPDATE mentors SET full_name = ?, email = ?, phone = ?, department = ?, specialization = ? WHERE id = ?",
    [fullName, email, phone || "", department || "", specialization || "", id],
  );
  if (result.affectedRows === 0) return null;

  const [rows] = await db.query(
    `SELECT id, full_name AS fullName, email, phone, department, specialization,
            created_at AS createdAt
     FROM mentors WHERE id = ?`,
    [id],
  );
  return rows[0] || null;
}

// XÓA MENTOR
async function deleteMentor(id) {
  const db = requireDb();
  await db.query("DELETE FROM mentors WHERE id = ?", [id]);
  return true;
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

// THÊM MỚI HỒ SƠ THỰC TẬP SINH
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
  const db = requireDb();
  const finalStatus = status || "Đang thực tập";

  const [result] = await db.query(
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

  return {
    id: result.insertId,
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
  const db = requireDb();

  const [existingRows] = await db.query(
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

  await db.query(
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

  return { id: Number(id), ...merged };
}

// XÓA HỒ SƠ THỰC TẬP SINH
async function deleteStudent(id) {
  const db = requireDb();
  await db.query("DELETE FROM intern_profiles WHERE id = ?", [id]);
  return true;
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
  updateCandidateStatus,
  getAllMentors,
  insertMentor,
  updateMentor,
  deleteMentor,
  getAllStudents,
  insertStudent,
  updateStudent,
  deleteStudent,
  getIsMysqlConnected: () => isMysqlConnected,
};
