// Cảnh báo mềm khi HR phân công mentor: không chặn cứng, nhưng bắt buộc HR xác nhận (confirm_warnings = true).
const { HttpError } = require("../errors");

const ACTIVE_STATUS = "Đang thực tập";
const MAX_NAMES = 5;

function normDept(value) {
  const s = String(value || "")
    .trim()
    .toLocaleLowerCase("vi");
  return !s || s === "chưa cập nhật" ? "" : s;
}
function namesOf(list) {
  const names = list.map((i) => i.fullName);
  return (
    names.slice(0, MAX_NAMES).join(", ") +
    (names.length > MAX_NAMES
      ? ` và ${names.length - MAX_NAMES} người khác`
      : "")
  );
}

// mentor: { fullName, department }; interns: [{ id, fullName, status }];
// programDepartments: Map<internId, string[]> — phòng ban của các chương trình mà thực tập sinh thuộc về.
function assignmentWarnings({
  mentor,
  interns,
  programDepartments = new Map(),
}) {
  const warnings = [];
  const inactive = interns.filter(
    (i) => i.status && i.status !== ACTIVE_STATUS,
  );
  if (inactive.length) {
    warnings.push({
      type: "INACTIVE_INTERN",
      internIds: inactive.map((i) => i.id),
      message:
        inactive.length === 1
          ? `${inactive[0].fullName} đang ở trạng thái "${inactive[0].status}", không phải "${ACTIVE_STATUS}".`
          : `${inactive.length} thực tập sinh không ở trạng thái "${ACTIVE_STATUS}": ${namesOf(inactive)}.`,
    });
  }
  const mentorDept = normDept(mentor && mentor.department);
  if (mentorDept) {
    const mismatched = interns.filter((i) => {
      const depts = (programDepartments.get(Number(i.id)) || [])
        .map(normDept)
        .filter(Boolean);
      return depts.length > 0 && !depts.includes(mentorDept);
    });
    if (mismatched.length) {
      warnings.push({
        type: "DEPARTMENT_MISMATCH",
        internIds: mismatched.map((i) => i.id),
        message: `Mentor ${mentor.fullName} thuộc phòng ban "${mentor.department}", nhưng chương trình của ${namesOf(mismatched)} thuộc phòng ban khác.`,
      });
    }
  }
  return warnings;
}

function parseConfirm(value) {
  if (value === undefined) return false;
  if (typeof value !== "boolean")
    throw new HttpError(400, "confirm_warnings phải là true hoặc false!");
  return value;
}

// Ném 409 NEEDS_CONFIRMATION nếu có cảnh báo mà HR chưa xác nhận.
function requireConfirmation(warnings, confirmed) {
  if (warnings.length && !confirmed)
    throw new HttpError(
      409,
      "Cần xác nhận trước khi phân công: " +
        warnings.map((w) => w.message).join(" "),
      {
        code: "NEEDS_CONFIRMATION",
        warnings: warnings.map((w) => ({ type: w.type, message: w.message })),
      },
    );
}

module.exports = {
  assignmentWarnings,
  parseConfirm,
  requireConfirmation,
  ACTIVE_STATUS,
};
