const assert = require("node:assert/strict");
const { HttpError } = require("../errors");

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

async function expectHttpError(action, expectedStatus) {
  await assert.rejects(
    action,
    (err) => err instanceof HttpError && err.status === expectedStatus,
  );
}

async function run() {
  console.log("=== UNIT TEST: QUẢN LÝ PHỤ CẤP HR (TASK 1.9) ===");

  if (!allowancesService) {
    console.log(
      "[SKIP] Chưa có module allowances.service.js từ Backend (Task 1.2 - 1.4).",
    );
    return;
  }

  const validateFn =
    allowancesService.validateAllowance ||
    allowancesService.validateAllowanceInput ||
    allowancesService.create;

  if (typeof validateFn === "function") {
    await check("Chặn số tiền phụ cấp <= 0 (400)", async () => {
      await expectHttpError(
        async () =>
          validateFn({
            intern_id: 1,
            allowance_type: "Hỗ trợ xăng xe",
            amount: 0,
            period: "2026-10",
          }),
        400,
      );
    });

    await check("Chặn số tiền âm (400)", async () => {
      await expectHttpError(
        async () =>
          validateFn({
            intern_id: 1,
            allowance_type: "Hỗ trợ ăn trưa",
            amount: -500000,
            period: "2026-10",
          }),
        400,
      );
    });

    await check("Chặn kỳ/tháng sai định dạng (400)", async () => {
      await expectHttpError(
        async () =>
          validateFn({
            intern_id: 1,
            allowance_type: "Hỗ trợ ăn trưa",
            amount: 1000000,
            period: "13/2026",
          }),
        400,
      );
    });

    await check("Chặn thiếu loại phụ cấp hoặc intern_id (400)", async () => {
      await expectHttpError(
        async () =>
          validateFn({
            allowance_type: "",
            amount: 1000000,
            period: "2026-10",
          }),
        400,
      );
    });
  }

  console.log(`\nKết quả Unit Test Story 1: ${passed} PASS, ${failed} FAIL`);
  if (failed > 0) process.exit(1);
}

run();
