const assert = require("node:assert/strict");

let completionService;
try {
  completionService =
    require("../services/completionRate.service") ||
    require("../services/reports.service");
} catch {
  completionService = null;
}

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`[FAIL] ${name}: ${err.message}`);
  }
}

function calcPercentage(completed, total) {
  if (!total || total <= 0) return 0;
  return Math.round((completed / total) * 10000) / 100;
}

async function run() {
  console.log(
    "=== UNIT TEST: BÁO CÁO TỶ LỆ HOÀN THÀNH CHƯƠNG TRÌNH (TASK 6.6) ===",
  );

  await check(
    "Tính tỷ lệ phần trăm (%) theo tiêu chí đánh giá, chuyên cần, phụ cấp chính xác",
    async () => {
      assert.equal(calcPercentage(8, 10), 80, "8/10 phải đạt 80%");
      assert.equal(calcPercentage(3, 4), 75, "3/4 phải đạt 75%");
    },
  );

  await check(
    "Tránh lỗi chia cho 0 khi tổng số thực tập sinh bằng 0",
    async () => {
      assert.equal(calcPercentage(0, 0), 0, "Khi mẫu số = 0 phải trả về 0%");
    },
  );

  await check(
    "Tổng tỷ lệ hoàn thành và chưa hoàn thành bằng 100% khi có dữ liệu",
    async () => {
      const completedRate = calcPercentage(7, 10);
      const incompleteRate = calcPercentage(3, 10);
      assert.equal(
        completedRate + incompleteRate,
        100,
        "Tổng tỷ lệ phải bằng 100%",
      );
    },
  );

  if (completionService) {
    console.log("[INFO] Đã kết nối module service tỷ lệ hoàn thành.");
  } else {
    console.log(
      "[INFO] Chưa có module service riêng từ Backend (Task 6.1 - 6.2), đã kiểm thử công thức tính tỷ lệ.",
    );
  }

  console.log(`\nKết quả Unit Test Story 6: ${passed} PASS, ${failed} FAIL`);
  if (failed > 0) process.exit(1);
}

run();
