// db.js - Quản lý kết nối & truy vấn Database MySQL (nguồn dữ liệu DUY NHẤT)
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const { hashPassword } = require("./auth");
const fileStorage = require("./services/fileStorage");
const {
  resolveUniqueMentorId,
} = require("./services/mentorAssignment.service");
const { VIETNAM_UTC_OFFSET } = require("./utils/date");

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

async function seedDepartmentsFromMentors(targetPool = requireDb()) {
  const [departmentCount] = await targetPool.query(
    "SELECT COUNT(*) AS total FROM departments",
  );
  if (Number(departmentCount[0].total) > 0) return false;
  await targetPool.query(`INSERT IGNORE INTO departments (name)
    SELECT DISTINCT TRIM(department) FROM mentors
    WHERE department IS NOT NULL AND TRIM(department) <> ''`);
  return true;
}

async function backfillInternMentorIds(targetPool = requireDb()) {
  const [result] = await targetPool.query(`
    UPDATE intern_profiles ip
    JOIN (
      SELECT ip_old.id, MIN(m.id) AS mentor_id
      FROM intern_profiles ip_old
      JOIN mentors m
        ON LOWER(TRIM(m.full_name)) = LOWER(TRIM(ip_old.mentor_name))
      WHERE ip_old.mentor_id IS NULL
        AND ip_old.mentor_name IS NOT NULL
        AND TRIM(ip_old.mentor_name) <> ''
      GROUP BY ip_old.id
      HAVING COUNT(DISTINCT m.id) = 1
    ) resolved ON resolved.id = ip.id
    SET ip.mentor_id = resolved.mentor_id
    WHERE ip.mentor_id IS NULL
  `);
  return result.affectedRows;
}

async function closePool() {
  if (pool) await pool.end();
  pool = null;
  isMysqlConnected = false;
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
const NON_INTERN_ACCOUNT_STATUSES_SQL = NON_INTERN_ACCOUNT_STATUSES.map(
  (status) => `'${status}'`,
).join(", ");
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

async function ensureUniqueScheduleIndex() {
  const [indexes] = await pool.query(
    `SELECT INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsList
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'intern_schedules'
     GROUP BY INDEX_NAME, NON_UNIQUE`,
    [config.database],
  );
  const matchesColumns = (index) =>
    Number(index.nonUnique) === 0 &&
    index.columnsList === "intern_id,phase_order";
  const correct = indexes.some(
    (index) =>
      index.indexName === "uq_schedule_intern_phase" && matchesColumns(index),
  );
  if (correct) return;
  // Keep the lowest ID for each pair before adding the unique key.
  await pool.query(`DELETE newer FROM intern_schedules newer
    JOIN intern_schedules older ON older.intern_id = newer.intern_id
      AND older.phase_order = newer.phase_order AND older.id < newer.id`);
  const named = indexes.find(
    (index) => index.indexName === "uq_schedule_intern_phase",
  );
  if (named)
    await pool.query(
      "ALTER TABLE intern_schedules DROP INDEX uq_schedule_intern_phase",
    );
  const existingUnique = indexes.find(
    (index) =>
      index.indexName !== "uq_schedule_intern_phase" && matchesColumns(index),
  );
  if (existingUnique) {
    const oldName = String(existingUnique.indexName).replace(/`/g, "``");
    await pool.query(
      `ALTER TABLE intern_schedules RENAME INDEX \`${oldName}\` TO uq_schedule_intern_phase`,
    );
    return;
  }
  await pool.query(
    "ALTER TABLE intern_schedules ADD UNIQUE KEY uq_schedule_intern_phase (intern_id, phase_order)",
  );
}

// Khởi tạo kết nối MySQL, tạo bảng & seed dữ liệu mặc định nếu chưa có
async function initDatabase() {
  // Repeated initialization replaces the previous pool instead of leaking it.
  if (pool) await pool.end();
  pool = null;
  isMysqlConnected = false;
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
    // Cố định múi giờ Việt Nam cho cả phía Node (chuyển đổi Date) và phiên MySQL (NOW(), TIMESTAMP).
    timezone: VIETNAM_UTC_OFFSET,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
  pool.on("connection", (connection) => {
    connection.query(`SET time_zone = '${VIETNAM_UTC_OFFSET}'`);
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
      \`mentor_id\` BIGINT NULL,
      \`status\` VARCHAR(50) DEFAULT 'Đang thực tập',
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT \`fk_intern_mentor_id\` FOREIGN KEY (\`mentor_id\`) REFERENCES \`mentors\`(\`id\`) ON DELETE SET NULL,
      INDEX \`idx_intern_mentor_id\` (\`mentor_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await ensureColumn("intern_profiles", "mentor_id", "BIGINT NULL");
  await ensureIndex("intern_profiles", "idx_intern_mentor_id", "mentor_id");
  await ensureIndex("intern_profiles", "idx_intern_university", "university");
  await ensureIndex("intern_profiles", "idx_intern_major", "major");
  await ensureForeignKey(
    "intern_profiles",
    "fk_intern_mentor_id",
    "FOREIGN KEY (\`mentor_id\`) REFERENCES \`mentors\`(\`id\`) ON DELETE SET NULL",
  );
  await backfillInternMentorIds(pool);

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
      \`program_id\` BIGINT NULL,
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
  await ensureIndex(
    "internship_contracts",
    "idx_contract_confirmed_by",
    "confirmed_by",
  );
  await ensureForeignKey(
    "internship_contracts",
    "fk_contract_confirmed_by",
    "FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL",
  );

  await pool.query(`CREATE TABLE IF NOT EXISTS departments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL COLLATE utf8mb4_unicode_ci,
    description TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_departments_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS internship_programs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    department_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    start_date DATE NULL,
    end_date DATE NULL,
    capacity INT NULL,
    CONSTRAINT chk_program_capacity CHECK (capacity IS NULL OR capacity >= 1),
    status ENUM('DRAFT','OPEN','ONGOING','CLOSED') NOT NULL DEFAULT 'DRAFT',
    created_by BIGINT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_program_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT,
    CONSTRAINT fk_program_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_program_department_status (department_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await ensureColumn("internship_contracts", "program_id", "BIGINT NULL");
  await ensureForeignKey(
    "internship_contracts",
    "fk_contract_program",
    "FOREIGN KEY (\`program_id\`) REFERENCES internship_programs(id) ON DELETE SET NULL",
  );

  await pool.query(`CREATE TABLE IF NOT EXISTS intern_schedules (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    intern_id BIGINT NOT NULL,
    phase_order INT NOT NULL DEFAULT 1,
    title VARCHAR(255) NOT NULL,
    start_date DATE NULL,
    end_date DATE NULL,
    duration_weeks VARCHAR(50) NULL,
    description TEXT NULL,
    expected_results TEXT NULL,
    status ENUM('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED') NOT NULL DEFAULT 'NOT_STARTED',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_schedule_intern_phase (intern_id, phase_order),
    INDEX idx_schedule_intern (intern_id),
    CONSTRAINT fk_schedule_intern FOREIGN KEY (intern_id) REFERENCES intern_profiles(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await ensureUniqueScheduleIndex();

  // Nhiệm vụ Mentor giao cho thực tập sinh. Xóa hồ sơ intern thì xóa nhiệm vụ;
  // xóa mentor chỉ bỏ liên kết người giao.
  await pool.query(`CREATE TABLE IF NOT EXISTS intern_tasks (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    intern_id BIGINT NOT NULL,
    created_by_mentor_id BIGINT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    due_date DATE NULL,
    priority ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL DEFAULT 'MEDIUM',
    status ENUM('TODO', 'IN_PROGRESS', 'DONE') NOT NULL DEFAULT 'TODO',
    progress_percent TINYINT UNSIGNED NOT NULL DEFAULT 0,
    progress_note TEXT NULL,
    progress_updated_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_task_intern (intern_id),
    INDEX idx_task_mentor (created_by_mentor_id),
    CONSTRAINT fk_task_intern FOREIGN KEY (intern_id) REFERENCES intern_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_task_mentor FOREIGN KEY (created_by_mentor_id) REFERENCES mentors(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Tiến độ do thực tập sinh cập nhật để mentor theo dõi (US12).
  await ensureColumn(
    "intern_tasks",
    "progress_percent",
    "TINYINT UNSIGNED NOT NULL DEFAULT 0",
  );
  await ensureColumn("intern_tasks", "progress_note", "TEXT NULL");
  await ensureColumn("intern_tasks", "progress_updated_at", "DATETIME NULL");
  // Việc DONE từ trước khi có cột % phải hiển thị 100% cho nhất quán.
  await pool.query(
    "UPDATE intern_tasks SET progress_percent = 100 WHERE status = 'DONE' AND progress_percent = 0",
  );

  // Tệp đính kèm khi thực tập sinh cập nhật tiến độ (minh chứng, báo cáo...).
  // Xóa nhiệm vụ thì xóa bản ghi; file trên đĩa do service dọn.
  await pool.query(`CREATE TABLE IF NOT EXISTS task_attachments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    task_id BIGINT NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_task_attachment_task (task_id),
    CONSTRAINT fk_task_attachment_task FOREIGN KEY (task_id) REFERENCES intern_tasks(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Báo cáo tuần của thực tập sinh: mỗi intern 1 báo cáo cho mỗi tuần (thứ Hai).
  // is_late = nộp sau hạn (hết Chủ nhật của tuần đó, giờ Việt Nam).
  await pool.query(`CREATE TABLE IF NOT EXISTS weekly_reports (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    intern_id BIGINT NOT NULL,
    week_start DATE NOT NULL,
    content TEXT NOT NULL,
    difficulties TEXT NULL,
    next_plan TEXT NULL,
    is_late TINYINT(1) NOT NULL DEFAULT 0,
    submitted_at DATETIME NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_weekly_report_intern_week (intern_id, week_start),
    CONSTRAINT fk_weekly_report_intern FOREIGN KEY (intern_id) REFERENCES intern_profiles(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS weekly_report_attachments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    report_id BIGINT NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_weekly_attachment_report (report_id),
    CONSTRAINT fk_weekly_attachment_report FOREIGN KEY (report_id) REFERENCES weekly_reports(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Phản hồi của mentor cho báo cáo tuần: mỗi báo cáo tối đa 1 phản hồi (UNIQUE report_id).
  await pool.query(`CREATE TABLE IF NOT EXISTS weekly_report_feedback (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    report_id BIGINT NOT NULL,
    mentor_id BIGINT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_weekly_feedback_report (report_id),
    INDEX idx_weekly_feedback_mentor (mentor_id),
    CONSTRAINT fk_weekly_feedback_report FOREIGN KEY (report_id) REFERENCES weekly_reports(id) ON DELETE CASCADE,
    CONSTRAINT fk_weekly_feedback_mentor FOREIGN KEY (mentor_id) REFERENCES mentors(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Đánh giá tổng kết của mentor cho thực tập sinh: mỗi thực tập sinh tối đa 1 đánh giá (UNIQUE intern_id).
  await pool.query(`CREATE TABLE IF NOT EXISTS intern_evaluations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    intern_id BIGINT NOT NULL,
    mentor_id BIGINT NULL,
    skill_score TINYINT UNSIGNED NOT NULL,
    skill_comment TEXT NULL,
    attitude_score TINYINT UNSIGNED NOT NULL,
    attitude_comment TEXT NULL,
    overall_comment TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_evaluation_intern (intern_id),
    INDEX idx_evaluation_mentor (mentor_id),
    CONSTRAINT chk_eval_skill CHECK (skill_score BETWEEN 1 AND 5),
    CONSTRAINT chk_eval_attitude CHECK (attitude_score BETWEEN 1 AND 5),
    CONSTRAINT fk_evaluation_intern FOREIGN KEY (intern_id) REFERENCES intern_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_evaluation_mentor FOREIGN KEY (mentor_id) REFERENCES mentors(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS attendance_records (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, intern_id BIGINT NOT NULL, work_date DATE NOT NULL,
    check_in_at DATETIME NOT NULL, check_out_at DATETIME NULL, note VARCHAR(255) NULL,
    is_adjusted TINYINT(1) NOT NULL DEFAULT 0,
    correction_status ENUM('PENDING','APPROVED','REJECTED') NULL,
    correction_check_out_at DATETIME NULL, correction_reason VARCHAR(255) NULL,
    correction_requested_at DATETIME NULL, correction_reviewed_by BIGINT NULL,
    correction_reviewed_at DATETIME NULL, correction_review_note VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_attendance_intern_date (intern_id, work_date),
    CONSTRAINT chk_attendance_checkout CHECK (check_out_at IS NULL OR check_out_at >= check_in_at),
    CONSTRAINT fk_attendance_intern FOREIGN KEY (intern_id) REFERENCES intern_profiles(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // Database cũ: bổ sung các cột bổ sung check-out (đề nghị điều chỉnh giờ ra do quên check-out).
  await ensureColumn("attendance_records", "is_adjusted", "TINYINT(1) NOT NULL DEFAULT 0");
  await ensureColumn("attendance_records", "correction_status", "ENUM('PENDING','APPROVED','REJECTED') NULL");
  await ensureColumn("attendance_records", "correction_check_out_at", "DATETIME NULL");
  await ensureColumn("attendance_records", "correction_reason", "VARCHAR(255) NULL");
  await ensureColumn("attendance_records", "correction_requested_at", "DATETIME NULL");
  await ensureColumn("attendance_records", "correction_reviewed_by", "BIGINT NULL");
  await ensureColumn("attendance_records", "correction_reviewed_at", "DATETIME NULL");
  await ensureColumn("attendance_records", "correction_review_note", "VARCHAR(255) NULL");
  await pool.query(`CREATE TABLE IF NOT EXISTS final_reports (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255) NOT NULL,
    scope_type ENUM('ALL','UNIVERSITY','PROGRAM') NOT NULL, scope_value VARCHAR(255) NULL,
    period_from DATE NULL, period_to DATE NULL,
    status ENUM('DRAFT','FINALIZED') NOT NULL DEFAULT 'DRAFT', hr_note TEXT NULL,
    snapshot_json LONGTEXT NULL, created_by BIGINT NULL, finalized_by BIGINT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, finalized_at DATETIME NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_final_report_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_final_report_finalizer FOREIGN KEY (finalized_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // Lịch sử gửi báo cáo cuối kỳ (mỗi lần gửi email thành công là một dòng).
  await pool.query(`CREATE TABLE IF NOT EXISTS final_report_sends (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, report_id BIGINT NOT NULL, sent_by BIGINT NULL,
    recipients TEXT NOT NULL, message VARCHAR(1000) NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_final_report_sends_report (report_id, sent_at),
    CONSTRAINT fk_final_report_send_report FOREIGN KEY (report_id) REFERENCES final_reports(id) ON DELETE CASCADE,
    CONSTRAINT fk_final_report_send_user FOREIGN KEY (sent_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // Danh sách email người nhận đã dùng, gợi ý theo phạm vi báo cáo (scope_value rỗng = phạm vi ALL).
  await pool.query(`CREATE TABLE IF NOT EXISTS final_report_recipients (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(254) NOT NULL,
    scope_type ENUM('ALL','UNIVERSITY','PROGRAM') NOT NULL, scope_value VARCHAR(255) NOT NULL DEFAULT '',
    created_by BIGINT NULL, last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_final_report_recipient (email, scope_type, scope_value),
    CONSTRAINT fk_final_report_recipient_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await seedDepartmentsFromMentors(pool);

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
      if (
        rows.some((contract) => contract.confirmationStatus === "CONFIRMED")
      ) {
        throw new ConflictError(
          "Không thể xóa tài khoản Intern vì hồ sơ có hợp đồng đã được xác nhận!",
          409,
        );
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
  const roleId = await getRoleId("Intern");

  // Tạo tài khoản + hồ sơ ứng tuyển trong 1 transaction: lỗi ở bước nào cũng rollback,
  // không để lại tài khoản mồ côi.
  const { id, userId } = await withTransaction(async (conn) => {
    const [userResult] = await conn.query(
      "INSERT INTO users (name, email, password_hash, role_id, status) VALUES (?, ?, ?, ?, 'PENDING')",
      [name, email, password_hash, roleId],
    );
    const newUserId = userResult.insertId;

    const [candResult] = await conn.query(
      `INSERT INTO candidate_profiles
        (user_id, full_name, email, phone, university, major, cv_link, password_hash, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newUserId,
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
    return { id: candResult.insertId, userId: newUserId };
  });

  return {
    id,
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

// Ứng viên bị TỪ CHỐI được nộp lại: dùng lại đúng hồ sơ + tài khoản cũ (email là duy nhất),
// đặt về "Chờ duyệt", xóa lý do từ chối / người duyệt và mở khóa tài khoản.
// Trả về hồ sơ mới, hoặc null nếu email này không có hồ sơ ở trạng thái "Từ chối".
async function reapplyRejectedCandidate({
  name,
  email,
  phone,
  university,
  major,
  cvLink,
  password_hash,
}) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, user_id AS userId, status FROM candidate_profiles
       WHERE LOWER(email) = LOWER(?) FOR UPDATE`,
      [email],
    );
    const candidate = rows[0];
    if (!candidate || candidate.status !== "Từ chối") return null;

    await conn.query(
      `UPDATE candidate_profiles
         SET full_name = ?, phone = ?, university = ?, major = ?, cv_link = ?,
             password_hash = ?, status = 'Chờ duyệt', rejection_reason = NULL,
             reviewed_by = NULL, reviewed_at = NULL, applied_at = NOW()
       WHERE id = ?`,
      [name, phone, university, major || "", cvLink || "", password_hash, candidate.id],
    );
    if (candidate.userId) {
      await conn.query(
        "UPDATE users SET name = ?, phone = ?, password_hash = ?, status = 'PENDING' WHERE id = ?",
        [name, phone, password_hash, candidate.userId],
      );
    }
    return {
      id: candidate.id,
      userId: candidate.userId,
      name,
      email,
      phone,
      university,
      major: major || "Chưa cập nhật",
      cvLink: cvLink || "",
      status: "Chờ duyệt",
      createdAt: nowISO(),
    };
  });
}

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
      [
        newStatus,
        rejectionReason,
        reviewerId,
        id,
        requiredDocs,
        id,
        requiredDocs,
      ],
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
      "SELECT email FROM mentors WHERE id = ? FOR UPDATE",
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
    await conn.query(
      "UPDATE intern_profiles SET mentor_name = ? WHERE mentor_id = ?",
      [fullName, id],
    );

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
    const [rows] = await conn.query(
      "SELECT email FROM mentors WHERE id = ? FOR UPDATE",
      [id],
    );
    await conn.query(
      "UPDATE intern_profiles SET mentor_id = NULL, mentor_name = '' WHERE mentor_id = ?",
      [id],
    );
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

async function getAllStudents({
  includeContractCount = false,
  filters = {},
} = {}) {
  const { buildInternFilterConditions } = require("./utils/internFilters");
  const { whereSql, params } = buildInternFilterConditions(filters);
  const [rows] = await requireDb().query(
    `SELECT ip.id, ip.student_code AS studentCode, ip.full_name AS fullName, ip.email, ip.phone,
            ip.university, ip.major, ip.mentor_name AS mentorName, ip.mentor_id AS mentorId,
            ip.status, ip.created_at AS createdAt
            ${includeContractCount ? `, (SELECT COUNT(*) FROM internship_contracts c WHERE c.intern_id = ip.id) AS contract_count` : ""}
     FROM intern_profiles ip ${whereSql} ORDER BY ip.id DESC`,
    params,
  );
  return rows;
}

async function getStudentsForMentorEmail(email, filters = {}) {
  const { buildInternFilterConditions } = require("./utils/internFilters");
  const { whereSql, params } = buildInternFilterConditions(filters);
  const [rows] = await requireDb().query(
    `SELECT ip.id, ip.student_code AS studentCode, ip.full_name AS fullName,
            ip.email, ip.phone, ip.university, ip.major,
            ip.mentor_name AS mentorName, ip.mentor_id AS mentorId,
            ip.status, ip.created_at AS createdAt
     FROM intern_profiles ip JOIN mentors m ON m.id = ip.mentor_id
     ${whereSql ? `${whereSql} AND` : "WHERE"} LOWER(m.email) = LOWER(?)
     ORDER BY ip.id DESC`,
    [...params, email],
  );
  return rows;
}

async function getInternFilterOptions({ university = "" } = {}) {
  const database = requireDb();
  const [universities] = await database.query(
    `SELECT DISTINCT TRIM(university) AS value FROM intern_profiles
     WHERE university IS NOT NULL AND TRIM(university) <> ''
     ORDER BY value COLLATE utf8mb4_unicode_ci`,
  );
  const universityCondition = university
    ? " AND CONVERT(university USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci"
    : "";
  const [majors] = await database.query(
    `SELECT DISTINCT TRIM(major) AS value FROM intern_profiles
     WHERE major IS NOT NULL AND TRIM(major) <> ''${universityCondition}
     ORDER BY value COLLATE utf8mb4_unicode_ci`,
    university ? [university] : [],
  );
  return {
    universities: universities.map((row) => row.value),
    majors: majors.map((row) => row.value),
  };
}

async function countInterns({ unassigned = false } = {}) {
  const whereSql = unassigned ? "WHERE mentor_id IS NULL" : "";
  const [rows] = await requireDb().query(
    `SELECT COUNT(*) AS count FROM intern_profiles ${whereSql}`,
  );
  return Number(rows[0]?.count) || 0;
}

async function assignInternMentor(internId, mentorId) {
  try {
    return await withTransaction(async (conn) => {
      let mentorName = "";
      if (mentorId != null) {
        const [mentorRows] = await conn.query(
          "SELECT full_name FROM mentors WHERE id = ? FOR UPDATE",
          [mentorId],
        );
        if (mentorRows.length === 0) return { outcome: "MENTOR_NOT_FOUND" };
        mentorName = mentorRows[0].full_name;
      }

      // Khóa mentor rồi đến intern, cùng thứ tự với luồng xóa để tránh race/deadlock.
      const [internRows] = await conn.query(
        "SELECT id FROM intern_profiles WHERE id = ? FOR UPDATE",
        [internId],
      );
      if (internRows.length === 0) return { outcome: "INTERN_NOT_FOUND" };

      await conn.query(
        "UPDATE intern_profiles SET mentor_id = ?, mentor_name = ? WHERE id = ?",
        [mentorId, mentorName, internId],
      );
      return {
        outcome: "UPDATED",
        student: { id: internId, mentorId, mentorName },
      };
    });
  } catch (err) {
    if (mentorId != null && err.code === "ER_NO_REFERENCED_ROW_2") {
      return { outcome: "MENTOR_NOT_FOUND" };
    }
    throw err;
  }
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

  const inserted = await withTransaction(async (conn) => {
    const [mentorRows] = await conn.query(
      `SELECT id, full_name AS fullName FROM mentors
       WHERE LOWER(TRIM(full_name)) = LOWER(TRIM(?)) LIMIT 2`,
      [mentorName || ""],
    );
    const mentorId = resolveUniqueMentorId(mentorName, mentorRows);
    const [result] = await conn.query(
      "INSERT INTO intern_profiles (student_code, full_name, email, phone, university, major, mentor_name, mentor_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        studentCode || "",
        fullName,
        email,
        phone || "",
        university || "",
        major || "",
        mentorName || "",
        mentorId,
        finalStatus,
      ],
    );
    await upsertProfileAccount(conn, "Intern", {
      oldEmail: email,
      fullName,
      email,
      phone,
    });
    return { id: result.insertId, mentorId };
  });

  return {
    id: inserted.id,
    studentCode: studentCode || "",
    fullName,
    email,
    phone: phone || "",
    university: university || "",
    major: major || "",
    mentorName: mentorName || "",
    mentorId: inserted.mentorId,
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

    let mentorId = existing.mentor_id;
    if (mentorName != null && mentorName !== existing.mentor_name) {
      const [mentorRows] = await conn.query(
        `SELECT id, full_name AS fullName FROM mentors
         WHERE LOWER(TRIM(full_name)) = LOWER(TRIM(?)) LIMIT 2`,
        [mentorName || ""],
      );
      mentorId = resolveUniqueMentorId(mentorName, mentorRows);
    }

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
      "UPDATE intern_profiles SET student_code = ?, full_name = ?, email = ?, phone = ?, university = ?, major = ?, mentor_name = ?, mentor_id = ?, status = ? WHERE id = ?",
      [
        merged.studentCode,
        merged.fullName,
        merged.email,
        merged.phone,
        merged.university,
        merged.major,
        merged.mentorName,
        mentorId,
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

    return { id: Number(id), ...merged, mentorId };
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
    if (
      contracts.some((contract) => contract.confirmationStatus === "CONFIRMED")
    ) {
      throw new ConflictError(
        "Không thể xóa hồ sơ thực tập sinh vì có hợp đồng đã được xác nhận!",
        409,
      );
    }
    // File đính kèm của nhiệm vụ và báo cáo tuần bị xóa DB theo (CASCADE) nên phải lấy
    // tên file trước để dọn trên đĩa.
    const [taskFiles] = await conn.query(
      `SELECT ta.stored_name AS storedName
       FROM task_attachments ta
       JOIN intern_tasks t ON t.id = ta.task_id
       WHERE t.intern_id = ?`,
      [id],
    );
    const [reportFiles] = await conn.query(
      `SELECT wa.stored_name AS storedName
       FROM weekly_report_attachments wa
       JOIN weekly_reports wr ON wr.id = wa.report_id
       WHERE wr.intern_id = ?`,
      [id],
    );
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
    return [...contracts, ...taskFiles, ...reportFiles];
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
  "end_date AS endDate, note, program_id AS programId, original_name AS originalName, " +
  "stored_name AS storedName, mime_type AS mimeType, " +
  "size_bytes AS sizeBytes, uploaded_by AS uploadedBy, " +
  "uploaded_at AS uploadedAt, updated_at AS updatedAt, " +
  "confirmation_status AS confirmationStatus, confirmed_at AS confirmedAt, " +
  "confirmed_by AS confirmedBy";

async function findInternProfileById(id) {
  const [rows] = await requireDb().query(
    `SELECT id, student_code AS studentCode, full_name AS fullName, email,
            phone, university, major, mentor_name AS mentorName, mentor_id AS mentorId,
            status, created_at AS createdAt
     FROM intern_profiles WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

async function findInternProfileByEmail(email) {
  const [rows] = await requireDb().query(
    `SELECT id, student_code AS studentCode, full_name AS fullName, email,
            phone, university, major, mentor_name AS mentorName, mentor_id AS mentorId,
            status, created_at AS createdAt
     FROM intern_profiles
     WHERE LOWER(email) = LOWER(?) LIMIT 1`,
    [email],
  );
  return rows[0] || null;
}

async function findMentorById(id) {
  if (!id) return null;
  const [rows] = await requireDb().query(
    `SELECT id, full_name AS fullName, email, phone, department, specialization, created_at AS createdAt
     FROM mentors WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

async function findMentorByEmail(email) {
  if (!email) return null;
  const [rows] = await requireDb().query(
    `SELECT id, full_name AS fullName, email, phone, department, specialization
     FROM mentors WHERE LOWER(email) = LOWER(?) LIMIT 1`,
    [email],
  );
  return rows[0] || null;
}

// ---------- NHIỆM VỤ GIAO CHO THỰC TẬP SINH ----------
const TASK_SELECT = `SELECT t.id, t.intern_id AS internId, t.created_by_mentor_id AS createdByMentorId,
            t.title, t.description, t.due_date AS dueDate, t.priority, t.status,
            t.progress_percent AS progressPercent, t.progress_note AS progressNote,
            t.progress_updated_at AS progressUpdatedAt,
            t.created_at AS createdAt, t.updated_at AS updatedAt,
            ip.full_name AS internName, ip.student_code AS studentCode,
            ip.mentor_id AS internMentorId, m.full_name AS mentorName
     FROM intern_tasks t
     JOIN intern_profiles ip ON ip.id = t.intern_id
     LEFT JOIN mentors m ON m.id = ip.mentor_id`;
const TASK_ORDER = `ORDER BY (t.status = 'DONE') ASC, (t.due_date IS NULL) ASC, t.due_date ASC, t.id DESC`;

async function insertInternTask(task) {
  const [result] = await requireDb().query(
    `INSERT INTO intern_tasks (intern_id, created_by_mentor_id, title, description, due_date, priority)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      task.internId,
      task.createdByMentorId || null,
      task.title,
      task.description || null,
      task.dueDate || null,
      task.priority || "MEDIUM",
    ],
  );
  return result.insertId;
}

async function findInternTaskById(id) {
  const [rows] = await requireDb().query(
    `${TASK_SELECT} WHERE t.id = ? LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

// Mentor chỉ thấy nhiệm vụ của thực tập sinh đang được phân công cho mình.
async function listInternTasksForMentor(
  mentorId,
  { internId = null, status = null } = {},
) {
  const params = [mentorId];
  let extraSql = "";
  if (internId) {
    extraSql += " AND t.intern_id = ?";
    params.push(internId);
  }
  if (status) {
    extraSql += " AND t.status = ?";
    params.push(status);
  }
  const [rows] = await requireDb().query(
    `${TASK_SELECT} WHERE ip.mentor_id = ?${extraSql} ${TASK_ORDER}`,
    params,
  );
  return rows;
}

async function listInternTasksForIntern(internId) {
  const [rows] = await requireDb().query(
    `${TASK_SELECT} WHERE t.intern_id = ? ${TASK_ORDER}`,
    [internId],
  );
  return rows;
}

// fields dùng khóa nội bộ (title, description, dueDate, priority, status),
// không nhận khóa từ request.
async function updateInternTask(id, fields) {
  const columns = {
    title: "title",
    description: "description",
    dueDate: "due_date",
    priority: "priority",
    status: "status",
    progressPercent: "progress_percent",
  };
  const sets = [];
  const params = [];
  for (const [key, column] of Object.entries(columns)) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
    sets.push(`${column} = ?`);
    params.push(fields[key]);
  }
  if (sets.length === 0) return 0;
  const [result] = await requireDb().query(
    `UPDATE intern_tasks SET ${sets.join(", ")} WHERE id = ?`,
    [...params, id],
  );
  return result.affectedRows;
}

// Thực tập sinh cập nhật tiến độ. Luôn ghi progress_updated_at; chỉ đổi các
// trường có trong `fields` (status, progressPercent, progressNote).
async function updateInternTaskProgress(id, fields) {
  const columns = {
    status: "status",
    progressPercent: "progress_percent",
    progressNote: "progress_note",
  };
  const sets = ["progress_updated_at = NOW()"];
  const params = [];
  for (const [key, column] of Object.entries(columns)) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
    sets.push(`${column} = ?`);
    params.push(fields[key]);
  }
  const [result] = await requireDb().query(
    `UPDATE intern_tasks SET ${sets.join(", ")} WHERE id = ?`,
    [...params, id],
  );
  return result.affectedRows;
}

// ---------- BÁO CÁO TUẦN ----------
// Kỳ thực tập của intern: ngày bắt đầu sớm nhất / kết thúc muộn nhất của các hợp đồng
// đã xác nhận (endDate = null nếu có hợp đồng chưa có ngày kết thúc).
const PERIOD_SELECT = `SELECT MIN(start_date) AS startDate,
            CASE WHEN SUM(end_date IS NULL) > 0 THEN NULL ELSE MAX(end_date) END AS endDate
     FROM internship_contracts
     WHERE confirmation_status = 'CONFIRMED'`;

async function findInternContractPeriod(internId) {
  const [rows] = await requireDb().query(`${PERIOD_SELECT} AND intern_id = ?`, [
    internId,
  ]);
  return rows[0] || { startDate: null, endDate: null };
}

// Thực tập sinh của mentor kèm kỳ thực tập (dùng cho bảng tổng quan nộp báo cáo).
async function listInternsWithPeriodForMentor(mentorId) {
  const [rows] = await requireDb().query(
    `SELECT ip.id, ip.full_name AS fullName, ip.student_code AS studentCode,
            ip.created_at AS createdAt, p.startDate, p.endDate
     FROM intern_profiles ip
     LEFT JOIN (
       SELECT intern_id, MIN(start_date) AS startDate,
              CASE WHEN SUM(end_date IS NULL) > 0 THEN NULL ELSE MAX(end_date) END AS endDate
       FROM internship_contracts
       WHERE confirmation_status = 'CONFIRMED'
       GROUP BY intern_id
     ) p ON p.intern_id = ip.id
     WHERE ip.mentor_id = ?
     ORDER BY ip.full_name ASC, ip.id ASC`,
    [mentorId],
  );
  return rows;
}

const WEEKLY_REPORT_SELECT = `SELECT wr.id, wr.intern_id AS internId, wr.week_start AS weekStart,
            wr.content, wr.difficulties, wr.next_plan AS nextPlan, wr.is_late AS isLate,
            wr.submitted_at AS submittedAt, wr.updated_at AS updatedAt,
            ip.full_name AS internName, ip.student_code AS studentCode,
            ip.mentor_id AS internMentorId,
            wf.id AS feedbackId, wf.content AS feedbackContent,
            wf.mentor_id AS feedbackMentorId, fm.full_name AS feedbackMentorName,
            wf.created_at AS feedbackCreatedAt, wf.updated_at AS feedbackUpdatedAt
     FROM weekly_reports wr
     JOIN intern_profiles ip ON ip.id = wr.intern_id
     LEFT JOIN weekly_report_feedback wf ON wf.report_id = wr.id
     LEFT JOIN mentors fm ON fm.id = wf.mentor_id`;

async function findWeeklyReportById(id) {
  const [rows] = await requireDb().query(
    `${WEEKLY_REPORT_SELECT} WHERE wr.id = ? LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

async function findWeeklyReportByWeek(internId, weekStart) {
  const [rows] = await requireDb().query(
    `${WEEKLY_REPORT_SELECT} WHERE wr.intern_id = ? AND wr.week_start = ? LIMIT 1`,
    [internId, weekStart],
  );
  return rows[0] || null;
}

// Nộp mới hoặc cập nhật báo cáo của tuần đó. Nộp lại không đổi is_late / submitted_at.
async function upsertWeeklyReport({
  internId,
  weekStart,
  content,
  difficulties,
  nextPlan,
  isLate,
}) {
  await requireDb().query(
    `INSERT INTO weekly_reports
       (intern_id, week_start, content, difficulties, next_plan, is_late, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       content = VALUES(content),
       difficulties = VALUES(difficulties),
       next_plan = VALUES(next_plan)`,
    [internId, weekStart, content, difficulties, nextPlan, isLate ? 1 : 0],
  );
  return findWeeklyReportByWeek(internId, weekStart);
}

async function listWeeklyReportsForIntern(internId) {
  const [rows] = await requireDb().query(
    `${WEEKLY_REPORT_SELECT} WHERE wr.intern_id = ? ORDER BY wr.week_start DESC`,
    [internId],
  );
  return rows;
}

// Mentor chỉ thấy báo cáo của thực tập sinh đang được phân công cho mình.
async function listWeeklyReportsForMentor(
  mentorId,
  { internId = null, weekStart = null } = {},
) {
  const params = [mentorId];
  let extraSql = "";
  if (internId) {
    extraSql += " AND wr.intern_id = ?";
    params.push(internId);
  }
  if (weekStart) {
    extraSql += " AND wr.week_start = ?";
    params.push(weekStart);
  }
  const [rows] = await requireDb().query(
    `${WEEKLY_REPORT_SELECT} WHERE ip.mentor_id = ?${extraSql}
     ORDER BY wr.week_start DESC, ip.full_name ASC`,
    params,
  );
  return rows;
}

// ---------- PHẢN HỒI CỦA MENTOR CHO BÁO CÁO TUẦN ----------
// Mỗi báo cáo tối đa 1 phản hồi. Gửi lại thì ghi đè nội dung và đặt updated_at = NOW()
// (kể cả khi nội dung giống hệt) để mốc "đã xem lại báo cáo mới" luôn được làm mới.
// Trả về báo cáo (kèm phản hồi) sau khi lưu.
async function upsertWeeklyReportFeedback({ reportId, mentorId, content }) {
  await requireDb().query(
    `INSERT INTO weekly_report_feedback (report_id, mentor_id, content)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       mentor_id = VALUES(mentor_id),
       content = VALUES(content),
       updated_at = NOW()`,
    [reportId, mentorId, content],
  );
  return findWeeklyReportById(reportId);
}

async function deleteWeeklyReportFeedback(reportId) {
  const [result] = await requireDb().query(
    "DELETE FROM weekly_report_feedback WHERE report_id = ?",
    [reportId],
  );
  return result.affectedRows;
}

// ---------- ĐÁNH GIÁ TỔNG KẾT CỦA MENTOR ----------
// Mỗi thực tập sinh tối đa 1 đánh giá. Trả về bản ghi kèm tên mentor, hoặc null nếu chưa có.
const EVALUATION_SELECT = `SELECT ev.id, ev.intern_id AS internId,
            ip.full_name AS internName, ip.student_code AS studentCode,
            ip.mentor_id AS internMentorId,
            ev.mentor_id AS mentorId, m.full_name AS mentorName,
            ev.skill_score AS skillScore, ev.skill_comment AS skillComment,
            ev.attitude_score AS attitudeScore, ev.attitude_comment AS attitudeComment,
            ev.overall_comment AS overallComment,
            ev.created_at AS createdAt, ev.updated_at AS updatedAt
     FROM intern_evaluations ev
     JOIN intern_profiles ip ON ip.id = ev.intern_id
     LEFT JOIN mentors m ON m.id = ev.mentor_id`;

async function findInternEvaluation(internId) {
  const [rows] = await requireDb().query(
    `${EVALUATION_SELECT} WHERE ev.intern_id = ? LIMIT 1`,
    [internId],
  );
  return rows[0] || null;
}

// Gửi lại thì ghi đè nội dung và đặt updated_at = NOW() (kể cả khi nội dung giống hệt).
async function upsertInternEvaluation({
  internId,
  mentorId,
  skillScore,
  skillComment,
  attitudeScore,
  attitudeComment,
  overallComment,
}) {
  await requireDb().query(
    `INSERT INTO intern_evaluations
       (intern_id, mentor_id, skill_score, skill_comment, attitude_score, attitude_comment, overall_comment)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       mentor_id = VALUES(mentor_id),
       skill_score = VALUES(skill_score),
       skill_comment = VALUES(skill_comment),
       attitude_score = VALUES(attitude_score),
       attitude_comment = VALUES(attitude_comment),
       overall_comment = VALUES(overall_comment),
       updated_at = NOW()`,
    [
      internId,
      mentorId,
      skillScore,
      skillComment,
      attitudeScore,
      attitudeComment,
      overallComment,
    ],
  );
  return findInternEvaluation(internId);
}

async function getServerDateTime() {
  const [rows] = await requireDb().query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS serverNow");
  return rows[0]?.serverNow;
}
const ATTENDANCE_COLUMNS = `a.id, a.intern_id AS internId, DATE_FORMAT(a.work_date, '%Y-%m-%d') AS workDate,
    DATE_FORMAT(a.check_in_at, '%Y-%m-%d %H:%i:%s') AS checkInAt, DATE_FORMAT(a.check_out_at, '%Y-%m-%d %H:%i:%s') AS checkOutAt,
    a.note, TIMESTAMPDIFF(MINUTE, a.check_in_at, a.check_out_at) AS durationMinutes, a.is_adjusted AS isAdjusted,
    a.correction_status AS correctionStatus, DATE_FORMAT(a.correction_check_out_at, '%Y-%m-%d %H:%i:%s') AS correctionCheckOutAt,
    a.correction_reason AS correctionReason, DATE_FORMAT(a.correction_requested_at, '%Y-%m-%d %H:%i:%s') AS correctionRequestedAt,
    DATE_FORMAT(a.correction_reviewed_at, '%Y-%m-%d %H:%i:%s') AS correctionReviewedAt, a.correction_review_note AS correctionReviewNote`;
async function findAttendanceByInternDate(internId, workDate) {
  const [rows] = await requireDb().query(`SELECT ${ATTENDANCE_COLUMNS} FROM attendance_records a WHERE a.intern_id = ? AND a.work_date = ? LIMIT 1`, [internId, workDate]);
  return rows[0] || null;
}
async function findAttendanceById(id) {
  const [rows] = await requireDb().query(`SELECT ${ATTENDANCE_COLUMNS} FROM attendance_records a WHERE a.id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}
// Ca đang mở (chưa check-out) bắt đầu trong vòng maxHours giờ gần nhất — gồm cả ca qua đêm.
async function findOpenAttendance(internId, maxHours) {
  const [rows] = await requireDb().query(`SELECT ${ATTENDANCE_COLUMNS} FROM attendance_records a
    WHERE a.intern_id = ? AND a.check_out_at IS NULL AND a.check_in_at >= (NOW() - INTERVAL ? HOUR)
    ORDER BY a.check_in_at DESC LIMIT 1`, [internId, maxHours]);
  return rows[0] || null;
}
// Ngày làm việc có nằm trong ít nhất một hợp đồng đã xác nhận không (không tính khoảng trống giữa các hợp đồng).
async function hasConfirmedContractOn(internId, date) {
  const [rows] = await requireDb().query(`SELECT 1 FROM internship_contracts WHERE intern_id = ? AND confirmation_status = 'CONFIRMED'
    AND (start_date IS NULL OR start_date <= ?) AND (end_date IS NULL OR end_date >= ?) LIMIT 1`, [internId, date, date]);
  return rows.length > 0;
}
async function insertAttendance({ internId, workDate, note }) {
  try {
    await requireDb().query(`INSERT INTO attendance_records (intern_id, work_date, check_in_at, note)
      VALUES (?, ?, NOW(), ?)`, [internId, workDate, note]);
    return findAttendanceByInternDate(internId, workDate);
  }
  catch (err) {
    if (err.code === "ER_DUP_ENTRY")
      return "DUPLICATE";
    throw err;
  }
}
async function checkOutAttendance(id) {
  const [result] = await requireDb().query("UPDATE attendance_records SET check_out_at = NOW() WHERE id = ? AND check_out_at IS NULL", [id]);
  if (!result.affectedRows)
    return null;
  return findAttendanceById(id);
}
async function listAttendance(internId, from, to) {
  const [rows] = await requireDb().query(`SELECT ${ATTENDANCE_COLUMNS} FROM attendance_records a
    WHERE a.intern_id = ? AND a.work_date BETWEEN ? AND ? ORDER BY a.work_date DESC`, [internId, from, to]);
  return rows;
}
// Thực tập sinh đề nghị bổ sung giờ check-out cho ca quên check-out. Cho gửi lại sau khi bị từ chối.
async function requestAttendanceCorrection({ id, internId, checkOutAt, reason }) {
  const [result] = await requireDb().query(`UPDATE attendance_records SET correction_status = 'PENDING', correction_check_out_at = ?,
    correction_reason = ?, correction_requested_at = NOW(), correction_reviewed_by = NULL, correction_reviewed_at = NULL, correction_review_note = NULL
    WHERE id = ? AND intern_id = ? AND check_out_at IS NULL AND (correction_status IS NULL OR correction_status = 'REJECTED')`, [checkOutAt, reason, id, internId]);
  return result.affectedRows;
}
async function reviewAttendanceCorrection({ id, decision, userId, note }) {
  const approved = decision === "APPROVED";
  const [result] = await requireDb().query(`UPDATE attendance_records SET correction_status = ?,
    check_out_at = IF(?, correction_check_out_at, check_out_at), is_adjusted = IF(?, 1, is_adjusted),
    correction_reviewed_by = ?, correction_reviewed_at = NOW(), correction_review_note = ?
    WHERE id = ? AND correction_status = 'PENDING' AND check_out_at IS NULL`, [
    decision,
    approved,
    approved,
    userId,
    note || null,
    id
  ]);
  return result.affectedRows;
}
async function listPendingAttendanceCorrections(mentorId = null) {
  const params = [];
  let extra = "";
  if (mentorId) {
    extra = " AND ip.mentor_id = ?";
    params.push(mentorId);
  }
  const [rows] = await requireDb().query(`SELECT ${ATTENDANCE_COLUMNS}, ip.full_name AS fullName, ip.student_code AS studentCode
    FROM attendance_records a JOIN intern_profiles ip ON ip.id = a.intern_id
    WHERE a.correction_status = 'PENDING'${extra} ORDER BY a.correction_requested_at ASC, a.id ASC`, params);
  return rows;
}
async function deleteInternEvaluation(internId) {
  const [result] = await requireDb().query(
    "DELETE FROM intern_evaluations WHERE intern_id = ?",
    [internId],
  );
  return result.affectedRows;
}

// Mọi thực tập sinh của mentor kèm đánh giá (nếu có) — dùng cho bảng tổng quan.
async function listFinalReportInterns({ scopeType, scopeValue, from, to }) {
  // Thứ tự tham số phải khớp thứ tự xuất hiện trong câu SQL: các subquery trước, bộ lọc WHERE sau.
  const cpParams = [], taskParams = [], attParams = [], params = [];
  // Chỉ thực tập sinh đã có hợp đồng xác nhận (đang/đã thực tập thật) mới vào báo cáo.
  const filters = ["EXISTS (SELECT 1 FROM internship_contracts c0 WHERE c0.intern_id=ip.id AND c0.confirmation_status='CONFIRMED')"];
  let programClause = "";
  if (scopeType === "UNIVERSITY") {
    filters.push("TRIM(ip.university) = TRIM(?)");
    params.push(scopeValue);
  }
  if (scopeType === "PROGRAM") {
    filters.push("EXISTS (SELECT 1 FROM internship_contracts c WHERE c.intern_id=ip.id AND c.confirmation_status='CONFIRMED' AND c.program_id=?)");
    params.push(scopeValue);
    programClause = " AND c.program_id = ?";
    cpParams.push(scopeValue);
  }
  if (from) {
    filters.push("p.startDate IS NOT NULL AND (p.endDate IS NULL OR p.endDate >= ?)");
    params.push(from);
  }
  if (to) {
    filters.push("p.startDate IS NOT NULL AND p.startDate <= ?");
    params.push(to);
  }
  // Nhiệm vụ và giờ làm chỉ tính trong kỳ báo cáo (nhiệm vụ theo hạn nộp, không có hạn thì theo ngày giao).
  let taskPeriod = "", attPeriod = "";
  if (from) {
    taskPeriod += " AND COALESCE(due_date, DATE(created_at)) >= ?";
    taskParams.push(from);
    attPeriod += " AND work_date >= ?";
    attParams.push(from);
  }
  if (to) {
    taskPeriod += " AND COALESCE(due_date, DATE(created_at)) <= ?";
    taskParams.push(to);
    attPeriod += " AND work_date <= ?";
    attParams.push(to);
  }
  const [rows] = await requireDb().query(`SELECT ip.id AS internId, ip.full_name AS fullName, ip.student_code AS studentCode,
    ip.university, ip.major, COALESCE(m.full_name, ip.mentor_name) AS mentorName,
    p.startDate, p.endDate, cp.programName, cp.departmentName,
    ev.skill_score AS skillScore, ev.skill_comment AS skillComment, ev.attitude_score AS attitudeScore,
    ev.attitude_comment AS attitudeComment, ev.overall_comment AS overallComment,
    COALESCE(ts.taskCount,0) AS taskCount, COALESCE(ts.completedTaskCount,0) AS completedTaskCount,
    COALESCE(att.totalWorkMinutes,0) AS totalWorkMinutes
    FROM intern_profiles ip LEFT JOIN mentors m ON m.id=ip.mentor_id
    LEFT JOIN intern_evaluations ev ON ev.intern_id=ip.id
    LEFT JOIN (SELECT intern_id, MIN(start_date) AS startDate, CASE WHEN SUM(end_date IS NULL)>0 THEN NULL ELSE MAX(end_date) END AS endDate
      FROM internship_contracts WHERE confirmation_status='CONFIRMED' GROUP BY intern_id) p ON p.intern_id=ip.id
    LEFT JOIN (SELECT c.intern_id, GROUP_CONCAT(DISTINCT pr.name ORDER BY pr.name SEPARATOR ', ') AS programName,
        GROUP_CONCAT(DISTINCT d.name ORDER BY d.name SEPARATOR ', ') AS departmentName
      FROM internship_contracts c JOIN internship_programs pr ON pr.id=c.program_id LEFT JOIN departments d ON d.id=pr.department_id
      WHERE c.confirmation_status='CONFIRMED'${programClause} GROUP BY c.intern_id) cp ON cp.intern_id=ip.id
    LEFT JOIN (SELECT intern_id, COUNT(*) AS taskCount, SUM(status='DONE') AS completedTaskCount FROM intern_tasks WHERE 1=1${taskPeriod} GROUP BY intern_id) ts ON ts.intern_id=ip.id
    LEFT JOIN (SELECT intern_id, SUM(TIMESTAMPDIFF(MINUTE,check_in_at,check_out_at)) AS totalWorkMinutes FROM attendance_records WHERE check_out_at IS NOT NULL${attPeriod} GROUP BY intern_id) att ON att.intern_id=ip.id
    WHERE ${filters.join(" AND ")} ORDER BY ip.full_name, ip.id`, [...cpParams, ...taskParams, ...attParams, ...params]);
  if (!rows.length)
    return rows;
  const ids = rows.map(r => r.internId);
  const [reports] = await requireDb().query("SELECT intern_id AS internId, week_start AS weekStart, is_late AS isLate FROM weekly_reports WHERE intern_id IN (?)", [ids]);
  const grouped = new Map();
  for (const r of reports)
    (grouped.get(Number(r.internId)) || (grouped.set(Number(r.internId), []), grouped.get(Number(r.internId)))).push(r);
  return rows.map(r => ({ ...r, weeklyReports: grouped.get(Number(r.internId)) || [] }));
}
async function getFinalReportFilterOptions() {
  const [programs] = await requireDb().query("SELECT id, name FROM internship_programs ORDER BY name");
  return { ...(await getInternFilterOptions()), programs };
}
async function createFinalReport(fields, userId) {
  const [result] = await requireDb().query(`INSERT INTO final_reports (title,scope_type,scope_value,period_from,period_to,hr_note,created_by)
    VALUES (?,?,?,?,?,?,?)`, [fields.title,fields.scopeType,fields.scopeValue,fields.periodFrom,fields.periodTo,fields.hrNote,userId]);
  return findFinalReportById(result.insertId);
}
async function listFinalReports({ status = null, limit = 20, offset = 0 } = {}) {
  const params = [];
  const where = status ? "WHERE fr.status = ?" : "";
  if (status) params.push(status);
  params.push(limit, offset);
  const [rows] = await requireDb().query(`SELECT fr.id,fr.title,fr.scope_type AS scopeType,fr.scope_value AS scopeValue,
    fr.period_from AS periodFrom,fr.period_to AS periodTo,fr.status,fr.created_by AS createdBy,u.name AS createdByName,
    fr.created_at AS createdAt,fr.finalized_at AS finalizedAt,
    (SELECT COUNT(*) FROM final_report_sends s WHERE s.report_id=fr.id) AS sendCount,
    (SELECT MAX(s.sent_at) FROM final_report_sends s WHERE s.report_id=fr.id) AS lastSentAt,
    (SELECT s.recipients FROM final_report_sends s WHERE s.report_id=fr.id ORDER BY s.sent_at DESC, s.id DESC LIMIT 1) AS lastRecipients
    FROM final_reports fr LEFT JOIN users u ON u.id=fr.created_by ${where} ORDER BY fr.created_at DESC, fr.id DESC LIMIT ? OFFSET ?`, params);
  return rows;
}
async function findFinalReportById(id) {
  const [rows] = await requireDb().query(`SELECT id,title,scope_type AS scopeType,scope_value AS scopeValue,
    period_from AS periodFrom,period_to AS periodTo,status,hr_note AS hrNote,snapshot_json AS snapshotJson,
    created_by AS createdBy,finalized_by AS finalizedBy,created_at AS createdAt,finalized_at AS finalizedAt,updated_at AS updatedAt
    FROM final_reports WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}
async function updateFinalReport(id, fields) {
  const [result] = await requireDb().query(`UPDATE final_reports SET title=?,scope_type=?,scope_value=?,period_from=?,period_to=?,hr_note=? WHERE id=? AND status='DRAFT'`,
    [fields.title,fields.scopeType,fields.scopeValue,fields.periodFrom,fields.periodTo,fields.hrNote,id]);
  return result.affectedRows;
}
async function finalizeFinalReport(id, userId, snapshot) {
  const [result] = await requireDb().query(`UPDATE final_reports SET status='FINALIZED',snapshot_json=?,finalized_by=?,finalized_at=NOW()
    WHERE id=? AND status='DRAFT'`, [JSON.stringify(snapshot),userId,id]);
  return result.affectedRows;
}
async function deleteFinalReport(id) {
  const [result] = await requireDb().query("DELETE FROM final_reports WHERE id=? AND status='DRAFT'", [id]);
  return result.affectedRows;
}
async function recordFinalReportSend({ reportId, userId, recipients, message }) {
  const [result] = await requireDb().query("INSERT INTO final_report_sends (report_id,sent_by,recipients,message) VALUES (?,?,?,?)",
    [reportId, userId || null, JSON.stringify(recipients), message || null]);
  return result.insertId;
}
async function listFinalReportSends(reportId) {
  const [rows] = await requireDb().query(`SELECT s.id,s.recipients,s.message,s.sent_at AS sentAt,s.sent_by AS sentBy,u.name AS sentByName
    FROM final_report_sends s LEFT JOIN users u ON u.id=s.sent_by WHERE s.report_id=? ORDER BY s.sent_at DESC, s.id DESC`, [reportId]);
  return rows;
}
async function upsertFinalReportRecipients({ emails, scopeType, scopeValue, userId }) {
  const value = scopeType === "ALL" ? "" : String(scopeValue || "");
  for (const email of emails)
    await requireDb().query(`INSERT INTO final_report_recipients (email,scope_type,scope_value,created_by) VALUES (?,?,?,?)
      ON DUPLICATE KEY UPDATE last_used_at=CURRENT_TIMESTAMP`, [email, scopeType, value, userId || null]);
}
async function listFinalReportRecipients({ scopeType, scopeValue }) {
  const value = scopeType === "ALL" ? "" : String(scopeValue || "");
  const [rows] = await requireDb().query(`SELECT id,email,scope_type AS scopeType,scope_value AS scopeValue,last_used_at AS lastUsedAt
    FROM final_report_recipients WHERE (scope_type=? AND scope_value=?) OR scope_type='ALL'
    ORDER BY (scope_type=?) DESC, last_used_at DESC, id DESC LIMIT 30`, [scopeType, value, scopeType]);
  return rows;
}
async function deleteFinalReportRecipient(id) {
  const [result] = await requireDb().query("DELETE FROM final_report_recipients WHERE id=?", [id]);
  return result.affectedRows;
}

async function listEvaluationsForMentor(mentorId) {
  const [rows] = await requireDb().query(
    `SELECT ip.id AS internId, ip.full_name AS internName, ip.student_code AS studentCode,
            ev.id AS evaluationId, ev.skill_score AS skillScore,
            ev.attitude_score AS attitudeScore, ev.updated_at AS updatedAt
     FROM intern_profiles ip
     LEFT JOIN intern_evaluations ev ON ev.intern_id = ip.id
     WHERE ip.mentor_id = ?
     ORDER BY ip.full_name ASC, ip.id ASC`,
    [mentorId],
  );
  return rows;
}

const WEEKLY_ATTACHMENT_COLUMNS = `id, report_id AS reportId, original_name AS originalName,
            stored_name AS storedName, mime_type AS mimeType,
            size_bytes AS sizeBytes, uploaded_at AS uploadedAt`;

// Trả về { [reportId]: [attachment, ...] }.
async function listWeeklyReportAttachmentsByReportIds(reportIds) {
  const ids = [...new Set(reportIds.map(Number))].filter(Number.isFinite);
  if (ids.length === 0) return {};
  const [rows] = await requireDb().query(
    `SELECT ${WEEKLY_ATTACHMENT_COLUMNS} FROM weekly_report_attachments
     WHERE report_id IN (?) ORDER BY id ASC`,
    [ids],
  );
  const grouped = {};
  for (const row of rows) {
    (grouped[Number(row.reportId)] ||= []).push(row);
  }
  return grouped;
}

async function findWeeklyReportAttachmentById(reportId, attachmentId) {
  const [rows] = await requireDb().query(
    `SELECT ${WEEKLY_ATTACHMENT_COLUMNS} FROM weekly_report_attachments
     WHERE id = ? AND report_id = ? LIMIT 1`,
    [attachmentId, reportId],
  );
  return rows[0] || null;
}

// Khóa dòng báo cáo để hai request song song không vượt quá giới hạn số file.
// Trả về { outcome: 'SAVED' | 'LIMIT' | 'NOT_FOUND', attachment? }
async function insertWeeklyReportAttachmentLimited(
  { reportId, originalName, storedName, mimeType, sizeBytes },
  maxCount,
) {
  return withTransaction(async (conn) => {
    const [reports] = await conn.query(
      "SELECT id FROM weekly_reports WHERE id = ? FOR UPDATE",
      [reportId],
    );
    if (reports.length === 0) return { outcome: "NOT_FOUND" };

    const [[{ total }]] = await conn.query(
      "SELECT COUNT(*) AS total FROM weekly_report_attachments WHERE report_id = ?",
      [reportId],
    );
    if (Number(total) >= maxCount) return { outcome: "LIMIT" };

    const [result] = await conn.query(
      `INSERT INTO weekly_report_attachments
         (report_id, original_name, stored_name, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?)`,
      [reportId, originalName, storedName, mimeType, sizeBytes],
    );
    const [rows] = await conn.query(
      `SELECT ${WEEKLY_ATTACHMENT_COLUMNS} FROM weekly_report_attachments WHERE id = ?`,
      [result.insertId],
    );
    return { outcome: "SAVED", attachment: rows[0] };
  });
}

async function deleteWeeklyReportAttachment(reportId, attachmentId) {
  const [result] = await requireDb().query(
    "DELETE FROM weekly_report_attachments WHERE id = ? AND report_id = ?",
    [attachmentId, reportId],
  );
  return result.affectedRows;
}

// ---------- TỆP ĐÍNH KÈM CỦA CẬP NHẬT TIẾN ĐỘ ----------
const ATTACHMENT_COLUMNS = `id, task_id AS taskId, original_name AS originalName,
            stored_name AS storedName, mime_type AS mimeType,
            size_bytes AS sizeBytes, uploaded_at AS uploadedAt`;

// Trả về { [taskId]: [attachment, ...] } cho danh sách nhiệm vụ.
async function listTaskAttachmentsByTaskIds(taskIds) {
  const ids = [...new Set(taskIds.map(Number))].filter(Number.isFinite);
  if (ids.length === 0) return {};
  const [rows] = await requireDb().query(
    `SELECT ${ATTACHMENT_COLUMNS} FROM task_attachments
     WHERE task_id IN (?) ORDER BY id ASC`,
    [ids],
  );
  const grouped = {};
  for (const row of rows) {
    (grouped[Number(row.taskId)] ||= []).push(row);
  }
  return grouped;
}

async function findTaskAttachmentById(taskId, attachmentId) {
  const [rows] = await requireDb().query(
    `SELECT ${ATTACHMENT_COLUMNS} FROM task_attachments
     WHERE id = ? AND task_id = ? LIMIT 1`,
    [attachmentId, taskId],
  );
  return rows[0] || null;
}

// Khóa dòng nhiệm vụ để hai request song song không vượt quá giới hạn số file.
// Trả về { outcome: 'SAVED' | 'LIMIT' | 'NOT_FOUND', attachment? }
async function insertTaskAttachmentLimited(
  { taskId, originalName, storedName, mimeType, sizeBytes },
  maxCount,
) {
  return withTransaction(async (conn) => {
    const [tasks] = await conn.query(
      "SELECT id FROM intern_tasks WHERE id = ? FOR UPDATE",
      [taskId],
    );
    if (tasks.length === 0) return { outcome: "NOT_FOUND" };

    const [[{ total }]] = await conn.query(
      "SELECT COUNT(*) AS total FROM task_attachments WHERE task_id = ?",
      [taskId],
    );
    if (Number(total) >= maxCount) return { outcome: "LIMIT" };

    const [result] = await conn.query(
      `INSERT INTO task_attachments
         (task_id, original_name, stored_name, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?)`,
      [taskId, originalName, storedName, mimeType, sizeBytes],
    );
    // Gắn thời điểm cập nhật để mentor thấy có hoạt động mới.
    await conn.query(
      "UPDATE intern_tasks SET progress_updated_at = NOW() WHERE id = ?",
      [taskId],
    );
    const [rows] = await conn.query(
      `SELECT ${ATTACHMENT_COLUMNS} FROM task_attachments WHERE id = ?`,
      [result.insertId],
    );
    return { outcome: "SAVED", attachment: rows[0] };
  });
}

async function deleteTaskAttachment(taskId, attachmentId) {
  const [result] = await requireDb().query(
    "DELETE FROM task_attachments WHERE id = ? AND task_id = ?",
    [attachmentId, taskId],
  );
  return result.affectedRows;
}

async function deleteInternTask(id) {
  const [result] = await requireDb().query(
    "DELETE FROM intern_tasks WHERE id = ?",
    [id],
  );
  return result.affectedRows;
}

async function listScheduleMilestones(internId) {
  const [rows] = await requireDb().query(
    `SELECT id, intern_id AS internId, phase_order AS phaseOrder, title,
            start_date AS startDate, end_date AS endDate, duration_weeks AS durationWeeks,
            description, expected_results AS expectedResults, status,
            created_at AS createdAt, updated_at AS updatedAt
     FROM intern_schedules
     WHERE intern_id = ?
     ORDER BY phase_order ASC, start_date ASC, id ASC`,
    [internId],
  );
  return rows;
}

async function insertScheduleMilestone(internId, milestone) {
  const [result] = await requireDb().query(
    `INSERT INTO intern_schedules (intern_id, phase_order, title, start_date, end_date, duration_weeks, description, expected_results, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      internId,
      milestone.phase_order || 1,
      milestone.title,
      milestone.start_date || null,
      milestone.end_date || null,
      milestone.duration_weeks || null,
      milestone.description || null,
      milestone.expected_results || null,
      milestone.status || "NOT_STARTED",
    ],
  );
  return result.insertId;
}

async function insertScheduleMilestonesAtomic(internId, milestones) {
  return withTransaction(async (conn) => {
    const ids = [];
    for (const milestone of milestones) {
      const [result] = await conn.query(
        `INSERT INTO intern_schedules (intern_id, phase_order, title, start_date, end_date, duration_weeks, description, expected_results, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          internId,
          milestone.phase_order,
          milestone.title,
          milestone.start_date || null,
          milestone.end_date || null,
          milestone.duration_weeks || null,
          milestone.description || null,
          milestone.expected_results || null,
          milestone.status || "NOT_STARTED",
        ],
      );
      ids.push(result.insertId);
    }
    return ids;
  });
}

async function updateScheduleMilestone(internId, milestoneId, milestone) {
  const [result] = await requireDb().query(
    `UPDATE intern_schedules
     SET phase_order = COALESCE(?, phase_order),
         title = COALESCE(?, title),
         start_date = COALESCE(?, start_date),
         end_date = COALESCE(?, end_date),
         duration_weeks = COALESCE(?, duration_weeks),
         description = COALESCE(?, description),
         expected_results = COALESCE(?, expected_results),
         status = COALESCE(?, status)
     WHERE id = ? AND intern_id = ?`,
    [
      milestone.phase_order,
      milestone.title,
      milestone.start_date,
      milestone.end_date,
      milestone.duration_weeks,
      milestone.description,
      milestone.expected_results,
      milestone.status,
      milestoneId,
      internId,
    ],
  );
  return result.affectedRows > 0;
}

async function deleteScheduleMilestone(internId, milestoneId) {
  const [result] = await requireDb().query(
    `DELETE FROM intern_schedules WHERE id = ? AND intern_id = ?`,
    [milestoneId, internId],
  );
  return result.affectedRows > 0;
}

async function findMilestoneById(milestoneId) {
  const [rows] = await requireDb().query(
    `SELECT id, intern_id AS internId, phase_order AS phaseOrder, title,
            start_date AS startDate, end_date AS endDate, duration_weeks AS durationWeeks,
            description, expected_results AS expectedResults, status,
            created_at AS createdAt, updated_at AS updatedAt
     FROM intern_schedules WHERE id = ? LIMIT 1`,
    [milestoneId],
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
         (intern_id, title, start_date, end_date, note, program_id, original_name,
          stored_name, mime_type, size_bytes, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        contract.internId,
        contract.title,
        contract.startDate,
        contract.endDate,
        contract.note,
        contract.programId || null,
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

// Chỉ cho sửa chương trình và khoảng ngày hợp đồng (không đổi file/tiêu đề);
// cho phép cả hợp đồng đã xác nhận (đổi ngày thì phải xác nhận lại). `changes` dùng khóa camelCase.
const CONTRACT_UPDATABLE_COLUMNS = {
  programId: "program_id",
  startDate: "start_date",
  endDate: "end_date",
};

async function updateContractFields(internId, contractId, changes) {
  const keys = Object.keys(changes).filter((key) =>
    Object.hasOwn(CONTRACT_UPDATABLE_COLUMNS, key),
  );
  if (keys.length === 0) return findContractById(internId, contractId);

  const assignments = keys.map((key) => `${CONTRACT_UPDATABLE_COLUMNS[key]} = ?`);
  // Đổi điều khoản (ngày) của hợp đồng đã xác nhận -> đưa về chờ xác nhận lại.
  if (changes.resetConfirmation) {
    assignments.push(
      "confirmation_status = 'PENDING'",
      "confirmed_at = NULL",
      "confirmed_by = NULL",
    );
  }
  const [result] = await requireDb().query(
    `UPDATE internship_contracts SET ${assignments.join(", ")}
     WHERE id = ? AND intern_id = ?`,
    [...keys.map((key) => changes[key]), contractId, internId],
  );
  if (result.affectedRows === 0) return null;
  return findContractById(internId, contractId);
}

// Thực tập sinh đã có ít nhất 1 hợp đồng được xác nhận chưa (điều kiện giao việc / nộp báo cáo / đánh giá).
async function hasConfirmedContract(internId) {
  const [rows] = await requireDb().query(
    `SELECT 1 FROM internship_contracts
     WHERE intern_id = ? AND confirmation_status = 'CONFIRMED' LIMIT 1`,
    [internId],
  );
  return rows.length > 0;
}

// Số hợp đồng gắn với chương trình nhưng nằm ngoài khoảng ngày [startDate, endDate] (null = không giới hạn).
async function countContractsOutsideProgramRange(programId, startDate, endDate) {
  const [rows] = await requireDb().query(
    `SELECT COUNT(*) AS n FROM internship_contracts
     WHERE program_id = ?
       AND ((? IS NOT NULL AND start_date IS NOT NULL AND start_date < ?)
         OR (? IS NOT NULL AND end_date IS NOT NULL AND end_date > ?))`,
    [programId, startDate, startDate, endDate, endDate],
  );
  return Number(rows[0].n);
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

async function listDepartments() {
  const [rows] = await requireDb().query(
    "SELECT id, name, description, created_at FROM departments ORDER BY name",
  );
  return rows;
}

async function findDepartmentByName(name) {
  const [rows] = await requireDb().query(
    "SELECT id, name, description, created_at FROM departments WHERE name = ? LIMIT 1",
    [name],
  );
  return rows[0] || null;
}

async function findDepartmentById(id) {
  const [rows] = await requireDb().query(
    "SELECT id, name FROM departments WHERE id = ? LIMIT 1",
    [id],
  );
  return rows[0] || null;
}

async function insertDepartment({ name, description }) {
  const [result] = await requireDb().query(
    "INSERT INTO departments (name, description) VALUES (?, ?)",
    [name, description || null],
  );
  return findDepartmentById(result.insertId);
}

async function deleteDepartment(id) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      "SELECT id FROM departments WHERE id = ? FOR UPDATE",
      [id],
    );
    if (!rows.length) return "NOT_FOUND";
    const [programs] = await conn.query(
      "SELECT id FROM internship_programs WHERE department_id = ? LIMIT 1",
      [id],
    );
    if (programs.length) return "IN_USE";
    await conn.query("DELETE FROM departments WHERE id = ?", [id]);
    return "DELETED";
  });
}
const PROGRAM_SELECT = `SELECT p.id, p.department_id, d.name AS department_name, p.name, p.description,
  p.start_date, p.end_date, p.capacity, p.status, p.created_by, p.created_at, p.updated_at
  FROM internship_programs p JOIN departments d ON d.id = p.department_id`;
async function listPrograms({ departmentId, status } = {}) {
  const where = [];
  const values = [];

  if (departmentId) {
    where.push("p.department_id = ?");
    values.push(departmentId);
  }
  if (status) {
    where.push("p.status = ?");
    values.push(status);
  }

  const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const [rows] = await requireDb().query(
    `${PROGRAM_SELECT}${whereSql} ORDER BY p.created_at DESC, p.id DESC`,
    values,
  );
  return rows;
}

async function findProgramById(id) {
  const [rows] = await requireDb().query(
    `${PROGRAM_SELECT} WHERE p.id = ? LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}
async function saveProgramAtomic(value, { id = null, createdBy = null } = {}) {
  const conn = await requireDb().getConnection();
  let lockAcquired = false;
  let transactionOpen = false;

  try {
    await conn.beginTransaction();
    transactionOpen = true;

    if (id != null) {
      const [existing] = await conn.query(
        "SELECT id FROM internship_programs WHERE id = ? FOR UPDATE",
        [id],
      );
      if (existing.length === 0) {
        await conn.rollback();
        transactionOpen = false;
        return { outcome: "NOT_FOUND" };
      }
    }

    // Serialize writes for the same department/name until the transaction commits.
    const [lockRows] = await conn.query(
      "SELECT GET_LOCK(CONCAT('program:', ?, ':', MD5(LOWER(?))), 10) AS acquired",
      [value.departmentId, value.name],
    );
    lockAcquired = Number(lockRows[0]?.acquired) === 1;
    if (!lockAcquired) {
      await conn.rollback();
      transactionOpen = false;
      return { outcome: "LOCK_TIMEOUT" };
    }

    const [duplicates] = await conn.query(
      `SELECT id FROM internship_programs
       WHERE department_id = ? AND LOWER(name) = LOWER(?)
         AND (end_date IS NULL OR ? IS NULL OR end_date >= ?)
         AND (start_date IS NULL OR ? IS NULL OR start_date <= ?)
         AND (? IS NULL OR id <> ?)
       LIMIT 1 FOR UPDATE`,
      [
        value.departmentId,
        value.name,
        value.startDate,
        value.startDate,
        value.endDate,
        value.endDate,
        id,
        id,
      ],
    );
    if (duplicates.length > 0) {
      await conn.rollback();
      transactionOpen = false;
      return { outcome: "DUPLICATE" };
    }

    if (id == null) {
      const [result] = await conn.query(
        `INSERT INTO internship_programs
          (department_id, name, description, start_date, end_date, capacity, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          value.departmentId,
          value.name,
          value.description || null,
          value.startDate,
          value.endDate,
          value.capacity,
          value.status,
          createdBy,
        ],
      );
      id = result.insertId;
    } else {
      await conn.query(
        `UPDATE internship_programs
         SET department_id = ?, name = ?, description = ?, start_date = ?,
             end_date = ?, capacity = ?, status = ?
         WHERE id = ?`,
        [
          value.departmentId,
          value.name,
          value.description || null,
          value.startDate,
          value.endDate,
          value.capacity,
          value.status,
          id,
        ],
      );
    }

    await conn.commit();
    transactionOpen = false;
    return { outcome: "SAVED", id };
  } catch (err) {
    if (transactionOpen) await conn.rollback();
    throw err;
  } finally {
    if (lockAcquired) {
      try {
        await conn.query(
          "SELECT RELEASE_LOCK(CONCAT('program:', ?, ':', MD5(LOWER(?))))",
          [value.departmentId, value.name],
        );
      } catch {
        // Closing a broken connection releases its named locks automatically.
      }
    }
    conn.release();
  }
}
async function deleteProgram(id) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      "SELECT status FROM internship_programs WHERE id = ? FOR UPDATE",
      [id],
    );
    if (!rows.length) return "NOT_FOUND";
    if (rows[0].status === "ONGOING") return "ONGOING";
    await conn.query("DELETE FROM internship_programs WHERE id = ?", [id]);
    return "DELETED";
  });
}

// Số liệu tổng quan cho tab Báo cáo & Thống kê: toàn bộ lấy từ dữ liệu thật trong DB.
async function getOverviewStats() {
  const db = requireDb();
  const [[applications]] = await db.query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(status = 'Chờ duyệt'), 0) AS pending,
            COALESCE(SUM(status = 'Đã duyệt'), 0) AS approved,
            COALESCE(SUM(status = 'Từ chối'), 0) AS rejected
       FROM candidate_profiles`,
  );
  const [[interns]] = await db.query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(mentor_id IS NOT NULL), 0) AS assigned
       FROM intern_profiles`,
  );
  const [[contracts]] = await db.query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(confirmation_status = 'CONFIRMED'), 0) AS confirmed
       FROM internship_contracts`,
  );
  return {
    applications: {
      total: Number(applications.total),
      pending: Number(applications.pending),
      approved: Number(applications.approved),
      rejected: Number(applications.rejected),
    },
    interns: {
      total: Number(interns.total),
      assigned: Number(interns.assigned),
    },
    contracts: {
      total: Number(contracts.total),
      confirmed: Number(contracts.confirmed),
    },
  };
}

module.exports = {
  initDatabase,
  getPool,
  seedDepartmentsFromMentors,
  backfillInternMentorIds,
  closePool,
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
  getStudentsForMentorEmail,
  getInternFilterOptions,
  countInterns,
  assignInternMentor,
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
  updateContractFields,
  confirmContractAtomic,
  listDepartments,
  findDepartmentByName,
  findDepartmentById,
  insertDepartment,
  deleteDepartment,
  listPrograms,
  findProgramById,
  saveProgramAtomic,
  deleteProgram,
  findMentorById,
  findMentorByEmail,
  insertInternTask,
  findInternTaskById,
  listInternTasksForMentor,
  listInternTasksForIntern,
  updateInternTask,
  updateInternTaskProgress,
  deleteInternTask,
  listTaskAttachmentsByTaskIds,
  findTaskAttachmentById,
  insertTaskAttachmentLimited,
  deleteTaskAttachment,
  findInternContractPeriod,
  listInternsWithPeriodForMentor,
  findWeeklyReportById,
  findWeeklyReportByWeek,
  upsertWeeklyReport,
  listWeeklyReportsForIntern,
  listWeeklyReportsForMentor,
  listWeeklyReportAttachmentsByReportIds,
  findWeeklyReportAttachmentById,
  insertWeeklyReportAttachmentLimited,
  deleteWeeklyReportAttachment,
  upsertWeeklyReportFeedback,
  deleteWeeklyReportFeedback,
  reapplyRejectedCandidate,
  hasConfirmedContract,
  countContractsOutsideProgramRange,
  getServerDateTime,
  findAttendanceByInternDate,
  findAttendanceById,
  findOpenAttendance,
  hasConfirmedContractOn,
  requestAttendanceCorrection,
  reviewAttendanceCorrection,
  listPendingAttendanceCorrections,
  insertAttendance,
  checkOutAttendance,
  listAttendance,
  listFinalReportInterns,
  getFinalReportFilterOptions,
  createFinalReport,
  listFinalReports,
  findFinalReportById,
  updateFinalReport,
  finalizeFinalReport,
  deleteFinalReport,
  recordFinalReportSend,
  listFinalReportSends,
  upsertFinalReportRecipients,
  listFinalReportRecipients,
  deleteFinalReportRecipient,
  findInternEvaluation,
  upsertInternEvaluation,
  deleteInternEvaluation,
  listEvaluationsForMentor,
  listScheduleMilestones,
  insertScheduleMilestone,
  insertScheduleMilestonesAtomic,
  updateScheduleMilestone,
  deleteScheduleMilestone,
  findMilestoneById,
  getOverviewStats,
};
