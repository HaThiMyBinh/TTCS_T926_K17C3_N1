// Additive and repeatable. Never derives completion from intern_profiles.status.
const COLUMNS = {
  completion_status:
    "ENUM('IN_PROGRESS','COMPLETED','PAUSED','NOT_COMPLETED') NOT NULL DEFAULT 'IN_PROGRESS'",
  completed_at: "DATETIME NULL",
  completed_by: "BIGINT NULL",
  completion_note: "VARCHAR(500) NULL",
  result_updated_at: "DATETIME NULL",
  result_mentor_id: "BIGINT NULL",
  result_mentor_name: "VARCHAR(100) NULL",
};
async function migrateProgramCompletion(conn) {
  for (const [name, definition] of Object.entries(COLUMNS)) {
    const [rows] = await conn.query(
      "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='program_interns' AND COLUMN_NAME=?",
      [name],
    );
    if (rows.length) continue;
    try {
      await conn.query(
        `ALTER TABLE program_interns ADD COLUMN ${name} ${definition}`,
      );
    } catch (err) {
      if (err.code !== "ER_DUP_FIELDNAME") throw err;
    }
  }
}
module.exports = { COLUMNS, migrateProgramCompletion };
