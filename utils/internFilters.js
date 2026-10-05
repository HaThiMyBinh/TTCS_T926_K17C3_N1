const MAX_FILTER_LENGTH = 100;
const FILTER_KEYS = ["q", "university", "major"];

function escapeLike(value) {
  return value.replace(/[=\\%_]/g, "=$&");
}

function normalizeInternFilters(query = {}) {
  const filters = {};
  for (const key of FILTER_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(query, key)) continue;

    const value = query[key];
    if (typeof value !== "string") {
      throw new Error(`Tham số ${key} phải là một chuỗi duy nhất.`);
    }

    const normalized = value.trim();
    if (normalized.length > MAX_FILTER_LENGTH) {
      throw new Error(
        `Tham số ${key} không được vượt quá ${MAX_FILTER_LENGTH} ký tự.`,
      );
    }
    if (normalized) filters[key] = normalized;
  }

  if (Object.prototype.hasOwnProperty.call(query, "unassigned")) {
    if (
      typeof query.unassigned !== "string" ||
      !["true", "false"].includes(query.unassigned)
    ) {
      throw new Error("Tham số unassigned chỉ nhận giá trị true hoặc false.");
    }
    filters.unassigned = query.unassigned === "true";
  }

  return filters;
}

function buildInternFilterConditions(
  filters = {},
  { alias = "ip", includeUnassigned = true } = {},
) {
  const conditions = [];
  const params = [];
  const collatedColumn = (column) =>
    `CONVERT(${alias}.${column} USING utf8mb4) COLLATE utf8mb4_unicode_ci`;
  const equalityCondition = (column) =>
    `${collatedColumn(column)} = ` +
    "CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci";

  if (includeUnassigned && filters.unassigned) {
    conditions.push(`${alias}.mentor_id IS NULL`);
  }
  if (filters.university) {
    conditions.push(equalityCondition("university"));
    params.push(filters.university);
  }
  if (filters.major) {
    conditions.push(equalityCondition("major"));
    params.push(filters.major);
  }
  if (filters.q) {
    const pattern = `%${escapeLike(filters.q)}%`;
    const searchColumns = [
      "full_name",
      "student_code",
      "email",
      "university",
      "major",
    ];
    const searchConditions = searchColumns.map(
      (column) => `${collatedColumn(column)} LIKE ? ESCAPE '='`,
    );
    conditions.push(`(${searchConditions.join(" OR ")})`);
    params.push(...searchColumns.map(() => pattern));
  }

  return {
    whereSql: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

module.exports = {
  MAX_FILTER_LENGTH,
  escapeLike,
  normalizeInternFilters,
  buildInternFilterConditions,
};
