// HR xem / gán thực tập sinh từ phía mentor (tab Quản lý mentor).
const db = require("../db");
const { HttpError } = require("../errors");
const warn = require("./assignmentWarnings.service");

const MAX_BULK = 500;
function parseId(value, label) {
  if (!/^[1-9]\d*$/.test(String(value)))
    throw new HttpError(400, `${label} không hợp lệ!`);
  return Number(value);
}
async function requireMentor(rawId) {
  const id = parseId(rawId, "Mã mentor");
  const mentor = await db.findMentorById(id);
  if (!mentor) throw new HttpError(404, "Không tìm thấy mentor!");
  return mentor;
}

async function list(rawId) {
  const mentor = await requireMentor(rawId);
  return db.listMentorInterns(mentor.id);
}
async function available(rawId) {
  const mentor = await requireMentor(rawId);
  return db.listInternsNotOfMentor(mentor.id);
}

function parseBody(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (k) => !["intern_ids", "confirm_warnings"].includes(k),
    )
  )
    throw new HttpError(400, "Dữ liệu phân công không hợp lệ!");
  const ids = body.intern_ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BULK)
    throw new HttpError(
      400,
      `Danh sách thực tập sinh phải có từ 1 đến ${MAX_BULK} người!`,
    );
  if (
    ids.some((v) => typeof v !== "number" || !Number.isSafeInteger(v) || v < 1)
  )
    throw new HttpError(400, "Mã thực tập sinh phải là số nguyên dương!");
  if (new Set(ids).size !== ids.length)
    throw new HttpError(400, "Danh sách thực tập sinh bị trùng!");
  return {
    internIds: ids,
    confirmed: warn.parseConfirm(body.confirm_warnings),
  };
}

async function assign(rawId, body, deps = {}) {
  const { internIds, confirmed } = parseBody(body);
  const mentor = await requireMentor(rawId);
  // Cảnh báo chỉ tính cho những người thực sự đổi sang mentor này.
  const profiles = [];
  for (const id of internIds) {
    const p = await db.findInternProfileById(id);
    if (!p) throw new HttpError(400, `Không tìm thấy thực tập sinh: ${id}!`);
    if (Number(p.mentorId) !== mentor.id) profiles.push(p);
  }
  warn.requireConfirmation(
    warn.assignmentWarnings({
      mentor,
      interns: profiles,
      programDepartments: await db.listProgramDepartmentsForInterns(
        profiles.map((p) => p.id),
      ),
    }),
    confirmed,
  );
  const result = await db.assignMentorToInterns(mentor.id, internIds);
  if (result.outcome === "MENTOR_NOT_FOUND")
    throw new HttpError(404, "Không tìm thấy mentor!");
  if (result.outcome === "INTERN_NOT_FOUND")
    throw new HttpError(
      400,
      `Không tìm thấy thực tập sinh: ${result.missing.join(", ")}!`,
    );
  const {
    notifyProgramMentorAssignment,
  } = require("./mentorAssignment.service");
  await notifyProgramMentorAssignment(
    {
      program: null,
      mentorId: mentor.id,
      mentorName: result.mentorName,
      changed: result.changed,
    },
    deps,
  );
  return {
    mentor_id: mentor.id,
    mentor_name: result.mentorName,
    updated: result.changed.length,
    unchanged: result.unchanged,
  };
}

module.exports = { list, available, assign };
