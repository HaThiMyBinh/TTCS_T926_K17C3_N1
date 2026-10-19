const assert = require("node:assert/strict");
const { test } = require("node:test");
const ExcelJS = require("exceljs");
const {
  renderXlsx,
  filenames,
  sheetName,
  MAX_ROWS,
  MAX_CELLS,
  MIME,
} = require("../services/export/xlsx");
const { fixtures, name } = require("./export_fixtures");
const { makeXlsxEndpoint } = require("../utils/endpoint");
const { HttpError } = require("../errors");
async function read(model) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await renderXlsx(model));
  return book;
}
test("all four models round-trip Vietnamese, totals, typed values and empty sheets", async () => {
  for (const [kind, model] of Object.entries(fixtures())) {
    assert.equal(model.exportedDate, "2026-10-17");
    assert.match(model.exportedAt, /01:30:00/);
    assert.ok(!JSON.stringify(model).includes("PRIVATE"));
    const book = await read(model);
    assert.equal(book.worksheets.length, model.tables.length, kind);
    model.tables.forEach((table, index) => {
      const sheet = book.worksheets[index];
      assert.equal(sheet.getCell("A1").value, model.title);
      const header = sheet.views[0].ySplit;
      assert.equal(sheet.getRow(header).getCell(1).font.bold, true);
      assert.equal(
        sheet.getRow(header).getCell(1).fill.fgColor.argb,
        "FF2563EB",
      );
      const expectedRows = [
        ...table.rows,
        ...(table.totals ? [table.totals] : []),
      ];
      expectedRows.forEach((row, rowIndex) => {
        const actualRow =
          header + rowIndex + 1 + (!table.rows.length && table.totals ? 1 : 0);
        table.columns.forEach((column, i) => {
          const actual = sheet.getRow(actualRow).getCell(i + 1);
          const value = row[i] == null || row[i] === "" ? null : row[i];
          if (column.type === "date" && value)
            assert.equal(actual.value.toISOString().slice(0, 10), value);
          else
            assert.equal(
              actual.value,
              value,
              `${kind}/${table.name}/${rowIndex}/${i}`,
            );
          if (value != null && ["number", "percent"].includes(column.type))
            assert.equal(typeof actual.value, "number");
          if (column.type === "percent") assert.equal(actual.numFmt, "0.0%");
        });
      });
      if (!table.rows.length)
        assert.equal(
          sheet.getRow(header + 1).getCell(1).value,
          "Không có dữ liệu phù hợp.",
        );
    });
  }
  const model = fixtures();
  assert.equal(model.completion.tables[0].rows[0][1], 3);
  assert.ok(Math.abs(model.completion.tables[0].rows[0][6] - 0.333) < 1e-12);
  assert.equal(model.origin.tables[3].totals.at(-1), 3);
  assert.equal(model.attendance.tables[2].rows[0].at(-2), 2);
  assert.equal(model.final.tables[1].rows[0][1], "00009");
  assert.equal(model.final.tables[1].rows[0][0], name);
});
test("formula-like strings stay text; no object can become a formula or hyperlink", async () => {
  const model = fixtures().completion;
  model.tables = [
    {
      name: "Injection",
      columns: [{ label: "Giá trị", type: "text" }],
      rows: [
        "=1+1",
        "+SUM(A1)",
        "-2+2",
        "@SUM(A1)",
        "\t=1+1",
        { formula: "1+1" },
        { text: "Click", hyperlink: "https://example.test" },
      ].map((x) => [x]),
    },
  ];
  const book = await read(model),
    sheet = book.worksheets[0],
    start = sheet.views[0].ySplit + 1;
  model.tables[0].rows.forEach(([value], i) => {
    const cell = sheet.getRow(start + i).getCell(1);
    assert.equal(cell.type, ExcelJS.ValueType.String);
    assert.equal(cell.value, String(value));
    assert.equal(cell.formula, undefined);
    assert.equal(cell.hyperlink, undefined);
  });
});
test("valid distinct sheet names, safe dated file names, limits and many rows", async () => {
  const used = new Set();
  for (const title of [
    "A:/\\?*[]'",
    "a      ",
    "'",
    "x".repeat(100),
    "x".repeat(100),
  ]) {
    const value = sheetName(title, used);
    assert.ok(value.length > 0 && value.length <= 31);
    assert.ok(!/[:\\/?*\[\]]/.test(value));
  }
  assert.equal(used.size, 5);
  assert.notEqual(sheetName("History", new Set()), "History");
  const model = fixtures().completion;
  model.title = 'Tên báo cáo\r\n"/\\?*.xlsx';
  const names = filenames(model);
  assert.ok(/^[\x20-\x7e]+$/.test(names.ascii));
  assert.ok(!/[\r\n"/\\]/.test(names.unicode));
  assert.ok(names.unicode.endsWith("_2026-10-17.xlsx"));
  model.tables = [
    {
      name: "Nhiều dòng",
      columns: [{ label: "STT", type: "number" }],
      rows: Array.from({ length: 1500 }, (_, i) => [i]),
    },
  ];
  const book = await read(model);
  const sheet = book.worksheets[0];
  assert.equal(sheet.lastRow.getCell(1).value, 1499);
  model.tables[0].rows = Array.from({ length: MAX_ROWS + 1 }, () => [1]);
  await assert.rejects(renderXlsx(model), (e) => e.status === 400);
  model.tables[0].columns = Array.from({ length: 101 }, () => ({ label: "x" }));
  await assert.rejects(renderXlsx(model), (e) => e.status === 400);
  model.tables[0].columns = Array.from({ length: 100 }, () => ({ label: "x" }));
  model.tables[0].rows = Array.from(
    { length: Math.floor(MAX_CELLS / 100) + 1 },
    () => [1],
  );
  await assert.rejects(renderXlsx(model), (e) => e.status === 400);
});
test("shared XLSX endpoint rejects repeated queries and sanitizes server failures", async () => {
  const response = () => ({
    headers: {},
    code: 200,
    set(k, v) {
      this.headers[k] = v;
      return this;
    },
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  });
  const handler = makeXlsxEndpoint(
    "TEST_EXPORT",
    async () => fixtures().completion,
  );
  const ok = response();
  await handler({ query: {} }, ok);
  assert.equal(ok.headers["Content-Type"], MIME);
  assert.match(
    ok.headers["Content-Disposition"],
    /filename=".*2026-10-17.xlsx"; filename\*=UTF-8''/,
  );
  const bad = response();
  await handler({ query: { q: ["x", "y"] } }, bad);
  assert.equal(bad.code, 400);
  const original = console.error;
  try {
    console.error = () => {};
    const fail = response();
    await makeXlsxEndpoint("TEST_EXPORT", async () => {
      throw new HttpError(500, "PRIVATE_SQL");
    })({ query: {} }, fail);
    assert.equal(fail.code, 500);
    assert.ok(!JSON.stringify(fail.body).includes("PRIVATE"));
  } finally {
    console.error = original;
  }
});
test("HR without VIEW_REPORTS is denied without editing permissions.json", () => {
  const fs = require("node:fs");
  const original = fs.readFileSync;
  const {
    checkPermission,
    PERMISSIONS_FILE,
  } = require("../middleware/permissions");
  try {
    fs.readFileSync = (file, ...args) =>
      file === PERMISSIONS_FILE ? '{"HR":[]}' : original(file, ...args);
    let status,
      body,
      proceeded = false;
    checkPermission("VIEW_REPORTS")(
      { user: { role: "HR" } },
      {
        status(code) {
          status = code;
          return this;
        },
        json(value) {
          body = value;
        },
      },
      () => {
        proceeded = true;
      },
    );
    assert.equal(status, 403);
    assert.equal(proceeded, false);
    assert.equal(body.requiredPermission, "VIEW_REPORTS");
  } finally {
    fs.readFileSync = original;
  }
});
