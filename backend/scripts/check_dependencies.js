// Kiểm tra các dependency thực sự nạp được trước khi mở backend.
// Không kết nối database hoặc SMTP trong bước kiểm tra này.
const { dependencies = {} } = require("../package.json");

try {
  for (const name of Object.keys(dependencies)) {
    require(name);
  }
  require("mysql2/promise");
  console.log("[OK] Backend dependencies loaded successfully.");
} catch (err) {
  console.error("[ERROR] Backend dependency is missing or invalid:");
  console.error(err.message);
  console.error("Run npm ci from the backend directory to repair dependencies.");
  process.exitCode = 1;
}
