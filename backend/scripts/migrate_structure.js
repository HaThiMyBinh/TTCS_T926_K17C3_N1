// Chạy trên DB đã sao lưu trước khi nâng cấp: thêm nhóm trong chương trình, lịch sử phân công mentor,
// lịch sử đăng ký chương trình, người tham gia lịch và phạm vi GROUP. Chỉ thêm mới; mentor hiện có được
// ghi thành phân công đang mở (không suy diễn lịch sử cũ).
const mysql = require("mysql2/promise");
const { migrateStructure } = require("../migrations/structureMigration");
const { readDbConfig } = require("../utils/dbConfig");
async function main() {
  const conn = await mysql.createConnection(readDbConfig());
  try {
    await migrateStructure(conn);
    const [[count]] = await conn.query(
      "SELECT COUNT(*) AS open FROM mentor_assignments WHERE effective_to IS NULL",
    );
    console.log(
      `Cấu trúc nhóm/mentor đã sẵn sàng. Phân công mentor đang mở: ${count.open}.`,
    );
  } finally {
    await conn.end();
  }
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
