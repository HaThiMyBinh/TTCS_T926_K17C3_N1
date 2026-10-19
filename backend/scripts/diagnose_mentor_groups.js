// Chẩn đoán lỗi trang "Nhóm của tôi" của mentor (GET /me/groups).
// Chỉ ĐỌC dữ liệu, không tạo/sửa bảng nào. Chạy trong thư mục backend:
//   node scripts/diagnose_mentor_groups.js                 -> liệt kê mentor
//   node scripts/diagnose_mentor_groups.js mentor@mail.com -> chạy đúng truy vấn của trang
const mysql = require("mysql2/promise");
const db = require("../db");
const { VIETNAM_UTC_OFFSET } = require("../utils/date");
const { readDbConfig } = require("../utils/dbConfig");
const { mentorGroups } = require("../services/structure.service");

// Bảng và cột mà truy vấn nhóm của mentor đọc.
const REQUIRED = {
  group_members: [
    "group_id",
    "intern_id",
    "is_primary",
    "joined_at",
    "left_at",
  ],
  program_groups: ["id", "program_id", "name", "description"],
  internship_programs: ["id", "name", "status", "start_date", "end_date"],
  intern_profiles: [
    "id",
    "full_name",
    "email",
    "phone",
    "student_code",
    "university",
    "major",
    "status",
    "mentor_id",
  ],
  intern_tasks: ["intern_id", "status", "progress_percent"],
  weekly_reports: ["intern_id", "week_start", "is_late"],
  attendance_records: [
    "intern_id",
    "work_date",
    "check_in_at",
    "check_out_at",
    "correction_status",
  ],
  meetings: [
    "id",
    "title",
    "location",
    "meeting_link",
    "status",
    "start_at",
    "end_at",
    "group_id",
  ],
  meeting_attendees: ["meeting_id", "intern_id"],
};

async function main() {
  const options = readDbConfig();
  let pool;
  try {
    pool = mysql.createPool({
      ...options,
      dateStrings: ["DATE"],
      timezone: VIETNAM_UTC_OFFSET,
    });
    pool.on("connection", (c) =>
      c.query(`SET time_zone = '${VIETNAM_UTC_OFFSET}'`),
    );
    await pool.query("SELECT 1");
  } catch (err) {
    console.error(`KHÔNG KẾT NỐI ĐƯỢC MySQL (${err.code || err.message}).`);
    console.error("Kiểm tra MySQL đang chạy và backend/db_config.json.");
    process.exitCode = 1;
    return;
  }

  try {
    // 1) Thiếu bảng / cột?
    console.log("== 1. Kiểm tra bảng và cột ==");
    let missing = 0;
    for (const [table, columns] of Object.entries(REQUIRED)) {
      const [rows] = await pool.query(
        "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
        [options.database, table],
      );
      if (!rows.length) {
        console.log(`  THIẾU BẢNG: ${table}`);
        missing += 1;
        continue;
      }
      const have = new Set(rows.map((r) => r.c));
      for (const col of columns)
        if (!have.has(col)) {
          console.log(`  THIẾU CỘT: ${table}.${col}`);
          missing += 1;
        }
    }
    if (!missing) console.log("  Đủ bảng và cột.");

    // 2) Chọn mentor
    const email = process.argv[2];
    const [mentors] = await pool.query(
      "SELECT id, full_name AS fullName, email FROM mentors ORDER BY id",
    );
    if (!email) {
      console.log(
        "\n== 2. Danh sách mentor (chạy lại kèm email để thử truy vấn) ==",
      );
      for (const m of mentors)
        console.log(`  ${m.id}\t${m.email}\t${m.fullName}`);
      return;
    }
    const mentor = mentors.find(
      (m) => String(m.email).toLowerCase() === email.toLowerCase(),
    );
    if (!mentor) {
      console.error(`\nKhông có mentor nào với email ${email}.`);
      process.exitCode = 1;
      return;
    }

    // 3) Chạy đúng hàm của trang
    console.log(
      `\n== 3. Chạy mentorGroups cho ${mentor.fullName} (id ${mentor.id}) ==`,
    );
    db.getPool = () => pool; // structure.service gọi db.getPool() mỗi lần chạy
    try {
      const groups = await mentorGroups({
        ...mentor,
        full_name: mentor.fullName,
      });
      console.log(`  OK: ${groups.length} nhóm.`);
      for (const g of groups)
        console.log(
          `   - ${g.name} (${g.programName}): ${g.memberCount} thực tập sinh`,
        );
    } catch (err) {
      console.error("  LỖI THẬT SỰ:");
      console.error(`   code      : ${err.code || "(không có)"}`);
      console.error(`   sqlMessage: ${err.sqlMessage || err.message}`);
      if (err.sql)
        console.error(
          `   câu SQL   : ${String(err.sql).replace(/\s+/g, " ").slice(0, 300)}`,
        );
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
