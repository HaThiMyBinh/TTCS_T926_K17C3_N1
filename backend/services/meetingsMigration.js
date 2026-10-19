// Additive, repeatable, serialized across application instances. Does not seed or rewrite records.
const MEETINGS_SQL = `CREATE TABLE IF NOT EXISTS meetings (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 title VARCHAR(200) NOT NULL, description TEXT NULL,
 start_at DATETIME NOT NULL, end_at DATETIME NOT NULL,
 location VARCHAR(255) NULL, meeting_link VARCHAR(1000) NULL,
 organizer_user_id BIGINT NULL, program_id BIGINT NULL,
 status ENUM('SCHEDULED','CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
 sequence INT UNSIGNED NOT NULL DEFAULT 0, request_key VARCHAR(64) NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_meeting_request (organizer_user_id,request_key),
 INDEX idx_meeting_start_status (status,start_at),
 CONSTRAINT fk_meeting_organizer FOREIGN KEY (organizer_user_id) REFERENCES users(id) ON DELETE SET NULL,
 CONSTRAINT fk_meeting_program FOREIGN KEY (program_id) REFERENCES internship_programs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
const ATTENDEES_SQL = `CREATE TABLE IF NOT EXISTS meeting_attendees (
 meeting_id BIGINT NOT NULL, intern_id BIGINT NOT NULL,
 PRIMARY KEY (meeting_id,intern_id), INDEX idx_meeting_attendee_intern(intern_id,meeting_id),
 CONSTRAINT fk_meeting_attendee_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
 CONSTRAINT fk_meeting_attendee_intern FOREIGN KEY (intern_id) REFERENCES intern_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
const LOG_COLUMNS = {
  meeting_id: "BIGINT NULL",
  intern_id: "BIGINT NULL",
  payload_json: "LONGTEXT NULL",
  event_key: "VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL",
  notification_pending: "TINYINT NOT NULL DEFAULT 0",
  processing_token: "CHAR(36) NULL",
  processing_until: "DATETIME NULL",
  next_attempt_at: "DATETIME NULL",
};
const TYPES = [
  "MEETING_INVITE",
  "MEETING_UPDATED",
  "MEETING_CANCELLED",
  "MEETING_REMINDER",
];
async function migrateMeetings(database) {
  const own = typeof database.getConnection === "function",
    conn = own ? await database.getConnection() : database;
  let locked = false;
  try {
    const [[result]] = await conn.query(
      "SELECT GET_LOCK(CONCAT('us8:', LEFT(DATABASE(),55)),30) AS acquired",
    );
    if (result.acquired !== 1)
      throw new Error("Không lấy được khóa migration lịch họp");
    locked = true;
    await conn.query(MEETINGS_SQL);
    await conn.query(ATTENDEES_SQL);
    const [columns] = await conn.query(
      "SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='email_logs'",
    );
    const type = columns.find((c) => c.COLUMN_NAME === "email_type");
    if (!type || !/^enum\(/i.test(type.COLUMN_TYPE))
      throw new Error("email_logs.email_type phải là ENUM trước khi migration");
    const existing = [...type.COLUMN_TYPE.matchAll(/'((?:[^']|'')*)'/g)].map(
      (m) => m[1].replace(/''/g, "'"),
    );
    if (TYPES.some((t) => !existing.includes(t))) {
      const quote = (s) => "'" + String(s).replace(/'/g, "''") + "'";
      const values = [...new Set([...existing, ...TYPES])].map(quote).join(",");
      const nullable = type.IS_NULLABLE === "YES" ? "NULL" : "NOT NULL";
      const fallback =
        type.COLUMN_DEFAULT == null
          ? nullable === "NULL"
            ? " DEFAULT NULL"
            : ""
          : " DEFAULT " + quote(type.COLUMN_DEFAULT);
      await conn.query(
        `ALTER TABLE email_logs MODIFY COLUMN email_type ENUM(${values}) ${nullable}${fallback}`,
      );
    }
    for (const [name, definition] of Object.entries(LOG_COLUMNS))
      if (!columns.some((c) => c.COLUMN_NAME === name))
        await conn.query(
          `ALTER TABLE email_logs ADD COLUMN ${name} ${definition}`,
        );
    const [indexes] = await conn.query("SHOW INDEX FROM email_logs");
    if (!indexes.some((i) => i.Key_name === "uq_email_event"))
      await conn.query(
        "ALTER TABLE email_logs ADD UNIQUE KEY uq_email_event(event_key)",
      );
    if (!indexes.some((i) => i.Key_name === "idx_email_meeting"))
      await conn.query(
        "ALTER TABLE email_logs ADD INDEX idx_email_meeting(meeting_id,id)",
      );
  } finally {
    if (locked)
      await conn.query(
        "SELECT RELEASE_LOCK(CONCAT('us8:', LEFT(DATABASE(),55)))",
      );
    if (own) conn.release();
  }
}
module.exports = {
  MEETINGS_SQL,
  ATTENDEES_SQL,
  LOG_COLUMNS,
  TYPES,
  migrateMeetings,
};
