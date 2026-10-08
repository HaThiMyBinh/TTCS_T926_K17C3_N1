// Unit test tính tuần báo cáo (thứ Hai -> Chủ nhật), hạn nộp và trạng thái. Không cần MySQL.
const assert = require("assert");
const weeks = require("../utils/weeks");
const { getVietnamToday } = require("../utils/date");

function testBasics() {
  assert.ok(weeks.isValidDate("2026-10-05"));
  assert.ok(!weeks.isValidDate("2026-02-30"));
  assert.ok(!weeks.isValidDate("05/10/2026"));
  assert.ok(!weeks.isValidDate(20261005));

  // 2026-10-05 là thứ Hai
  assert.ok(weeks.isMonday("2026-10-05"));
  assert.ok(!weeks.isMonday("2026-10-06"));
  assert.ok(!weeks.isMonday("2026-10-11"));
  assert.ok(!weeks.isMonday("không phải ngày"));

  assert.strictEqual(weeks.mondayOf("2026-10-05"), "2026-10-05");
  assert.strictEqual(weeks.mondayOf("2026-10-07"), "2026-10-05");
  assert.strictEqual(weeks.mondayOf("2026-10-11"), "2026-10-05"); // Chủ nhật
  assert.strictEqual(weeks.mondayOf("2026-10-12"), "2026-10-12");
  assert.strictEqual(weeks.mondayOf("2027-01-01"), "2026-12-28"); // qua năm

  assert.strictEqual(weeks.weekEndOf("2026-10-05"), "2026-10-11");
  assert.strictEqual(weeks.weekEndOf("2026-12-28"), "2027-01-03");
  assert.strictEqual(weeks.addDays("2026-02-27", 2), "2026-03-01");
}

function testListRequiredWeeks() {
  const list = (startDate, endDate, today) =>
    weeks.listRequiredWeeks({ startDate, endDate, today });

  // Bắt đầu giữa tuần: tính từ tuần chứa ngày bắt đầu đến tuần hiện tại
  assert.deepStrictEqual(list("2026-09-16", null, "2026-10-07"), [
    "2026-09-14",
    "2026-09-21",
    "2026-09-28",
    "2026-10-05",
  ]);
  // Bắt đầu hôm nay: chỉ tuần hiện tại
  assert.deepStrictEqual(list("2026-10-07", null, "2026-10-07"), [
    "2026-10-05",
  ]);
  // Đã kết thúc: không tính các tuần sau ngày kết thúc
  assert.deepStrictEqual(list("2026-09-01", "2026-09-20", "2026-10-07"), [
    "2026-08-31",
    "2026-09-07",
    "2026-09-14",
  ]);
  // Chưa kết thúc: ngày kết thúc ở tương lai thì dừng ở tuần hiện tại
  assert.deepStrictEqual(list("2026-10-05", "2026-12-31", "2026-10-07"), [
    "2026-10-05",
  ]);
  // Kỳ thực tập chưa bắt đầu
  assert.deepStrictEqual(list("2026-10-20", null, "2026-10-07"), []);
}

function testIsWeekRequired() {
  const period = { startDate: "2026-09-16", endDate: "2026-10-20" };
  assert.ok(!weeks.isWeekRequired("2026-09-07", period)); // kết thúc 13/09 < bắt đầu
  assert.ok(weeks.isWeekRequired("2026-09-14", period)); // tuần chứa ngày bắt đầu
  assert.ok(weeks.isWeekRequired("2026-10-19", period)); // tuần chứa ngày kết thúc
  assert.ok(!weeks.isWeekRequired("2026-10-26", period));
  assert.ok(weeks.isWeekRequired("2030-01-07", { startDate: "2026-09-16" }));
}

function testStatusAndDeadline() {
  const week = "2026-10-05"; // hạn: hết Chủ nhật 2026-10-11
  const status = (report, today) =>
    weeks.weekStatus({ weekStart: week, report, today });

  assert.strictEqual(status(null, "2026-10-07"), "UPCOMING");
  assert.strictEqual(status(null, "2026-10-11"), "UPCOMING"); // Chủ nhật: còn hạn
  assert.strictEqual(status(null, "2026-10-12"), "MISSING"); // Thứ Hai: quá hạn
  assert.strictEqual(status({ isLate: false }, "2026-10-20"), "SUBMITTED");
  assert.strictEqual(status({ isLate: true }, "2026-10-20"), "LATE_SUBMITTED");
  assert.strictEqual(
    weeks.weekStatus({
      weekStart: "2026-10-12",
      report: null,
      today: "2026-10-07",
    }),
    "UPCOMING",
  ); // tuần tương lai

  assert.strictEqual(weeks.isLateSubmission(week, "2026-10-05"), false);
  assert.strictEqual(weeks.isLateSubmission(week, "2026-10-11"), false);
  assert.strictEqual(weeks.isLateSubmission(week, "2026-10-12"), true);

  // Ranh giới 23:59:59 Chủ nhật và 00:00:00 Thứ Hai theo GIỜ VIỆT NAM (UTC+7)
  const lastSecond = new Date("2026-10-11T16:59:59Z"); // 23:59:59 VN
  const nextSecond = new Date("2026-10-11T17:00:00Z"); // 00:00:00 VN thứ Hai
  assert.strictEqual(
    weeks.isLateSubmission(week, getVietnamToday(lastSecond)),
    false,
  );
  assert.strictEqual(
    weeks.isLateSubmission(week, getVietnamToday(nextSecond)),
    true,
  );
}

testBasics();
testListRequiredWeeks();
testIsWeekRequired();
testStatusAndDeadline();
console.log("PASS test_weeks_unit");
