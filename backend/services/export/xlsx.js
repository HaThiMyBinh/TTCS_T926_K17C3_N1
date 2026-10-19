const ExcelJS = require("exceljs");
const { HttpError } = require("../../errors");
const { isValidDate } = require("../../utils/weeks");
const MAX_ROWS = 10000;
const MAX_COLUMNS = 100;
const MAX_CELLS = 250000;
const MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
function sheetName(name, used) {
  let base =
    String(name || "Báo cáo")
      .replace(/[:\\/?*\[\]\x00-\x1f]/g, " ")
      .replace(/^'+|'+$/g, "")
      .trim() || "Báo cáo";
  if (base.toLowerCase() === "history") base = "History báo cáo";
  let result = base.slice(0, 31).replace(/[\uD800-\uDBFF]$/, ""),
    n = 1;
  while (used.has(result.toLowerCase())) {
    const suffix = ` (${++n})`;
    result = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(result.toLowerCase());
  return result;
}
function filenames(model) {
  const date = isValidDate(model.exportedDate) ? model.exportedDate : "export";
  const stem = String(model.fileBase || "bao-cao")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 100);
  const title =
    String(model.title || "Báo cáo")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
      .trim()
      .slice(0, 100) || "Báo cáo";
  return { ascii: `${stem}_${date}.xlsx`, unicode: `${title}_${date}.xlsx` };
}
function assertLimits(model) {
  let rows = 0,
    cells = 0;
  if (!model?.tables?.length || model.tables.length > 20)
    throw new HttpError(400, "Mô hình xuất không hợp lệ!");
  for (const t of model.tables) {
    rows += t.rows.length + (t.totals ? 1 : 0);
    cells += (t.rows.length + 1) * t.columns.length;
    if (!t.columns.length || t.columns.length > MAX_COLUMNS)
      throw new HttpError(400, "Báo cáo có quá nhiều cột để xuất!");
  }
  if (rows > MAX_ROWS || cells > MAX_CELLS)
    throw new HttpError(
      400,
      "Báo cáo quá lớn. Vui lòng thu hẹp bộ lọc trước khi xuất!",
    );
}
function cellValue(value, type) {
  if (value == null || value === "") return null;
  if (type === "number" || type === "percent")
    return Number.isFinite(Number(value)) ? Number(value) : null;
  if (type === "date")
    return isValidDate(value) ? new Date(`${value}T00:00:00.000Z`) : null;
  // ExcelJS treats scalar strings as text; formulas require an explicit { formula } object.
  // Never pass objects/rich text/hyperlinks from report data to ExcelJS.
  return String(value).slice(0, 32767);
}
async function renderXlsx(model) {
  assertLimits(model);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "HR";
  const used = new Set();
  for (const t of model.tables) {
    const sheet = workbook.addWorksheet(sheetName(t.name, used));
    sheet.columns = t.columns.map((c) => ({
      width: Math.min(55, Math.max(12, c.width || 24)),
    }));
    sheet.addRow([String(model.title || "Báo cáo")]);
    if (t.columns.length > 1) sheet.mergeCells(1, 1, 1, t.columns.length);
    sheet.getRow(1).font = {
      name: "Arial",
      size: 16,
      bold: true,
      color: { argb: "FF2563EB" },
    };
    sheet.getRow(1).alignment = { vertical: "middle", wrapText: true };
    sheet.getRow(1).height = Math.max(
      36,
      Math.ceil(
        String(model.title).length /
          t.columns.reduce((n, c) => n + (c.width || 24), 0),
      ) * 22,
    );
    const timestamp = sheet.addRow([
      `Thời điểm xuất (giờ Việt Nam): ${model.exportedAt}`,
    ]);
    if (t.columns.length > 1)
      sheet.mergeCells(timestamp.number, 1, timestamp.number, t.columns.length);
    timestamp.alignment = { wrapText: true };
    timestamp.height = 30;
    for (const line of model.info || []) {
      const row = sheet.addRow([String(line)]);
      if (t.columns.length > 1)
        sheet.mergeCells(row.number, 1, row.number, t.columns.length);
      row.alignment = { wrapText: true, vertical: "top" };
      row.height = Math.max(30, Math.ceil(String(line).length / 100) * 15);
    }
    sheet.addRow([]);
    const header = sheet.addRow(t.columns.map((c) => String(c.label ?? "")));
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2563EB" },
    };
    sheet.views = [{ state: "frozen", ySplit: header.number }];
    sheet.autoFilter = {
      from: { row: header.number, column: 1 },
      to: { row: header.number, column: t.columns.length },
    };
    const append = (values, total = false) => {
      const row = sheet.addRow(
        t.columns.map((c, i) => cellValue(values[i], c.type)),
      );
      if (total) row.font = { bold: true };
      t.columns.forEach((c, i) => {
        if (c.type === "percent") row.getCell(i + 1).numFmt = "0.0%";
        if (c.type === "date") row.getCell(i + 1).numFmt = "dd/mm/yyyy";
        if (c.type === "number")
          row.getCell(i + 1).numFmt = Number.isInteger(row.getCell(i + 1).value)
            ? "0"
            : "0.0#########";
      });
      return row;
    };
    for (const row of t.rows) append(row);
    if (!t.rows.length) sheet.addRow(["Không có dữ liệu phù hợp."]);
    if (t.totals) append(t.totals, true);
    for (let n = header.number; n <= sheet.rowCount; n++) {
      const row = sheet.getRow(n);
      row.alignment = { vertical: "top", wrapText: true };
      row.height = Math.min(
        409,
        Math.max(
          n === header.number ? 30 : 18,
          ...Array.from(row.values).map(
            (v) => Math.ceil(String(v ?? "").length / 25) * 15,
          ),
        ),
      );
      for (let c = 1; c <= t.columns.length; c++)
        row.getCell(c).border = Object.fromEntries(
          ["top", "bottom", "left", "right"].map((edge) => [
            edge,
            { style: "thin", color: { argb: "FFD1D5DB" } },
          ]),
        );
    }
    sheet.pageSetup = {
      paperSize: 9,
      orientation: t.columns.length > 6 ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: `${header.number}:${header.number}`,
    };
    sheet.headerFooter.oddFooter = "Trang &P / &N";
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
module.exports = {
  MAX_ROWS,
  MAX_COLUMNS,
  MAX_CELLS,
  MIME,
  filenames,
  sheetName,
  renderXlsx,
};
