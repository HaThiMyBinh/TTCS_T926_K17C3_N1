const assert = require("assert");
const { csvCell } = require("../utils/csv");

assert.strictEqual(csvCell(-5), '"-5"');
assert.strictEqual(csvCell("=1+1"), '"\'=1+1"');
assert.strictEqual(csvCell('a"b'), '"a""b"');
assert.strictEqual(csvCell(null), '""');
console.log("CSV unit tests passed.");
