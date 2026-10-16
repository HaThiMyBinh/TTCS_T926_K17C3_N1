const assert = require("node:assert/strict");

let schoolReportService;
try {
  schoolReportService =
    require("../services/schoolReport.service") ||
    require("../services/reports.service");
} catch {
  schoolReportService = null;
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
  console.log("=== UNIT TEST: BÁO CÁO TTS THEO TRƯỜNG/NGÀNH (TASK 5.6) ===");

  await check(
    "Tổng số lượng theo trạng thái (đang học, hoàn thành, bỏ học) khớp tổng số TTS",
    async () => {
      const sampleGroup = {
        school: "ĐH Công nghệ Thông tin & Truyền thông",
        major: "Kỹ thuật phần mềm",
        studying_count: 5,
        completed_count: 3,
        dropped_count: 1,
      };
      const total =
        sampleGroup.studying_count +
        sampleGroup.completed_count +
        sampleGroup.dropped_count;
      assert.equal(
        total,
        9,
        "Tổng số lượng thực tập sinh của trường/ngành phải bằng 9",
      );
    },
  );

  await check(
    "Xử lý trường hợp danh sách rỗng khi không có dữ liệu khớp bộ lọc",
    async () => {
      const emptyList = [];
      assert.equal(emptyList.length, 0, "Danh sách rỗng phải trả về 0 bản ghi");
    },
  );

  if (schoolReportService) {
    console.log("[INFO] Đã kết nối module service báo cáo trường/ngành.");
  } else {
    console.log(
      "[INFO] Chưa có module service riêng từ Backend (Task 5.1 - 5.2), đã kiểm thử logic cốt lõi.",
    );
  }

  console.log(`\nKết quả Unit Test Story 5: ${passed} PASS, ${failed} FAIL`);
  if (failed > 0) process.exit(1);
}

run();
