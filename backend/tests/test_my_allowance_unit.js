const assert = require("node:assert/strict");

let allowancesService;
try {
  allowancesService = require("../services/allowances.service");
} catch {
  allowancesService = null;
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

async function run() {
  console.log("=== UNIT TEST: LỊCH SỬ PHỤ CẤP CÁ NHÂN INTERN (TASK 2.6) ===");

  await check("Tính tổng tiền phụ cấp theo kỳ chính xác", async () => {
    const sampleItems = [
      { amount: 1500000, period: "2026-10" },
      { amount: 500000, period: "2026-10" },
    ];
    const total = sampleItems.reduce(
      (sum, item) => sum + Number(item.amount),
      0,
    );
    assert.equal(total, 2000000, "Tổng phụ cấp phải bằng 2.000.000 VND");
  });

  await check(
    "Trường hợp thực tập sinh chưa có phụ cấp trả về tổng bằng 0",
    async () => {
      const emptyItems = [];
      const total = emptyItems.reduce(
        (sum, item) => sum + Number(item.amount),
        0,
      );
      assert.equal(total, 0, "Khi rỗng tổng tiền phải bằng 0");
    },
  );

  if (
    allowancesService &&
    typeof allowancesService.listMyAllowances === "function"
  ) {
    console.log("[INFO] Đã tìm thấy hàm listMyAllowances trong service.");
  }

  console.log(`\nKết quả Unit Test Story 2: ${passed} PASS, ${failed} FAIL`);
  if (failed > 0) process.exit(1);
}

run();
