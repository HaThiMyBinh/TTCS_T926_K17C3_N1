// Story 5.1: thống kê số lượng thực tập sinh theo trường/ngành và trạng thái (đang học / hoàn thành / bỏ học).
// Dữ liệu thô lấy từ view `v_intern_school_stats` (xem schema.sql / db.js).
const { HttpError } = require("../errors");

const MAX_FILTER_LENGTH = 100;
const FILTER_KEYS = ["university", "major"];

// Hàm thuần (dễ unit test): chuẩn hoá tham số lọc, ném HttpError 400 nếu sai.
function normalizeSchoolStatsFilters(query = {}) {
  const filters = {};
  for (const key of FILTER_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(query, key)) continue;
    const value = query[key];
    if (typeof value !== "string") {
      throw new HttpError(400, `Tham số ${key} phải là một chuỗi duy nhất.`);
    }
    const normalized = value.trim();
    if (normalized.length > MAX_FILTER_LENGTH) {
      throw new HttpError(
        400,
        `Tham số ${key} không được vượt quá ${MAX_FILTER_LENGTH} ký tự.`,
      );
    }
    if (normalized) filters[key] = normalized;
  }
  return filters;
}

function emptyTotals() {
  return { total: 0, inProgress: 0, completed: 0, dropped: 0, other: 0 };
}

// Hàm thuần: gom các dòng (trường, ngành) thành tổng toàn bộ + tổng theo từng trường.
function buildSchoolStatsReport(rows) {
  const totals = emptyTotals();
  const bySchool = new Map();

  for (const row of rows) {
    for (const key of Object.keys(totals)) totals[key] += Number(row[key]) || 0;

    if (!bySchool.has(row.university)) {
      bySchool.set(row.university, {
        university: row.university,
        ...emptyTotals(),
        majors: [],
      });
    }
    const school = bySchool.get(row.university);
    for (const key of Object.keys(totals)) school[key] += Number(row[key]) || 0;
    school.majors.push({
      major: row.major,
      total: Number(row.total) || 0,
      inProgress: Number(row.inProgress) || 0,
      completed: Number(row.completed) || 0,
      dropped: Number(row.dropped) || 0,
      other: Number(row.other) || 0,
    });
  }

  const schools = [...bySchool.values()].sort(
    (a, b) => b.total - a.total || a.university.localeCompare(b.university, "vi"),
  );
  return { summary: { ...totals, schoolCount: schools.length }, schools, rows };
}

// Truy vấn: danh sách dòng thống kê (phẳng) + bản tổng hợp theo trường.
async function getSchoolStatsReport(query = {}) {
  // Nạp db khi cần để unit test các hàm thuần không phải kết nối MySQL.
  const db = require("../db");
  const filters = normalizeSchoolStatsFilters(query);
  const rows = await db.listInternSchoolStats(filters);
  return buildSchoolStatsReport(rows);
}

module.exports = {
  normalizeSchoolStatsFilters,
  buildSchoolStatsReport,
  getSchoolStatsReport,
};
