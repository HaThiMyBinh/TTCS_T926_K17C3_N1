const assert = require("assert");
const {
  normalizeSchoolStatsFilters,
  buildSchoolStatsReport,
} = require("../services/internSchoolStats.service");

// Chuẩn hoá tham số lọc
assert.deepStrictEqual(normalizeSchoolStatsFilters({}), {});
assert.deepStrictEqual(
  normalizeSchoolStatsFilters({ university: "  ĐH Bách Khoa ", major: "   " }),
  { university: "ĐH Bách Khoa" },
);
assert.throws(() => normalizeSchoolStatsFilters({ major: ["a", "b"] }), /một chuỗi/);
assert.throws(() => normalizeSchoolStatsFilters({ university: "x".repeat(101) }), /100 ký tự/);

// Gom nhóm theo trường + tổng toàn bộ
const rows = [
  { university: "ĐH A", major: "CNTT", total: 5, inProgress: 3, completed: 1, dropped: 1, other: 0 },
  { university: "ĐH A", major: "Kế toán", total: 2, inProgress: 1, completed: 1, dropped: 0, other: 0 },
  { university: "ĐH B", major: "CNTT", total: 4, inProgress: 0, completed: 3, dropped: 0, other: 1 },
];
const report = buildSchoolStatsReport(rows);
assert.deepStrictEqual(report.summary, {
  total: 11, inProgress: 4, completed: 5, dropped: 1, other: 1, schoolCount: 2,
});
assert.strictEqual(report.schools[0].university, "ĐH A"); // 7 TTS > 4 TTS
assert.strictEqual(report.schools[0].total, 7);
assert.strictEqual(report.schools[0].majors.length, 2);
assert.strictEqual(report.schools[1].completed, 3);

// Không có dữ liệu
const empty = buildSchoolStatsReport([]);
assert.deepStrictEqual(empty.summary, { total: 0, inProgress: 0, completed: 0, dropped: 0, other: 0, schoolCount: 0 });
assert.deepStrictEqual(empty.schools, []);

console.log("PASS test_intern_school_stats_unit");
