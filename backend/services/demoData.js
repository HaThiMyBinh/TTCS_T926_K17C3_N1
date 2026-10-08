// Gói demo: xuất / nạp "ảnh chụp" dữ liệu (DB + file upload) để gửi cho người khác xem.
//
//   demo/demo_data.json   <- bản ghi của các bảng (không gồm roles/permissions, do db.js tự seed)
//   demo/uploads/<UUID>   <- các file được bản ghi tham chiếu
//
// - exportDemo(pool): chạy trên máy BẠN (npm run demo:export) để tạo/ cập nhật thư mục demo/
// - loadDemoIfNeeded(pool): chạy tự động lúc server khởi động trên máy người nhận
//   (mỗi bản export chỉ được nạp 1 lần; nạp lại chỉ khi bạn export bản mới)
const fs = require("fs");
const path = require("path");
const fileStorage = require("./fileStorage");
const { VIETNAM_TIME_ZONE } = require("../utils/date");

const DEMO_DIR = path.resolve(__dirname, "..", "..", "demo");
const SNAPSHOT_FILE = path.join(DEMO_DIR, "demo_data.json");
const DEMO_UPLOADS_DIR = path.join(DEMO_DIR, "uploads");

// Thứ tự cha -> con (xóa thì đi ngược lại)
const TABLES = [
  "departments",
  "users",
  "candidate_profiles",
  "mentors",
  "intern_profiles",
  "application_documents",
  "internship_contracts",
  "internship_programs",
  "intern_schedules",
  "intern_tasks",
  "task_attachments",
  "weekly_reports",
  "weekly_report_attachments",
  "weekly_report_feedback",
  "attendance_logs",
];
const FILE_TABLES = [
  "application_documents",
  "internship_contracts",
  "task_attachments",
  "weekly_report_attachments",
];
const DATE_ONLY_COLUMNS = new Set([
  "start_date",
  "end_date",
  "due_date",
  "week_start",
  "work_date",
]);
const COLUMN_NAME_REGEX = /^[A-Za-z0-9_]+$/;

const vietnamPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: VIETNAM_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

// Date -> chuỗi MySQL theo giờ Việt Nam (khớp múi giờ của pool), tránh định dạng ISO có "T...Z"
function serializeValue(column, value) {
  if (!(value instanceof Date)) return value;
  const f = Object.fromEntries(
    vietnamPartsFormatter
      .formatToParts(value)
      .map(({ type, value: v }) => [type, v]),
  );
  const date = `${f.year}-${f.month}-${f.day}`;
  if (DATE_ONLY_COLUMNS.has(column)) return date;
  return `${date} ${f.hour}:${f.minute}:${f.second}`;
}

function serializeRow(row) {
  const out = {};
  for (const [col, val] of Object.entries(row))
    out[col] = serializeValue(col, val);
  return out;
}

function referencedStoredNames(tables) {
  const names = new Set();
  for (const t of FILE_TABLES) {
    for (const row of tables[t] || []) {
      if (row.stored_name) names.add(row.stored_name);
    }
  }
  return names;
}

// ---------- XUẤT (máy của bạn) ----------
async function exportDemo(pool) {
  const tables = {};
  for (const t of TABLES) {
    const [rows] = await pool.query(`SELECT * FROM \`${t}\` ORDER BY id`);
    tables[t] = rows.map(serializeRow);
  }

  fs.mkdirSync(DEMO_UPLOADS_DIR, { recursive: true });
  // Làm sạch file cũ trong demo/uploads để không còn file mồ côi
  for (const f of fs.readdirSync(DEMO_UPLOADS_DIR)) {
    const p = path.join(DEMO_UPLOADS_DIR, f);
    if (fs.statSync(p).isFile()) fs.unlinkSync(p);
  }

  let copied = 0;
  const missing = [];
  for (const storedName of referencedStoredNames(tables)) {
    let src;
    try {
      src = fileStorage.resolveStoredPath(storedName);
    } catch {
      missing.push(storedName);
      continue;
    }
    if (!fs.existsSync(src)) {
      missing.push(storedName);
      continue;
    }
    fs.copyFileSync(src, path.join(DEMO_UPLOADS_DIR, path.basename(src)));
    copied++;
  }

  const snapshot = {
    version: 1,
    exportedAt: new Date().toISOString(),
    tables,
  };
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), "utf8");

  const counts = Object.fromEntries(TABLES.map((t) => [t, tables[t].length]));
  return {
    exportedAt: snapshot.exportedAt,
    counts,
    copiedFiles: copied,
    missingFiles: missing,
  };
}

// ---------- NẠP (máy người nhận, tự chạy lúc khởi động) ----------
function copyDemoFiles(tables) {
  let copied = 0;
  for (const storedName of referencedStoredNames(tables)) {
    try {
      const dest = fileStorage.resolveStoredPath(storedName); // kiểm tra UUID hợp lệ
      const src = path.join(DEMO_UPLOADS_DIR, path.basename(dest));
      if (!fs.existsSync(src)) {
        console.warn(
          `[DEMO] Thiếu file ${storedName} trong demo/uploads, bỏ qua.`,
        );
        continue;
      }
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        copied++;
      }
    } catch (err) {
      console.warn(
        `[DEMO] Bỏ qua file không hợp lệ '${storedName}': ${err.message}`,
      );
    }
  }
  return copied;
}

async function loadDemoIfNeeded(pool) {
  if (process.env.SKIP_DEMO === "1" || process.env.NODE_ENV === "production") {
    return false;
  }
  if (!fs.existsSync(SNAPSHOT_FILE)) return false; // không có gói demo -> chạy bình thường

  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
  } catch (err) {
    console.warn(`[DEMO] Không đọc được demo_data.json: ${err.message}`);
    return false;
  }
  const tables = snapshot && snapshot.tables;
  const snapshotId = snapshot && snapshot.exportedAt;
  if (!tables || !snapshotId) {
    console.warn("[DEMO] demo_data.json sai định dạng, bỏ qua.");
    return false;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`demo_import_log\` (
      \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
      \`snapshot_id\` VARCHAR(64) NOT NULL UNIQUE,
      \`loaded_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  const [done] = await pool.query(
    "SELECT 1 FROM demo_import_log WHERE snapshot_id = ? LIMIT 1",
    [snapshotId],
  );
  if (done.length > 0) return false; // bản demo này đã nạp rồi

  const copiedFiles = copyDemoFiles(tables);

  const conn = await pool.getConnection();
  try {
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    await conn.beginTransaction();

    // Thay toàn bộ dữ liệu bằng bản demo để id/khóa ngoại khớp tuyệt đối
    await conn.query("DELETE FROM `email_logs`");
    for (const t of [...TABLES].reverse()) {
      await conn.query(`DELETE FROM \`${t}\``);
    }

    for (const t of TABLES) {
      const rows = tables[t] || [];
      if (rows.length === 0) continue;
      const cols = Object.keys(rows[0]);
      if (!cols.every((c) => COLUMN_NAME_REGEX.test(c))) {
        throw new Error(`Tên cột không hợp lệ trong bảng ${t}`);
      }
      const colSql = cols.map((c) => `\`${c}\``).join(", ");
      await conn.query(`INSERT INTO \`${t}\` (${colSql}) VALUES ?`, [
        rows.map((r) => cols.map((c) => r[c])),
      ]);
    }

    await conn.query("INSERT INTO demo_import_log (snapshot_id) VALUES (?)", [
      snapshotId,
    ]);
    await conn.commit();
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // bỏ qua lỗi rollback; lỗi gốc được ném ngay bên dưới
    }
    throw err;
  } finally {
    try {
      await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    } catch {
      // kết nối hỏng thì pool sẽ tự bỏ
    }
    conn.release();
  }

  const summary = TABLES.map((t) => `${t}=${(tables[t] || []).length}`).join(
    ", ",
  );
  console.log(
    `[DEMO] Đã nạp dữ liệu demo (${summary}); copy ${copiedFiles} file vào uploads/.`,
  );
  return true;
}

module.exports = { exportDemo, loadDemoIfNeeded, DEMO_DIR };
