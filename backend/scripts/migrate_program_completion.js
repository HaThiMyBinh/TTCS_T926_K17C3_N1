// Run against a backed-up database before deploying US6 per-program results.
// This command adds missing columns only; no account seeding or record updates.
const mysql = require("mysql2/promise");
const fs = require("node:fs");
const path = require("node:path");
const {
  migrateProgramCompletion,
} = require("../services/programCompletionMigration");
async function main() {
  const file = path.join(__dirname, "../db_config.json");
  const cfg = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : {};
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || cfg.host || "localhost",
    port: Number(process.env.DB_PORT || cfg.port || 3306),
    user: process.env.DB_USER || cfg.user || "root",
    password: process.env.DB_PASSWORD ?? cfg.password ?? "",
    database: process.env.DB_NAME || cfg.database || "user_management",
  });
  try {
    await migrateProgramCompletion(conn);
    console.log(
      "Program completion columns are ready; existing results were not inferred or rewritten.",
    );
    const [[warnings]] =
      await conn.query(`SELECT COUNT(*) AS overlappingMemberships FROM program_interns pi
      JOIN internship_programs p ON p.id=pi.program_id WHERE EXISTS (
        SELECT 1 FROM program_interns other JOIN internship_programs q ON q.id=other.program_id
        WHERE other.intern_id=pi.intern_id AND other.program_id<>pi.program_id
        AND (p.start_date IS NULL OR p.end_date IS NULL OR q.start_date IS NULL OR q.end_date IS NULL
          OR p.start_date<=q.end_date AND p.end_date>=q.start_date))`);
    console.log(
      "Existing memberships needing schedule review:",
      Number(warnings.overlappingMemberships),
    );
  } finally {
    await conn.end();
  }
}
main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
