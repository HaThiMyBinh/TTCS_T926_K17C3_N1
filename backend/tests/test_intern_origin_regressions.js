// Regression tests for the actual DB function and frontend handlers; no live MySQL needed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { normalizeKey } = require("../services/internOriginReport.service");
const dbSource = fs.readFileSync(path.join(__dirname, "../db.js"), "utf8");
const fn = dbSource.slice(
  dbSource.indexOf("async function listInternsByOrigin("),
  dbSource.indexOf("// US7/US8 data access."),
);

async function main() {
  for (const unknown of [false, true]) {
    const values = unknown
      ? [null, "", "\t", "Chưa  cập nhật", "CHUA CAP NHAT", "Other"]
      : ["Đại học Y", "Dai  hoc Y", "đại học y", "O'Brien"];
    const expected = values.filter((value) =>
      unknown
        ? value == null || ["", "chua cap nhat"].includes(normalizeKey(value))
        : normalizeKey(value) === "dai hoc y",
    );
    const calls = [];
    const query = async (sql, params) => {
      calls.push({ sql, params });
      if (sql.startsWith("SELECT ANY_VALUE(university) AS value"))
        return [values.map((value) => ({ value }))];
      assert.match(sql, /BINARY i\.university IN/);
      assert.deepEqual(
        Array.from(params).slice(0, expected.filter((x) => x != null).length),
        expected.filter((x) => x != null),
      );
      if (unknown) assert.match(sql, /i\.university IS NULL/);
      if (sql.includes("COUNT(*)")) return [[{ total: expected.length }]];
      return [expected.map((university, id) => ({ id, university }))];
    };
    const list = vm.runInNewContext(`${fn}\nlistInternsByOrigin`, {
      requireDb: () => ({ query }),
    });
    const result = await list({
      university: unknown ? "Chưa cập nhật" : "Đại học Y",
      isUnknownUniversity: unknown,
      normalizeKey,
    });
    assert.equal(result.pagination.total, expected.length);
    assert.equal(result.items.length, expected.length);
    assert.equal(calls.length, 3);
    console.log(
      `[PASS] DB raw variants ${unknown ? "unknown" : "accent/spacing"}: chart/detail parity`,
    );
  }
  assert.match(dbSource, /GROUP BY BINARY university, BINARY major/);
  assert.match(dbSource, /GROUP BY BINARY university, status/);
  assert.match(
    dbSource,
    /SELECT ANY_VALUE\(university\) AS university, ANY_VALUE\(major\) AS major/,
  );
  assert.match(
    dbSource,
    /SELECT ANY_VALUE\(university\) AS university, status/,
  );
  console.log("[PASS] SELECT dùng ANY_VALUE tương thích ONLY_FULL_GROUP_BY");
  console.log(
    "[PASS] SQL preserves case/accent variants for label frequencies",
  );
}
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
