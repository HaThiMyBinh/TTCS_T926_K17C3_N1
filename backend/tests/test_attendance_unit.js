// Unit test chấm công: giờ Việt Nam, quy tắc đi muộn. Không cần MySQL.
const assert = require("assert");
const { getVietnamTime, getVietnamDateTime } = require("../utils/date");
const attendance = require("../services/attendance.service");

// 01:00 UTC = 08:00 giờ VN; 17:00 UTC sang ngày hôm sau lúc 00:00 giờ VN.
assert.strictEqual(getVietnamTime(new Date("2026-10-05T01:00:00Z")), "08:00:00");
assert.strictEqual(getVietnamTime(new Date("2026-10-04T17:00:00Z")), "00:00:00");
assert.strictEqual(
  getVietnamDateTime(new Date("2026-10-04T17:30:15Z")),
  "2026-10-05 00:30:15",
);

// Chuẩn hóa mốc giờ.
assert.strictEqual(attendance.normalizeTime("08:30"), "08:30:00");
assert.strictEqual(attendance.normalizeTime("09:15:30"), "09:15:30");
assert.strictEqual(attendance.normalizeTime("24:00"), null);
assert.strictEqual(attendance.normalizeTime("abc"), null);
assert.strictEqual(attendance.normalizeTime(undefined), null);

// Đúng mốc vẫn là đúng giờ, quá mốc 1 giây là muộn.
assert.strictEqual(attendance.isLateCheckIn("08:29:59", "08:30:00"), false);
assert.strictEqual(attendance.isLateCheckIn("08:30:00", "08:30:00"), false);
assert.strictEqual(attendance.isLateCheckIn("08:30:01", "08:30:00"), true);
assert.strictEqual(attendance.isLateCheckIn("13:00:00", "08:30:00"), true);

// DTO.
const dto = attendance.toAttendanceDto({
  id: "5",
  internId: "2",
  workDate: "2026-10-05",
  checkInAt: "2026-10-05 08:45:10",
  isLate: 1,
});
assert.deepStrictEqual(dto, {
  id: 5,
  intern_id: 2,
  work_date: "2026-10-05",
  check_in_at: "2026-10-05 08:45:10",
  is_late: true,
});

console.log("ATTENDANCE UNIT: giờ VN, đi muộn, DTO PASS");
