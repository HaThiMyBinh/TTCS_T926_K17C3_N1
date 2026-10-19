// Unit test Story 7.1: xuất báo cáo Excel (không cần MySQL / backend).
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildXlsx, columnName, safeSheetName } = require("../utils/xlsxWriter");
const { percentage, buildReportSheets, splitQuery } = require("../services/reportExport.service");

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`[FAIL] ${name}: ${err.message}`);
  }
}

const school = {
  summary: { total: 10, inProgress: 4, completed: 5, dropped: 1, other: 0, schoolCount: 2 },
  rows: [
    { university: "ĐH Công nghệ Thông tin & Truyền thông", major: "Kỹ thuật phần mềm", total: 6, inProgress: 2, completed: 4, dropped: 0, other: 0 },
    { university: "=HYPERLINK(\"http://x\")", major: "Khoa học máy tính", total: 4, inProgress: 2, completed: 1, dropped: 1, other: 0 },
  ],
};
const attendance = {
  range: { from: "2026-10-01", to: "2026-10-16" },
  scope: { type: "ALL", value: "" },
  summary: { totalInterns: 1, requiredDays: 10, presentDays: 8, leaveDays: 1, absentDays: 1, attendanceRate: 88.9 },
  interns: [{
    intern: { fullName: "Nguyễn Văn Ánh", studentCode: "SV001", university: "ĐH CNTT&TT", programName: "Thực tập hè", mentorName: "Trần Thị Bình" },
    scheduleName: "Giờ hành chính", scheduleSource: "Mặc định",
    requiredDays: 10, presentDays: 8, leaveDays: 1, absentDays: 1, pendingLeaveDays: 0,
    lateCount: 2, earlyLeaveCount: 0, shortHoursCount: 0, missingCheckoutCount: 0, offScheduleDays: 0,
    totalWorkMinutes: 3840, attendanceRate: 88.9,
  }],
};

async function run() {
  console.log("=== UNIT TEST: XUẤT BÁO CÁO EXCEL (TASK 7.1) ===");

  await check("Tỷ lệ phần trăm đúng và không chia cho 0", async () => {
    assert.equal(percentage(8, 10), 80);
    assert.equal(percentage(1, 3), 33.33);
    assert.equal(percentage(0, 0), 0);
  });

  await check("Tên cột Excel (A..Z, AA..)", async () => {
    assert.equal(columnName(0), "A");
    assert.equal(columnName(25), "Z");
    assert.equal(columnName(26), "AA");
  });

  await check("Tên sheet hợp lệ, cắt 31 ký tự và không trùng", async () => {
    const used = new Set();
    assert.equal(safeSheetName("a/b:c", used), "a b c");
    assert.equal(safeSheetName("a/b:c", used), "a b c (2)");
    assert.ok(safeSheetName("x".repeat(50), used).length <= 31);
  });

  await check("Sheet có dòng tiêu đề, đủ cột, số dòng khớp dữ liệu", async () => {
    const sheets = buildReportSheets({ school, attendance, generatedAt: new Date("2026-10-16T03:00:00Z") });
    assert.deepEqual(sheets.map((s) => s.name), ["Tổng quan", "Theo trường - ngành", "Chuyên cần"]);
    assert.equal(sheets[1].rows.length, 2);
    assert.equal(sheets[2].rows.length, 1);
    for (const s of sheets) {
      for (const row of s.rows) assert.equal(row.length, s.columns.length, `${s.name}: số ô khác số cột`);
    }
    assert.equal(sheets[1].rows[0][7], 66.67, "Tỷ lệ hoàn thành 4/6");
    assert.equal(sheets[2].rows[0][16], 64, "3840 phút = 64 giờ");
    assert.ok(sheets[0].titleRows[1].includes("16/10/2026 10:00"), "Giờ xuất theo múi giờ Việt Nam");
  });

  await check("File .xlsx là zip hợp lệ, UTF-8 giữ nguyên tiếng Việt", async () => {
    const buf = buildXlsx(buildReportSheets({ school, attendance }));
    assert.equal(buf.readUInt32LE(0), 0x04034b50, "Phải bắt đầu bằng chữ ký ZIP");
    assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50, "Phải kết thúc bằng bản ghi EOCD");
    const out = path.join(os.tmpdir(), `report-export-${process.pid}.xlsx`);
    fs.writeFileSync(out, buf);
    fs.unlinkSync(out);
  });

  await check("Chỉ nhận tham số đã biết, từ chối tham số lạ", async () => {
    const { attendanceQuery, schoolQuery } = splitQuery({ from: "2026-10-01", university: "ICTU" });
    assert.deepEqual(attendanceQuery, { from: "2026-10-01" });
    assert.deepEqual(schoolQuery, { university: "ICTU" });
    assert.throws(() => splitQuery({ hack: "1" }), (e) => e.status === 400);
  });

  console.log(`\nKết quả Unit Test Story 7: ${passed} PASS, ${failed} FAIL`);
  if (failed > 0) process.exit(1);
}

run();
