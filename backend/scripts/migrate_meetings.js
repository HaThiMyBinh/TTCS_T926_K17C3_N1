// Additive US8 migration only: does not load demo data or modify uploads.
const mysql = require("mysql2/promise");
const { migrateMeetings } = require("../migrations/meetingsMigration");
const { readDbConfig } = require("../utils/dbConfig");
async function main() {
  const conn = await mysql.createConnection(readDbConfig());
  try {
    await migrateMeetings(conn);
    console.log(
      "US8 meeting tables and email log extensions are ready; existing records preserved.",
    );
  } finally {
    await conn.end();
  }
}
main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
