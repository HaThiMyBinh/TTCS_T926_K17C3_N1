const assert = require("assert");
const mysql = require("mysql2/promise");
const db = require("../db");
const { readDbConfig } = require("./test_helpers");
(async () => {
  const conn = await mysql.createConnection(readDbConfig());
  const tables = [
    "users",
    "mentors",
    "intern_profiles",
    "candidate_profiles",
    "internship_contracts",
  ];
  async function snapshot() {
    const counts = {};
    for (const t of tables) {
      const [[row]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
      counts[t] = Number(row.n);
    }
    const [cols] = await conn.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='mentors' ORDER BY ORDINAL_POSITION",
    );
    const [mentors] = await conn.query(
      "SELECT id, department FROM mentors ORDER BY id",
    );
    return { counts, cols: cols.map((x) => x.COLUMN_NAME), mentors };
  }
  try {
    const before = await snapshot();
    await db.initDatabase();
    const [[firstDepartmentCount]] = await conn.query(
      "SELECT COUNT(*) AS n FROM departments",
    );
    await db.initDatabase();
    const [[secondDepartmentCount]] = await conn.query(
      "SELECT COUNT(*) AS n FROM departments",
    );
    const after = await snapshot();
    assert.deepEqual(
      after,
      before,
      "initDatabase phải giữ nguyên dữ liệu và cột cũ",
    );
    assert.equal(
      Number(firstDepartmentCount.n),
      Number(secondDepartmentCount.n),
      "khởi tạo lặp không tạo phòng ban trùng",
    );
    const [dups] = await conn.query(
      "SELECT LOWER(name) n, COUNT(*) c FROM departments GROUP BY LOWER(name) HAVING c>1",
    );
    assert.equal(
      dups.length,
      0,
      "departments không bị nhân đôi không phân biệt hoa thường",
    );
    console.log(
      "PROGRAM SAFETY PASS: counts, mentors.department và cột giữ nguyên; init idempotent",
    );
  } finally {
    await conn.end();
    await db.closePool();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
