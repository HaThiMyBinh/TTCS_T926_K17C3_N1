// Chỉ đọc: kiểm tra intern_profiles.mentor_id có khớp phân công đang mở của mentor_assignments không.
// Thoát với mã 1 nếu có lệch (dùng được trong CI/cron). Thêm --fix để đồng bộ lại lịch sử từ intern_profiles.mentor_id.
const mysql = require("mysql2/promise");
const { VIETNAM_UTC_OFFSET } = require("../utils/date");
const { readDbConfig } = require("../utils/dbConfig");
const {
  findMentorAssignmentDrift,
  reconcileMentorHistory,
} = require("../migrations/structureMigration");
async function main() {
  const conn = await mysql.createConnection(readDbConfig());
  try {
    await conn.query("SET time_zone = ?", [VIETNAM_UTC_OFFSET]);
    let drift = await findMentorAssignmentDrift(conn);
    if (drift.length && process.argv.includes("--fix")) {
      console.log(`Đồng bộ lại ${drift.length} thực tập sinh bị lệch...`);
      drift = (await reconcileMentorHistory(conn)).after;
    }
    if (!drift.length) {
      console.log("OK: intern_profiles.mentor_id khớp mentor_assignments.");
      return;
    }
    console.error(`LỆCH ${drift.length} thực tập sinh:`);
    for (const r of drift)
      console.error(
        `  intern ${r.internId}: mentor_id=${r.currentMentorId ?? "NULL"}, phân công mở=${r.openAssignmentId ?? "không có"} (mentor ${r.openMentorId ?? "NULL"})`,
      );
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
