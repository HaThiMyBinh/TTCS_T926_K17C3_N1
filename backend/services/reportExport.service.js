// Story 7.1: xuất báo cáo tổng hợp ra Excel (.xlsx) cho HR, gom dữ liệu từ báo cáo Story 5 (thực tập sinh theo
// trường/ngành) và Story 6 (tỷ lệ hoàn thành, chuyên cần). Phần dựng sheet là hàm thuần để unit test không cần MySQL.
const { HttpError } = require("../errors");
const { buildXlsx } = require("../utils/xlsxWriter");

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ATTENDANCE_KEYS = ["from", "to", "scope_type", "scope_value"];
const SCHOOL_KEYS = ["university", "major"];

// Tỷ lệ phần trăm làm tròn 2 chữ số; mẫu số 0 trả về 0 (cùng công thức với test Story 6).
function percentage(part, total) {
  if (!total || total <= 0) return 0;
  return Math.round((part / total) * 10000) / 100;
}

const int = (value) => ({ value, format: "int" });

function formatDateTime(date) {
  const vn = new Date(date.getTime() + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(vn.getUTCDate())}/${p(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()} ${p(vn.getUTCHours())}:${p(vn.getUTCMinutes())}`;
}
function formatDate(iso) {
  const [y, m, d] = String(iso).split("-");
  return d && m && y ? `${d}/${m}/${y}` : String(iso);
}

const SCOPE_LABELS = { ALL: "Toàn bộ thực tập sinh", UNIVERSITY: "Trường", PROGRAM: "Chương trình (mã)", MENTOR: "Mentor (mã)" };

// Dựng danh sách sheet từ dữ liệu đã tính sẵn.
// school = kết quả getSchoolStatsReport; attendance = kết quả attendanceReport.report.
function buildReportSheets({ school, attendance, filters = {}, generatedAt = new Date() }) {
  const st = school.summary;
  const completionRate = percentage(st.completed, st.total);
  const at = attendance.summary;

  const filterText = [
    filters.university ? `Trường: ${filters.university}` : null,
    filters.major ? `Ngành: ${filters.major}` : null,
  ].filter(Boolean).join("; ") || "Không lọc";
  const scopeText = attendance.scope.type === "ALL"
    ? SCOPE_LABELS.ALL
    : `${SCOPE_LABELS[attendance.scope.type] || attendance.scope.type}: ${attendance.scope.value}`;

  const overview = {
    name: "Tổng quan",
    titleRows: [
      "BÁO CÁO TỔNG HỢP THỰC TẬP SINH",
      `Ngày xuất: ${formatDateTime(generatedAt)}`,
      `Kỳ chuyên cần: ${formatDate(attendance.range.from)} - ${formatDate(attendance.range.to)}`,
      `Phạm vi chuyên cần: ${scopeText}`,
      `Bộ lọc trường/ngành: ${filterText}`,
    ],
    columns: [
      { header: "Chỉ số", width: 42 },
      { header: "Giá trị", width: 18, format: "decimal" },
    ],
    rows: [
      ["Tổng số thực tập sinh (theo trường/ngành)", int(st.total)],
      ["Đang thực tập", int(st.inProgress)],
      ["Hoàn thành", int(st.completed)],
      ["Tạm dừng / Bỏ học", int(st.dropped)],
      ["Trạng thái khác", int(st.other)],
      ["Số trường", int(st.schoolCount)],
      ["Tỷ lệ hoàn thành (%)", completionRate],
      ["Thực tập sinh có dữ liệu chuyên cần", int(at.totalInterns)],
      ["Ngày phải đi làm", int(at.requiredDays)],
      ["Ngày có mặt", int(at.presentDays)],
      ["Ngày nghỉ phép", int(at.leaveDays)],
      ["Ngày vắng không phép", int(at.absentDays)],
      ["Tỷ lệ chuyên cần chung (%)", at.attendanceRate],
    ],
  };

  const schoolSheet = {
    name: "Theo trường - ngành",
    titleRows: ["THỐNG KÊ THỰC TẬP SINH THEO TRƯỜNG / NGÀNH"],
    columns: [
      { header: "Trường", width: 38 },
      { header: "Ngành", width: 30 },
      { header: "Tổng TTS", width: 12, format: "int" },
      { header: "Đang thực tập", width: 14, format: "int" },
      { header: "Hoàn thành", width: 12, format: "int" },
      { header: "Tạm dừng / Bỏ học", width: 18, format: "int" },
      { header: "Khác", width: 10, format: "int" },
      { header: "Tỷ lệ hoàn thành (%)", width: 20, format: "decimal" },
    ],
    rows: school.rows.map((r) => [
      r.university, r.major, r.total, r.inProgress, r.completed, r.dropped, r.other,
      percentage(r.completed, r.total),
    ]),
  };

  const attendanceSheet = {
    name: "Chuyên cần",
    titleRows: [
      "BÁO CÁO CHUYÊN CẦN THỰC TẬP SINH",
      `Kỳ: ${formatDate(attendance.range.from)} - ${formatDate(attendance.range.to)}`,
    ],
    columns: [
      { header: "Họ tên", width: 26 },
      { header: "Mã sinh viên", width: 15 },
      { header: "Trường", width: 34 },
      { header: "Chương trình", width: 26 },
      { header: "Mentor", width: 22 },
      { header: "Lịch áp dụng", width: 30 },
      { header: "Ngày phải đi làm", width: 16, format: "int" },
      { header: "Có mặt", width: 10, format: "int" },
      { header: "Nghỉ phép", width: 11, format: "int" },
      { header: "Vắng không phép", width: 16, format: "int" },
      { header: "Chờ duyệt nghỉ", width: 15, format: "int" },
      { header: "Đi muộn", width: 10, format: "int" },
      { header: "Về sớm", width: 10, format: "int" },
      { header: "Thiếu giờ", width: 10, format: "int" },
      { header: "Thiếu check-out", width: 15, format: "int" },
      { header: "Làm ngoài lịch", width: 14, format: "int" },
      { header: "Tổng giờ làm", width: 13, format: "decimal" },
      { header: "Tỷ lệ chuyên cần (%)", width: 20, format: "decimal" },
    ],
    rows: attendance.interns.map((r) => [
      r.intern.fullName, r.intern.studentCode, r.intern.university, r.intern.programName, r.intern.mentorName,
      r.scheduleSource ? `${r.scheduleName} (${r.scheduleSource})` : "",
      r.requiredDays, r.presentDays, r.leaveDays, r.absentDays, r.pendingLeaveDays,
      r.lateCount, r.earlyLeaveCount, r.shortHoursCount, r.missingCheckoutCount, r.offScheduleDays,
      Number((r.totalWorkMinutes / 60).toFixed(1)), r.attendanceRate,
    ]),
  };

  return [overview, schoolSheet, attendanceSheet];
}

// Chỉ nhận tham số đã biết; tách phần của báo cáo chuyên cần và phần trường/ngành.
function splitQuery(query = {}) {
  const allowed = [...ATTENDANCE_KEYS, ...SCHOOL_KEYS];
  if (Object.keys(query).some((k) => !allowed.includes(k))) {
    throw new HttpError(400, "Tham số xuất báo cáo không hợp lệ!");
  }
  const pick = (keys) => Object.fromEntries(keys.filter((k) => k in query).map((k) => [k, query[k]]));
  return { attendanceQuery: pick(ATTENDANCE_KEYS), schoolQuery: pick(SCHOOL_KEYS) };
}

async function exportExcel(query = {}, { now = new Date() } = {}) {
  const { attendanceQuery, schoolQuery } = splitQuery(query);
  // Nạp muộn để unit test hàm thuần không cần kết nối MySQL.
  const attendanceService = require("./attendanceReport.service");
  const schoolService = require("./internSchoolStats.service");

  const filters = schoolService.normalizeSchoolStatsFilters(schoolQuery);
  const range = attendanceService.validate(attendanceQuery); // ném 400 nếu kỳ/phạm vi sai
  const [school, attendance] = await Promise.all([
    schoolService.getSchoolStatsReport(filters),
    attendanceService.report({ ...attendanceQuery }),
  ]);
  const sheets = buildReportSheets({ school, attendance, filters, generatedAt: now });
  return {
    filename: `bao-cao-tong-hop_${range.from}_${range.to}.xlsx`,
    contentType: XLSX_MIME,
    buffer: buildXlsx(sheets),
  };
}

module.exports = { XLSX_MIME, percentage, buildReportSheets, splitQuery, exportExcel };
