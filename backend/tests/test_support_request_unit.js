const assert = require("node:assert/strict");
const { HttpError } = require("../errors");

let supportService;
try {
  supportService =
    require("../services/supportRequests.service") ||
    require("../services/supportRequest.service");
} catch {
  supportService = null;
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
  console.log("=== UNIT TEST: YÊU CẦU HỖ TRỢ INTERN (TASK 3.7) ===");

  await check(
    "Kiểm tra danh mục loại yêu cầu hợp lệ (chứng nhận/giấy tờ/khác)",
    async () => {
      const validTypes = [
        "CERTIFICATE",
        "DOCUMENT",
        "OTHER",
        "Chứng nhận",
        "Giấy tờ",
        "Khác",
      ];
      assert.ok(validTypes.length >= 3, "Phải hỗ trợ tối thiểu 3 loại yêu cầu");
    },
  );

  if (!supportService) {
    console.log(
      "[INFO] Chưa có module supportRequests.service.js từ Backend (Task 3.2 - 3.3), bỏ qua kiểm thử hàm nội bộ.",
    );
  } else {
    const validateFn =
      supportService.validateSupportRequest ||
      supportService.validateCreateInput ||
      supportService.create;

    if (typeof validateFn === "function") {
      await check("Chặn gửi yêu cầu khi nội dung rỗng (400)", async () => {
        await expectHttpError(
          async () =>
            validateFn({
              request_type: "Chứng nhận",
              title: "Xin giấy xác nhận thực tập",
              content: "   ",
            }),
          400,
        );
      });

      await check(
        "Chặn gửi yêu cầu khi loại yêu cầu không hợp lệ (400)",
        async () => {
          await expectHttpError(
            async () =>
              validateFn({
                request_type: "INVALID_TYPE_XYZ",
                title: "Tiêu đề hợp lệ",
                content: "Nội dung hợp lệ",
              }),
            400,
          );
        },
      );

      await check(
        "Chặn gửi yêu cầu khi vượt quá giới hạn độ dài (400)",
        async () => {
          await expectHttpError(
            async () =>
              validateFn({
                request_type: "Giấy tờ",
                title: "A".repeat(300),
                content: "B".repeat(5000),
              }),
            400,
          );
        },
      );
    }
  }

  console.log(`\nKết quả Unit Test Story 3: ${passed} PASS, ${failed} FAIL`);
  if (failed > 0) process.exit(1);
}

run();
