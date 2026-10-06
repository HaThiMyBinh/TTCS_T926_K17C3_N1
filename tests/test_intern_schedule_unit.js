// Unit test cho Lịch thực tập cá nhân (Internship Schedule & Timeline calculations)
const assert = require("assert");
const {
  isValidDate,
  calculateTimelineSummary,
  getDefaultMilestones,
  selectConfirmedContract,
  validateMilestone,
  assertMilestoneWithinRange,
  computeScheduleSyncWarning,
} = require("../services/schedule.service");

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(` [PASS] ${name}`);
  } catch (err) {
    failed++;
    console.error(` [FAIL] ${name}: ${err.message}`);
  }
}

console.log("\n====================================================");
console.log(" BẮT ĐẦU UNIT TEST LỊCH THỰC TẬP CÁ NHÂN (SCHEDULE)");
console.log("====================================================\n");

// 1. Kiểm tra tính hợp lệ của ngày
check("Xác thực ngày YYYY-MM-DD hợp lệ", () => {
  assert.strictEqual(isValidDate("2026-09-07"), true);
  assert.strictEqual(isValidDate("2026-02-28"), true);
  assert.strictEqual(isValidDate("2024-02-29"), true); // Năm nhuận
});

check("Từ chối ngày không hợp lệ hoặc sai định dạng", () => {
  assert.strictEqual(isValidDate("2026-02-29"), false); // 2026 không phải năm nhuận
  assert.strictEqual(isValidDate("2026-13-01"), false);
  assert.strictEqual(isValidDate("07-09-2026"), false);
  assert.strictEqual(isValidDate(""), false);
  assert.strictEqual(isValidDate(null), false);
  assert.strictEqual(isValidDate(undefined), false);
  assert.strictEqual(isValidDate(12345), false);
});

// 2. Tính toán timeline khi đang diễn ra (RUNNING)
check("Tính toán tiến độ khi kỳ thực tập đang diễn ra (RUNNING)", () => {
  const summary = calculateTimelineSummary({
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    todayStr: "2026-09-15",
    milestones: [
      { status: "COMPLETED" },
      { status: "IN_PROGRESS" },
      { status: "NOT_STARTED" },
    ],
  });

  assert.strictEqual(summary.start_date, "2026-09-01");
  assert.strictEqual(summary.end_date, "2026-09-30");
  assert.strictEqual(summary.duration_days, 30);
  assert.strictEqual(summary.days_elapsed, 15);
  assert.strictEqual(summary.days_remaining, 15);
  assert.strictEqual(summary.progress_percent, 50);
  assert.strictEqual(summary.time_state, "RUNNING");
  assert.strictEqual(summary.time_state_text, "Đang diễn ra");
  assert.strictEqual(summary.total_milestones, 3);
  assert.strictEqual(summary.completed_milestones, 1);
  assert.strictEqual(summary.in_progress_milestones, 1);
});

// 3. Tính toán timeline khi chưa bắt đầu (UPCOMING)
check("Tính toán tiến độ khi kỳ thực tập sắp diễn ra (UPCOMING)", () => {
  const summary = calculateTimelineSummary({
    startDate: "2026-10-10",
    endDate: "2026-11-20",
    todayStr: "2026-10-01",
    milestones: [],
  });

  assert.strictEqual(summary.time_state, "UPCOMING");
  assert.strictEqual(summary.time_state_text, "Sắp diễn ra");
  assert.strictEqual(summary.days_elapsed, 0);
  assert.strictEqual(summary.days_remaining, summary.duration_days);
  assert.strictEqual(summary.progress_percent, 0);
});

// 4. Tính toán timeline khi đã kết thúc (ENDED)
check("Tính toán tiến độ khi kỳ thực tập đã kết thúc (ENDED)", () => {
  const summary = calculateTimelineSummary({
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    todayStr: "2026-10-01",
    milestones: [],
  });

  assert.strictEqual(summary.time_state, "ENDED");
  assert.strictEqual(summary.time_state_text, "Đã kết thúc");
  assert.strictEqual(summary.days_elapsed, summary.duration_days);
  assert.strictEqual(summary.days_remaining, 0);
  assert.strictEqual(summary.progress_percent, 100);
});

// 5. Tính toán timeline khi chưa đặt lịch ngày (UNSCHEDULED)
check(
  "Tính toán khi chưa có ngày bắt đầu hoặc ngày kết thúc (UNSCHEDULED)",
  () => {
    const summary = calculateTimelineSummary({
      startDate: null,
      endDate: null,
      milestones: [{ status: "COMPLETED" }, { status: "NOT_STARTED" }],
    });

    assert.strictEqual(summary.time_state, "UNSCHEDULED");
    assert.strictEqual(summary.time_state_text, "Chưa đặt lịch");
    assert.strictEqual(summary.duration_days, null);
    assert.strictEqual(summary.progress_percent, 50); // 1/2 milestones hoàn thành
  },
);

// 6. Xử lý năm nhuận chính xác
check("Tính số ngày chính xác qua năm nhuận (29/02)", () => {
  const summary = calculateTimelineSummary({
    startDate: "2028-02-28",
    endDate: "2028-03-01",
    todayStr: "2028-02-29",
  });
  // 28, 29 Feb, 1 Mar = 3 ngày
  assert.strictEqual(summary.duration_days, 3);
  assert.strictEqual(summary.days_elapsed, 2);
  assert.strictEqual(summary.days_remaining, 1);
});

// 7. Sinh các mốc giai đoạn mặc định (getDefaultMilestones)
check("getDefaultMilestones trả về đủ 6 giai đoạn chuẩn BM02", () => {
  const milestones = getDefaultMilestones("2026-09-07", "2026-10-26");
  assert.strictEqual(milestones.length, 6);
  assert.strictEqual(milestones[0].phase_order, 1);
  assert.strictEqual(milestones[5].phase_order, 6);

  milestones.forEach((m) => {
    assert.ok(m.title, "Mốc phải có tiêu đề");
    assert.ok(m.description, "Mốc phải có mô tả");
    assert.ok(m.expected_results, "Mốc phải có kết quả dự kiến");
    assert.ok(isValidDate(m.start_date), "start_date phải hợp lệ");
    assert.ok(isValidDate(m.end_date), "end_date phải hợp lệ");
    assert.ok(
      m.start_date <= m.end_date,
      "start_date phải trước hoặc bằng end_date",
    );
  });

  // Mốc đầu tiên bắt đầu đúng ngày startDate
  assert.strictEqual(milestones[0].start_date, "2026-09-07");
  // Mốc cuối cùng kết thúc đúng ngày endDate
  assert.strictEqual(milestones[5].end_date, "2026-10-26");
});

check("Không chọn hợp đồng PENDING nếu chưa có CONFIRMED", () => {
  assert.strictEqual(
    selectConfirmedContract([{ id: 1, confirmationStatus: "PENDING" }]),
    null,
  );
  assert.strictEqual(
    selectConfirmedContract([
      { id: 1, confirmationStatus: "PENDING" },
      { id: 2, confirmationStatus: "CONFIRMED" },
    ]).id,
    2,
  );
});

check(
  "Không sinh kế hoạch nếu thiếu ngày; dữ liệu milestone cần hợp lệ",
  () => {
    assert.deepStrictEqual(getDefaultMilestones(null, null), []);
    assert.throws(() =>
      validateMilestone({
        phase_order: 1,
        title: "X",
        start_date: "2026-02-30",
      }),
    );
  },
);

check("Mốc bắt buộc nằm trọn trong khoảng hợp đồng CONFIRMED", () => {
  const range = { start: "2026-10-01", end: "2026-10-31" };
  assert.doesNotThrow(() =>
    assertMilestoneWithinRange(
      { start_date: "2026-10-01", end_date: "2026-10-31" },
      range,
    ),
  );
  assert.throws(
    () =>
      assertMilestoneWithinRange(
        { start_date: "2026-09-30", end_date: "2026-10-03" },
        range,
      ),
    /khoảng hợp đồng/,
  );
  assert.throws(
    () =>
      assertMilestoneWithinRange(
        { start_date: "2026-10-03", end_date: "2026-11-01" },
        range,
      ),
    /khoảng hợp đồng/,
  );
});

// Cảnh báo lệch ngày: mốc nằm trong hợp đồng, hợp đồng nằm trong chương trình
const syncContract = { start_date: "2026-10-05", end_date: "2026-12-04" };
const syncProgram = { start_date: "2026-10-01", end_date: "2026-12-31" };

check("Không cảnh báo khi chưa có mốc nào", () => {
  assert.equal(
    computeScheduleSyncWarning({
      contract: syncContract,
      program: syncProgram,
      milestoneStart: null,
      milestoneEnd: null,
    }),
    null,
  );
});

check("Không cảnh báo khi mốc nằm trong hợp đồng dù không trùng khít", () => {
  assert.equal(
    computeScheduleSyncWarning({
      contract: syncContract,
      program: syncProgram,
      milestoneStart: "2026-10-06",
      milestoneEnd: "2026-12-01",
    }),
    null,
  );
});

check("Không cảnh báo khi mốc trùng đúng khoảng hợp đồng", () => {
  assert.equal(
    computeScheduleSyncWarning({
      contract: syncContract,
      program: syncProgram,
      milestoneStart: "2026-10-05",
      milestoneEnd: "2026-12-04",
    }),
    null,
  );
});

check("Cảnh báo khi mốc cuối vượt quá ngày kết thúc hợp đồng", () => {
  const warning = computeScheduleSyncWarning({
    contract: syncContract,
    program: syncProgram,
    milestoneStart: "2026-10-05",
    milestoneEnd: "2026-12-10",
  });
  assert.match(
    warning,
    /nằm ngoài khoảng hợp đồng \(05\/10\/2026 – 04\/12\/2026\)/,
  );
});

check("Cảnh báo khi mốc đầu sớm hơn ngày bắt đầu hợp đồng", () => {
  assert.match(
    computeScheduleSyncWarning({
      contract: syncContract,
      program: syncProgram,
      milestoneStart: "2026-10-01",
      milestoneEnd: "2026-12-01",
    }),
    /nằm ngoài khoảng hợp đồng/,
  );
});

check("Cảnh báo khi hợp đồng nằm ngoài thời gian chương trình", () => {
  const warning = computeScheduleSyncWarning({
    contract: { start_date: "2026-09-20", end_date: "2026-12-04" },
    program: syncProgram,
    milestoneStart: "2026-09-20",
    milestoneEnd: "2026-12-04",
  });
  assert.match(
    warning,
    /Thời gian hợp đồng nằm ngoài thời gian của chương trình/,
  );
});

check("Hợp đồng thiếu ngày thì so mốc với chương trình", () => {
  assert.match(
    computeScheduleSyncWarning({
      contract: { start_date: null, end_date: null },
      program: syncProgram,
      milestoneStart: "2026-10-01",
      milestoneEnd: "2027-01-15",
    }),
    /nằm ngoài khoảng chương trình/,
  );
  assert.equal(
    computeScheduleSyncWarning({
      contract: null,
      program: syncProgram,
      milestoneStart: "2026-10-02",
      milestoneEnd: "2026-12-30",
    }),
    null,
  );
});

check("Không có hợp đồng lẫn chương trình thì không cảnh báo", () => {
  assert.equal(
    computeScheduleSyncWarning({
      contract: null,
      program: null,
      milestoneStart: "2026-10-01",
      milestoneEnd: "2026-12-01",
    }),
    null,
  );
});

console.log("\n----------------------------------------------------");
console.log(` KẾT QUẢ UNIT TEST SCHEDULE: ${passed}/${passed + failed} PASS`);
console.log("----------------------------------------------------\n");

if (failed > 0) {
  process.exit(1);
}
