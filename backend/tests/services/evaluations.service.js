// Nghiệp vụ đánh giá tổng kết thực tập sinh của mentor: chấm điểm kỹ năng + thái độ (1-5)
// kèm nhận xét. Mỗi thực tập sinh tối đa 1 đánh giá; mentor gửi lại thì cập nhật.
const db = require("../db");
const { HttpError } = require("../errors");
const { assertHasConfirmedContract } = require("./contractGate");

const SCORE_MIN = 1;
const SCORE_MAX = 5;
const COMMENT_MAX_LENGTH = 2000;
const EVALUATION_FIELDS = [
  "skill_score",
  "skill_comment",
  "attitude_score",
  "attitude_comment",
  "overall_comment",
];

function has(input, key) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function parseId(rawId, label) {
  const text = String(rawId ?? "");
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new HttpError(400, `${label} không hợp lệ!`);
  }
  return Number(text);
}

function validateScore(input, key, label) {
  const value = input[key];
  if (value === undefined || value === null || value === "") {
    throw new HttpError(400, `Vui lòng chấm điểm ${label}!`);
  }
  // Chỉ nhận số nguyên thật (không nhận chuỗi "4", 4.5, true...).
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new HttpError(400, `Điểm ${label} phải là số nguyên!`);
  }
  if (value < SCORE_MIN || value > SCORE_MAX) {
    throw new HttpError(
      400,
      `Điểm ${label} phải từ ${SCORE_MIN} đến ${SCORE_MAX}!`,
    );
  }
  return value;
}

function validateComment(input, key, label, { required = false } = {}) {
  if (!has(input, key) || input[key] === null || input[key] === undefined) {
    if (required) throw new HttpError(400, `Vui lòng nhập ${label}!`);
    return null;
  }
  if (typeof input[key] !== "string") {
    throw new HttpError(400, `${label} phải là chuỗi!`);
  }
  const text = input[key].trim();
  if (!text) {
    if (required) throw new HttpError(400, `Vui lòng nhập ${label}!`);
    return null;
  }
  if (text.length > COMMENT_MAX_LENGTH) {
    throw new HttpError(
      400,
      `${label} không được vượt quá ${COMMENT_MAX_LENGTH} ký tự!`,
    );
  }
  return text;
}

/**
 * Chuẩn hóa và kiểm tra dữ liệu đánh giá.
 * Trả về { skillScore, skillComment, attitudeScore, attitudeComment, overallComment }.
 */
function validateEvaluationInput(input) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "Dữ liệu đánh giá không hợp lệ!");
  }
  const extra = Object.keys(input).filter((k) => !EVALUATION_FIELDS.includes(k));
  if (extra.length > 0) {
    throw new HttpError(
      400,
      "Đánh giá chỉ nhận skill_score, skill_comment, attitude_score, attitude_comment và overall_comment!",
    );
  }
  return {
    skillScore: validateScore(input, "skill_score", "kỹ năng"),
    skillComment: validateComment(input, "skill_comment", "Nhận xét kỹ năng"),
    attitudeScore: validateScore(input, "attitude_score", "thái độ"),
    attitudeComment: validateComment(
      input,
      "attitude_comment",
      "Nhận xét thái độ",
    ),
    overallComment: validateComment(
      input,
      "overall_comment",
      "Nhận xét tổng kết",
      { required: true },
    ),
  };
}

// Điểm tổng = trung bình điểm kỹ năng và thái độ, làm tròn 1 chữ số thập phân.
function computeOverallScore(skillScore, attitudeScore) {
  return Math.round(((Number(skillScore) + Number(attitudeScore)) / 2) * 10) / 10;
}

function toEvaluationDto(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    intern_id: Number(row.internId),
    intern_name: row.internName || "",
    student_code: row.studentCode || "",
    skill_score: Number(row.skillScore),
    skill_comment: row.skillComment || "",
    attitude_score: Number(row.attitudeScore),
    attitude_comment: row.attitudeComment || "",
    overall_comment: row.overallComment,
    overall_score: computeOverallScore(row.skillScore, row.attitudeScore),
    mentor_name: row.mentorName || "",
    created_at: row.createdAt || null,
    updated_at: row.updatedAt || null,
  };
}

async function requireMentorProfile(user) {
  const mentor =
    user?.role === "Mentor" && user.email
      ? await db.findMentorByEmail(user.email)
      : null;
  if (!mentor) {
    throw new HttpError(
      403,
      "Tài khoản chưa có hồ sơ mentor để đánh giá thực tập sinh!",
    );
  }
  return mentor;
}

// Thực tập sinh phải tồn tại và do mentor này phụ trách (chống IDOR).
async function loadInternForMentor(user, rawInternId) {
  const internId = parseId(rawInternId, "Mã thực tập sinh");
  const mentor = await requireMentorProfile(user);
  const intern = await db.findInternProfileById(internId);
  if (!intern) throw new HttpError(404, "Không tìm thấy thực tập sinh!");
  if (!intern.mentorId || Number(intern.mentorId) !== Number(mentor.id)) {
    throw new HttpError(
      403,
      "Bạn chỉ được đánh giá thực tập sinh được phân công cho mình!",
    );
  }
  return { mentor, intern };
}

// Chưa có đánh giá thì trả null (không phải lỗi 404).
async function getEvaluation(user, rawInternId) {
  const { intern } = await loadInternForMentor(user, rawInternId);
  return toEvaluationDto(await db.findInternEvaluation(intern.id));
}

async function saveEvaluation(user, rawInternId, body) {
  const { mentor, intern } = await loadInternForMentor(user, rawInternId);
  const value = validateEvaluationInput(body);
  await assertHasConfirmedContract(
    intern.id,
    "Thực tập sinh chưa có hợp đồng được xác nhận nên chưa thể đánh giá!",
  );
  const row = await db.upsertInternEvaluation({
    internId: intern.id,
    mentorId: mentor.id,
    ...value,
  });
  return toEvaluationDto(row);
}

async function deleteEvaluation(user, rawInternId) {
  const { intern } = await loadInternForMentor(user, rawInternId);
  const removed = await db.deleteInternEvaluation(intern.id);
  if (!removed) {
    throw new HttpError(404, "Thực tập sinh này chưa được đánh giá!");
  }
  return null;
}

// Bảng tổng quan: mọi thực tập sinh của mentor + trạng thái đã/chưa đánh giá.
async function getMentorOverview(user) {
  const mentor = await requireMentorProfile(user);
  const rows = await db.listEvaluationsForMentor(mentor.id);
  const interns = rows.map((r) => {
    const evaluated = Boolean(r.evaluationId);
    return {
      intern_id: Number(r.internId),
      intern_name: r.internName || "",
      student_code: r.studentCode || "",
      has_evaluation: evaluated,
      skill_score: evaluated ? Number(r.skillScore) : null,
      attitude_score: evaluated ? Number(r.attitudeScore) : null,
      overall_score: evaluated
        ? computeOverallScore(r.skillScore, r.attitudeScore)
        : null,
      updated_at: evaluated ? r.updatedAt || null : null,
    };
  });
  const evaluated = interns.filter((i) => i.has_evaluation).length;
  return {
    summary: {
      total: interns.length,
      evaluated,
      pending: interns.length - evaluated,
    },
    interns,
  };
}

module.exports = {
  SCORE_MIN,
  SCORE_MAX,
  COMMENT_MAX_LENGTH,
  validateEvaluationInput,
  computeOverallScore,
  toEvaluationDto,
  getEvaluation,
  saveEvaluation,
  deleteEvaluation,
  getMentorOverview,
};
