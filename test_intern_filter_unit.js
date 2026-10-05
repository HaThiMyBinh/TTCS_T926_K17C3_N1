const assert = require("assert");
const { escapeLike, normalizeInternFilters, buildInternFilterConditions } = require("../utils/internFilters");

assert.deepStrictEqual(normalizeInternFilters({ q: "  Nguyễn  ", university: "  ĐH ABC " }), { q: "Nguyễn", university: "ĐH ABC" });
assert.deepStrictEqual(normalizeInternFilters({ q: "   " }), {});
assert.strictEqual(escapeLike("a%_\\b"), "a=%=_=\\b");
assert.ok(buildInternFilterConditions({ q: "Tiếng Việt" }).whereSql.includes("utf8mb4_unicode_ci"));
assert.deepStrictEqual(buildInternFilterConditions({ university: "A", major: "B", q: "C", unassigned: true }).params, ["A", "B", "%C%", "%C%", "%C%", "%C%", "%C%"]);
assert.throws(() => normalizeInternFilters({ q: "x".repeat(101) }), /100 ký tự/);
assert.throws(() => normalizeInternFilters({ q: ["x", "y"] }), /một chuỗi/);
console.log("PASS test_intern_filter_unit");
