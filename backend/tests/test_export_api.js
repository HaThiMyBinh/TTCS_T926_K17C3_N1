// needsServer. Read-only by default; an optional DRAFT fixture is allowed only in a dedicated test DB.
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const mysql = require("mysql2/promise");
const { BASE_URL, loginAs, readDbConfig } = require("./test_helpers");
const { MIME } = require("../services/export/xlsx");
function csvRows(text) {
  const rows = [],
    row = [];
  let value = "",
    quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(value);
      value = "";
    } else if (c === "\n" && !quoted) {
      row.push(value.replace(/\r$/, ""));
      rows.push([...row]);
      row.length = 0;
      value = "";
    } else value += c;
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}
async function get(path, token) {
  const res = await fetch(BASE_URL + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  return { res, bytes };
}
async function main() {
  const tokens = {};
  for (const role of ["HR", "Admin", "Mentor", "Intern"])
    tokens[role] = await loginAs(role);
  const cfg = readDbConfig();
  const conn = await mysql.createConnection(cfg);
  let createdId;
  try {
    const [reports] = await conn.query(
      "SELECT id FROM final_reports ORDER BY id LIMIT 1",
    );
    let id = reports[0]?.id;
    if (!id && process.env.US7_TEST_DB_ALLOW_WRITES === "1") {
      assert.match(
        cfg.database,
        /^(us6_test_|us7_test_)/,
        "Fixture writes require an isolated test DB",
      );
      const [row] = await conn.query(
        "INSERT INTO final_reports(title,scope_type,status) VALUES (?, 'ALL', 'DRAFT')",
        ["US7 API fixture " + Date.now()],
      );
      id = createdId = row.insertId;
    }
    assert.ok(
      id,
      "Need a final report fixture, or US7_TEST_DB_ALLOW_WRITES=1 with a dedicated test DB",
    );
    const cases = [
      {
        base: "/reports/completion-rate",
        queries: [
          "",
          "?q=khong_tim_thay_US7",
          "?status=Ho%C3%A0n%20th%C3%A0nh",
        ],
      },
      {
        base: "/reports/interns-by-origin",
        queries: ["", "?q=khong_tim_thay_US7", "?groupBy=major&limit=2"],
      },
      {
        base: "/attendance/report",
        queries: [
          "?from=2026-01-01&to=2026-01-31",
          "?from=2026-01-01&to=2026-01-31&scope_type=UNIVERSITY&scope_value=khong_tim_thay_US7",
        ],
      },
      { base: `/final-reports/${id}`, queries: [""] },
    ];
    for (const { base, queries } of cases) {
      const noToken = await get(base + "/export.xlsx");
      assert.equal(noToken.res.status, 401);
      assert.equal(
        noToken.res.headers.get("cache-control"),
        "private, no-store",
      );
      for (const role of ["Admin", "Mentor", "Intern"])
        assert.equal(
          (await get(base + "/export.xlsx", tokens[role])).res.status,
          403,
          base + role,
        );
      for (const query of [
        "?foo=x",
        "?q=a&q=b",
        ...(base.includes("final-reports")
          ? []
          : ["?from=2026-02-30", "?from=2026-02-02&to=2026-01-01"]),
      ])
        assert.equal(
          (await get(base + "/export.xlsx" + query, tokens.HR)).res.status,
          400,
          base + query,
        );
      for (const query of queries) {
        const jsonResult = await get(base + query, tokens.HR);
        assert.equal(jsonResult.res.status, 200);
        const model = JSON.parse(jsonResult.bytes).data.exportModel;
        const xlsx = await get(base + "/export.xlsx" + query, tokens.HR);
        assert.equal(xlsx.res.status, 200, xlsx.bytes.toString().slice(0, 150));
        assert.equal(xlsx.res.headers.get("content-type"), MIME);
        assert.equal(
          xlsx.res.headers.get("cache-control"),
          "private, no-store",
        );
        assert.match(
          xlsx.res.headers.get("content-disposition"),
          /filename="[\x20-\x7e]+_\d{4}-\d{2}-\d{2}\.xlsx"; filename\*=UTF-8''/,
        );
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(xlsx.bytes);
        assert.equal(book.worksheets.length, model.tables.length);
        for (let t = 0; t < model.tables.length; t++) {
          const table = model.tables[t],
            sheet = book.worksheets[t],
            header = sheet.views[0].ySplit;
          table.rows.forEach((row, n) =>
            row.forEach((value, c) => {
              const actual = sheet.getRow(header + n + 1).getCell(c + 1).value;
              if (table.columns[c].type === "date" && value)
                assert.equal(actual.toISOString().slice(0, 10), value);
              else
                assert.equal(
                  actual,
                  value == null || value === "" ? null : value,
                );
            }),
          );
        }
        const csv = await get(base + "/export.csv" + query, tokens.HR);
        assert.equal(csv.res.status, 200);
        const parsed = csvRows(csv.bytes.toString());
        if (base.includes("completion-rate"))
          assert.equal(
            Number(parsed.find((r) => r[0] === "Tổng quan")[2]),
            model.tables[0].rows[0][1],
          );
        else if (base.includes("interns-by-origin"))
          assert.equal(
            Number(
              /Tổng số thực tập sinh: (\d+)/.exec(csv.bytes.toString())[1],
            ),
            model.tables[0].rows[0][1],
          );
        else {
          const table = model.tables.find((t) => t.name === "Thực tập sinh");
          assert.equal(parsed.length - 1, table.rows.length);
          table.rows.forEach((row, n) =>
            row.forEach((value, c) => {
              let expected = value == null ? "" : String(value);
              if (table.columns[c].type === "percent" && value != null)
                assert.ok(
                  Math.abs(Number(parsed[n + 1][c]) - value * 100) < 1e-8,
                );
              else if (table.columns[c].type === "number" && value != null)
                assert.equal(Number(parsed[n + 1][c]), Number(value));
              else {
                if (/^[=+\-@]/.test(expected)) expected = "'" + expected;
                assert.equal(parsed[n + 1][c], expected);
              }
            }),
          );
        }
      }
      console.log(
        `[PASS] ${base}: HR XLSX, 401/403/400, headers, workbook readback, CSV/filter consistency`,
      );
    }
    assert.equal(
      (await get("/final-reports/9007199254740990/export.xlsx", tokens.HR)).res
        .status,
      404,
    );
    assert.equal(
      (await get("/final-reports/foo/export.xlsx", tokens.HR)).res.status,
      400,
    );
    console.log("[PASS] Missing/invalid report IDs return 404/400");
  } finally {
    if (createdId)
      await conn.query("DELETE FROM final_reports WHERE id=?", [createdId]);
    await conn.end();
  }
}
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
