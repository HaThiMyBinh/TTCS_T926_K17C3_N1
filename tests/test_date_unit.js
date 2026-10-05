const assert = require("assert");
const { getVietnamToday, formatVietnamDateTime } = require("../utils/date");

// 16:59 UTC vẫn là ngày hôm đó ở Việt Nam; 17:00 UTC đã sang ngày hôm sau (UTC+7).
assert.equal(getVietnamToday(new Date("2026-10-04T16:59:59Z")), "2026-10-04");
assert.equal(getVietnamToday(new Date("2026-10-04T17:00:00Z")), "2026-10-05");
// Qua ranh giới tháng/năm.
assert.equal(getVietnamToday(new Date("2026-12-31T17:00:00Z")), "2027-01-01");
// Năm nhuận.
assert.equal(getVietnamToday(new Date("2028-02-28T17:00:00Z")), "2028-02-29");

// Giờ hiển thị luôn theo UTC+7, không phụ thuộc TZ của máy chủ.
assert.match(
  formatVietnamDateTime(new Date("2026-10-04T17:00:00Z")),
  /00:00:00/,
);
assert.match(
  formatVietnamDateTime(new Date("2026-10-04T17:00:00Z")),
  /05\/10\/2026/,
);

console.log("DATE UNIT: ngày/giờ theo múi giờ Việt Nam PASS");
