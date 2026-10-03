// Chạy toàn bộ test bằng 1 lệnh (`npm test`): unit test -> kiểm tra MySQL -> tự bật backend (hoặc dùng backend
// đang chạy) -> chạy test API -> dọn dữ liệu -> tắt backend -> in tổng kết. Thoát mã 1 nếu có FAIL/SKIP.
//   --unit          chỉ unit test (không cần MySQL / backend)
//   --only <tên>    chỉ các bộ có tên chứa <tên> (lặp được nhiều lần)
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const BACKEND_DIR = path.join(__dirname, "..");
const TEST_PORT = Number(process.env.TEST_PORT) || 5000;
const TEST_BASE_URL = process.env.TEST_BASE_URL || `http://127.0.0.1:${TEST_PORT}/api`;
const HEALTH_URL = `${TEST_BASE_URL}/health`;
const SERVER_START_TIMEOUT_MS = 60000;
const TEST_SUITE_TIMEOUT_MS = Number(process.env.TEST_SUITE_TIMEOUT_MS) || 120000;
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

// needsServer: cần MySQL và backend
const SUITES = [
  { name: "email-unit", file: "test_email_unit.js", needsServer: false },
  { name: "upload-unit", file: "test_upload_unit.js", needsServer: false },
  { name: "contracts-unit", file: "test_contracts_unit.js", needsServer: false },
  { name: "contract-confirm-unit", file: "test_contract_confirmation_unit.js", needsServer: false },
  { name: "review-unit", file: "test_review_unit.js", needsServer: false },
  { name: "login", file: "test_login.js", needsServer: true },
  { name: "create-account", file: "test_create_account.js", needsServer: true },
  { name: "rbac", file: "test_rbac.js", needsServer: true },
  { name: "register", file: "test_register.js", needsServer: true },
  { name: "interns", file: "test_interns.js", needsServer: true },
  { name: "mentors", file: "test_mentors.js", needsServer: true },
  { name: "applications", file: "test_applications.js", needsServer: true },
  { name: "documents-api", file: "test_documents_api.js", needsServer: true },
  { name: "contracts-api", file: "test_contracts_api.js", needsServer: true },
  { name: "contract-confirm-api", file: "test_contract_confirm_api.js", needsServer: true },
  { name: "review-documents-api", file: "test_review_documents_api.js", needsServer: true },
  { name: "email-api", file: "test_email_api.js", needsServer: true },
];

const args = process.argv.slice(2);
const unitOnly = args.includes("--unit");
const onlyFilters = args.flatMap((a, i) => (a === "--only" && args[i + 1] ? [args[i + 1]] : []));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const line = (c = "=") => c.repeat(60);

async function isServerUp() {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

// Không chọn database vì backend tự tạo nếu chưa có
async function checkMysql() {
  const { readDbConfig } = require("./test_helpers");
  const mysql = require("mysql2/promise");
  const cfg = readDbConfig();
  try {
    const conn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      connectTimeout: 5000,
    });
    await conn.end();
    return null;
  } catch (e) {
    return `Không kết nối được MySQL tại ${cfg.host}:${cfg.port} (user ${cfg.user}): ${e.message}`;
  }
}

function runNode(file, extraArgs = [], timeoutMs = TEST_SUITE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [file, ...extraArgs], {
      cwd: BACKEND_DIR,
      stdio: "inherit",
      env: { ...process.env, TEST_BASE_URL },
    });
    let finished = false;
    const timer = setTimeout(() => {
      console.error(
        " Test " + path.basename(file) + " vượt quá " + Math.round(timeoutMs / 1000) + " giây; dừng tiến trình.",
      );
      child.kill();
      finish({ code: 124, timedOut: true, ms: Date.now() - started });
    }, timeoutMs);

    function finish(result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(result);
    }

    child.on("error", () =>
      finish({ code: 1, timedOut: false, ms: Date.now() - started }),
    );
    child.on("exit", (code) =>
      finish({ code: code ?? 1, timedOut: false, ms: Date.now() - started }),
    );
  });
}

function ensureDependencies() {
  if (fs.existsSync(path.join(BACKEND_DIR, "node_modules"))) return Promise.resolve(true);
  console.log(" Chưa có node_modules -> tự chạy `npm install`...\n");
  return new Promise((resolve) => {
    let finished = false;
    const child = spawn("npm", ["install"], {
      cwd: BACKEND_DIR,
      stdio: "inherit",
      shell: true, // npm là npm.cmd trên Windows
    });
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      console.error(" npm install vượt quá 5 phút; dừng tiến trình.");
      child.kill();
      resolve(false);
    }, INSTALL_TIMEOUT_MS);
    child.on("exit", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(code === 0);
    });
    child.on("error", () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(false);
    });
  });
}

// Bật backend ở nền; lỗi thì ném kèm phần cuối của log
async function startBackend() {
  const logPath = path.join(__dirname, ".server.log");
  const logFd = fs.openSync(logPath, "w");
  const child = spawn(process.execPath, ["server.js"], {
    cwd: BACKEND_DIR,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, PORT: String(TEST_PORT) },
  });
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });

  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited) break;
    if (await isServerUp()) return { child, logPath };
    await sleep(500);
  }

  if (!exited) child.kill();
  let tail = "";
  try {
    tail = fs.readFileSync(logPath, "utf-8").split("\n").slice(-15).join("\n");
  } catch { /* best-effort cleanup */ }
  throw new Error(
    (exited ? "Backend bị dừng ngay khi khởi động." : `Backend không phản hồi sau ${SERVER_START_TIMEOUT_MS / 1000}s.`) +
      `\n--- log backend (${logPath}) ---\n${tail}`,
  );
}

async function main() {
  console.log(line());
  console.log(" CHẠY TỰ ĐỘNG TOÀN BỘ BỘ KIỂM THỬ");
  console.log(line() + "\n");

  let suites = SUITES;
  if (unitOnly) suites = suites.filter((s) => !s.needsServer);
  if (onlyFilters.length) suites = suites.filter((s) => onlyFilters.some((f) => s.name.includes(f)));
  if (suites.length === 0) {
    console.error(" Không có bộ test nào khớp bộ lọc.");
    process.exit(1);
  }

  if (!(await ensureDependencies())) {
    console.error(" `npm install` thất bại - dừng.");
    process.exit(1);
  }

  const results = [];
  const needServer = suites.some((s) => s.needsServer);
  let serverChild = null;

  const stopServer = () => {
    if (serverChild && !serverChild.killed) serverChild.kill();
  };
  process.on("SIGINT", () => {
    stopServer();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    stopServer();
    process.exit(143);
  });

  let infraError = null;
  if (needServer) {
    infraError = await checkMysql();
    if (!infraError) {
      if (await isServerUp()) {
        console.log(` Backend đã chạy sẵn ở cổng ${TEST_PORT} -> dùng luôn (sẽ không tắt khi xong).\n`);
      } else {
        console.log(` Đang tự bật backend ở cổng ${TEST_PORT}...`);
        try {
          const started = await startBackend();
          serverChild = started.child;
          console.log(` Backend đã sẵn sàng (log: ${path.relative(BACKEND_DIR, started.logPath)}).\n`);
        } catch (e) {
          infraError = e.message;
        }
      }
    }
  }

  for (const suite of suites) {
    if (suite.needsServer && infraError) {
      results.push({ ...suite, status: "SKIP", ms: 0 });
      continue;
    }
    console.log(line("-"));
    console.log(` >>> ${suite.name}  (${suite.file})`);
    console.log(line("-"));
    const { code, ms, timedOut } = await runNode(path.join("tests", suite.file));
    results.push({ ...suite, status: code === 0 ? "PASS" : "FAIL", timedOut, ms });
  }

  // Dọn dữ liệu test còn sót
  if (needServer && !infraError) {
    console.log("\n" + line("-"));
    console.log(" >>> Dọn dữ liệu test còn sót");
    console.log(line("-"));
    await runNode(path.join("tests", "cleanup_test_data.js"));
  }

  stopServer();

  console.log("\n" + line());
  console.log(" TỔNG KẾT");
  console.log(line());
  for (const r of results) {
    const mark = r.status === "PASS" ? "[PASS]" : r.status === "FAIL" ? "[FAIL]" : "[SKIP]";
    const duration = r.status === "SKIP" ? "" : (r.ms / 1000).toFixed(1) + "s";
    const timeoutLabel = r.timedOut ? " (timeout)" : "";
    console.log(` ${mark} ${r.name.padEnd(22)} ${duration}${timeoutLabel}`);
  }
  if (infraError) {
    console.log("\n LỖI MÔI TRƯỜNG - các test cần MySQL/backend đã bị bỏ qua:");
    console.log(" " + infraError.split("\n").join("\n "));
  }

  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  const passed = results.filter((r) => r.status === "PASS").length;
  console.log(`\n ${passed} PASS / ${failed} FAIL / ${skipped} SKIP (tổng ${results.length} bộ test)`);
  console.log(line() + "\n");

  process.exit(failed > 0 || skipped > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(" Lỗi không mong đợi trong trình chạy test:", e);
  process.exit(1);
});
