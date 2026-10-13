// Nghiệp vụ khối lượng công việc của mentor (số thực tập sinh đang phụ trách).
const { HttpError } = require("../errors");
const { normalizeInternFilters } = require("../utils/internFilters");

// Ngưỡng cấu hình qua biến môi trường (tỉ lệ so với mức trung bình):
//   WORKLOAD_LIGHT_RATIO      mặc định 0.7 -> tải < 70% trung bình = "nhẹ"
//   WORKLOAD_OVERLOAD_RATIO   mặc định 1.3 -> tải > 130% trung bình = "quá tải"
// Nằm giữa hai ngưỡng (bao gồm cả hai đầu) = "cân bằng".
const DEFAULT_LIGHT_RATIO = 0.7;
const DEFAULT_OVERLOAD_RATIO = 1.3;

const LOAD_LEVELS = {
  LIGHT: "LIGHT",
  BALANCED: "BALANCED",
  OVERLOADED: "OVERLOADED",
};
const LOAD_LABELS = {
  LIGHT: "Nhẹ",
  BALANCED: "Cân bằng",
  OVERLOADED: "Quá tải",
};

function readRatio(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getThresholds(env = process.env) {
  let light = readRatio(env.WORKLOAD_LIGHT_RATIO, DEFAULT_LIGHT_RATIO);
  let overload = readRatio(env.WORKLOAD_OVERLOAD_RATIO, DEFAULT_OVERLOAD_RATIO);
  // Cấu hình sai thứ tự (nhẹ > quá tải) thì quay về mặc định để tránh nhãn vô nghĩa.
  if (light > overload) {
    light = DEFAULT_LIGHT_RATIO;
    overload = DEFAULT_OVERLOAD_RATIO;
  }
  return { lightRatio: light, overloadRatio: overload };
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

// Trung bình = tổng TTS đã có mentor / tổng số mentor (mentor 0 TTS vẫn tính vào mẫu số).
function classifyLoad(internCount, average, thresholds) {
  if (!(average > 0)) {
    return { percentVsAverage: 0, loadLevel: LOAD_LEVELS.BALANCED };
  }
  const ratio = internCount / average;
  let loadLevel = LOAD_LEVELS.BALANCED;
  if (ratio < thresholds.lightRatio) loadLevel = LOAD_LEVELS.LIGHT;
  else if (ratio > thresholds.overloadRatio) loadLevel = LOAD_LEVELS.OVERLOADED;
  return { percentVsAverage: round1(ratio * 100), loadLevel };
}

// Hàm thuần (dễ unit test): ghép dữ liệu thô thành báo cáo khối lượng.
function buildWorkloadReport(rows, unassignedInterns, thresholds = getThresholds()) {
  const totalMentors = rows.length;
  const totalAssigned = rows.reduce((sum, r) => sum + r.internCount, 0);
  const average = totalMentors > 0 ? totalAssigned / totalMentors : 0;

  const mentors = rows.map((row) => {
    const { percentVsAverage, loadLevel } = classifyLoad(
      row.internCount,
      average,
      thresholds,
    );
    return {
      id: row.id,
      fullName: row.fullName,
      email: row.email,
      department: row.department,
      specialization: row.specialization,
      internCount: row.internCount,
      percentVsAverage,
      loadLevel,
      loadLabel: LOAD_LABELS[loadLevel],
    };
  });

  return {
    summary: {
      totalMentors,
      totalAssignedInterns: totalAssigned,
      unassignedInterns,
      averageInternsPerMentor: round1(average),
      thresholds,
    },
    mentors,
  };
}

async function getWorkloadReport() {
  // Nạp db khi cần để unit test các hàm thuần không phải kết nối MySQL.
  const db = require("../db");
  const [rows, unassignedInterns] = await Promise.all([
    db.getMentorWorkloadRows(),
    db.countInterns({ unassigned: true }),
  ]);
  return buildWorkloadReport(rows, Number(unassignedInterns));
}

function parseMentorId(rawId) {
  const text = String(rawId ?? "");
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new HttpError(400, "ID mentor không hợp lệ!");
  }
  return Number(text);
}

// Danh sách TTS của 1 mentor, kèm mức tải của mentor đó.
async function getMentorInterns(rawId, query = {}) {
  const db = require("../db");
  const mentorId = parseMentorId(rawId);
  let filters;
  try {
    filters = normalizeInternFilters(query);
  } catch (err) {
    throw new HttpError(400, err.message);
  }
  const mentor = await db.getMentorById(mentorId);
  if (!mentor) throw new HttpError(404, "Không tìm thấy mentor!");

  const [report, interns] = await Promise.all([
    getWorkloadReport(),
    db.getStudentsByMentorId(mentorId, filters),
  ]);
  const workload = report.mentors.find((m) => m.id === mentorId) || null;
  return { mentor, workload, interns };
}

module.exports = {
  LOAD_LEVELS,
  LOAD_LABELS,
  DEFAULT_LIGHT_RATIO,
  DEFAULT_OVERLOAD_RATIO,
  getThresholds,
  classifyLoad,
  buildWorkloadReport,
  getWorkloadReport,
  getMentorInterns,
  parseMentorId,
};
