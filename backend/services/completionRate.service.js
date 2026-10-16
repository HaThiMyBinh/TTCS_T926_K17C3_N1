const db = require("../db");
const { HttpError } = require("../errors");
const weeks = require("../utils/weeks");
const { csvCell } = require("./finalReports.service");
const {
  normalizeKey,
  cleanText,
  isUnknown,
} = require("./internOriginReport.service");
const STATUSES = [
  "Đang thực tập",
  "Hoàn thành",
  "Tạm dừng",
  "Không hoàn thành",
];
const BASE_QUERY = ["programId", "programStatus", "status", "from", "to", "q"];

function validateQuery(query = {}, detail = false) {
  const allowed = detail
    ? [...BASE_QUERY, "groupBy", "groupKey", "page", "pageSize"]
    : BASE_QUERY;
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key) || typeof value !== "string") {
      throw new HttpError(400, "Tham số báo cáo không hợp lệ hoặc bị lặp!");
    }
  }
  const id = (value, fallback, max = Number.MAX_SAFE_INTEGER) => {
    if (value == null || value === "") return fallback;
    if (
      !/^[1-9]\d*$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) > max
    ) {
      throw new HttpError(400, "Mã hoặc phân trang không hợp lệ!");
    }
    return Number(value);
  };
  const status = query.status?.trim() || null;
  if (status && !STATUSES.includes(status))
    throw new HttpError(400, "Trạng thái không hợp lệ!");
  for (const key of ["from", "to"]) {
    if (query[key] && !weeks.isValidDate(query[key]))
      throw new HttpError(400, "Ngày không hợp lệ!");
  }
  if (query.from && query.to && query.from > query.to)
    throw new HttpError(400, "Ngày bắt đầu không được sau ngày kết thúc!");
  if ((query.q || "").length > 100)
    throw new HttpError(400, "Từ khóa không được vượt quá 100 ký tự!");
  if (
    query.programStatus &&
    !["DRAFT", "OPEN", "ONGOING", "CLOSED"].includes(query.programStatus)
  )
    throw new HttpError(400, "Trạng thái chương trình không hợp lệ!");
  const filters = {
    programId: id(query.programId, null),
    programStatus: query.programStatus || null,
    status,
    from: query.from || null,
    to: query.to || null,
    q: query.q?.trim() || null,
  };
  if (detail) {
    if (
      !["program", "mentor"].includes(query.groupBy) ||
      !query.groupKey ||
      query.groupKey.length > 300
    ) {
      throw new HttpError(
        400,
        "Cần chọn nhóm chương trình hoặc mentor hợp lệ!",
      );
    }
    if (query.groupBy === "program" && query.groupKey !== "unassigned")
      id(query.groupKey, null);
    if (
      query.groupBy === "mentor" &&
      query.groupKey !== "unknown" &&
      !/^id:[1-9]\d*$/.test(query.groupKey) &&
      !query.groupKey.startsWith("legacy:")
    ) {
      throw new HttpError(400, "Khóa mentor không hợp lệ!");
    }
    Object.assign(filters, {
      groupBy: query.groupBy,
      groupKey: query.groupKey,
      page: id(query.page, 1),
      pageSize: id(query.pageSize, 20, 100),
    });
    if (!Number.isSafeInteger((filters.page - 1) * filters.pageSize))
      throw new HttpError(400, "Phân trang vượt giới hạn!");
  }
  return filters;
}

function rate(completed, total) {
  return total ? Number(((completed * 100) / total).toFixed(1)) : 0;
}
function uniqueEnrollments(rows) {
  return [...new Map(rows.map((row) => [String(row.id), row])).values()];
}
function summarize(rows) {
  const interns = uniqueEnrollments(rows);
  const completed = interns.filter(
    (r) => String(r.status || "").trim() === "Hoàn thành",
  ).length;
  const active = interns.filter(
    (r) => String(r.status || "").trim() === "Đang thực tập",
  ).length;
  return {
    total: interns.length,
    completed,
    active,
    notCompleted: interns.length - completed - active,
    unknownStatus: interns.filter(
      (r) => !STATUSES.includes(String(r.status || "").trim()),
    ).length,
    uniqueInterns: new Set(interns.map((r) => String(r.internId ?? r.id))).size,
    pendingReview: interns.filter((r) => r.resultUpdatedAt == null).length,
    rate: rate(completed, interns.length),
  };
}
function groupIdentity(row, dimension) {
  if (dimension === "program")
    return {
      key: row.programId == null ? "unassigned" : String(row.programId),
      name: isUnknown(row.programName)
        ? "Chưa cập nhật"
        : cleanText(row.programName),
    };
  const missing = isUnknown(row.mentorName);
  return {
    key:
      row.mentorId != null
        ? `id:${row.mentorId}`
        : missing
          ? "unknown"
          : `legacy:${normalizeKey(row.mentorName)}`,
    name: missing ? "Chưa cập nhật" : cleanText(row.mentorName),
  };
}
function groupRows(rows, dimension) {
  const groups = new Map();
  for (const row of rows) {
    const { key, name } = groupIdentity(row, dimension);
    if (!groups.has(key))
      groups.set(key, { key, names: new Map(), rows: new Map() });
    const group = groups.get(key);
    // Count a membership only once within each group.
    if (!group.rows.has(String(row.id))) {
      group.names.set(name, (group.names.get(name) || 0) + 1);
      group.rows.set(String(row.id), row);
    }
  }
  return [...groups.values()]
    .map((group) => ({
      key: group.key,
      name: [...group.names].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "vi"),
      )[0][0],
      programStatus:
        dimension === "program"
          ? [...group.rows.values()][0].programStatus
          : null,
      ...summarize([...group.rows.values()]),
    }))
    .sort(
      (a, b) =>
        b.rate - a.rate ||
        a.name.localeCompare(b.name, "vi") ||
        a.key.localeCompare(b.key),
    );
}
function eligibleRows(rows) {
  // Completion within a program excludes profiles with no program membership.
  return rows.filter((row) => row.programId != null);
}
function buildReport(rows) {
  const members = eligibleRows(rows);
  return {
    summary: summarize(members),
    byProgram: groupRows(members, "program"),
    byMentor: groupRows(members, "mentor"),
  };
}
async function report(query = {}) {
  const filters = validateQuery(query);
  const [rows, programs] = await Promise.all([
    db.getCompletionRateRows(filters),
    db.getCompletionRatePrograms(),
  ]);
  return { ...buildReport(rows), programs, filters };
}
async function interns(query = {}) {
  const filters = validateQuery(query, true);
  const rows = eligibleRows(await db.getCompletionRateRows(filters));
  const members = uniqueEnrollments(
    rows.filter(
      (row) => groupIdentity(row, filters.groupBy).key === filters.groupKey,
    ),
  );
  members.sort(
    (a, b) =>
      String(a.fullName || "").localeCompare(String(b.fullName || ""), "vi") ||
      Number(a.id) - Number(b.id),
  );
  const total = members.length;
  return {
    summary: summarize(members),
    items: members
      .slice(
        (filters.page - 1) * filters.pageSize,
        filters.page * filters.pageSize,
      )
      .map((row) => ({
        id: row.id,
        internId: row.internId,
        programId: row.programId,
        programName: row.programName,
        programStatus: row.programStatus,
        programStart: row.programStart,
        programEnd: row.programEnd,
        completedAt: row.completedAt,
        completedBy: row.completedBy,
        completionNote: row.completionNote,
        resultUpdatedAt: row.resultUpdatedAt,
        completionStatus: row.completionStatus,
        fullName: row.fullName,
        studentCode: row.studentCode,
        university: row.university,
        mentorName: row.mentorName,
        status: row.status,
      })),
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.ceil(total / filters.pageSize) || 1,
    },
  };
}
async function exportCsv(query = {}) {
  const filters = validateQuery(query);
  const data = buildReport(await db.getCompletionRateRows(filters));
  const lines = [];
  const add = (cells) => lines.push(cells.map(csvCell).join(","));
  add(["BÁO CÁO TỶ LỆ HOÀN THÀNH CHƯƠNG TRÌNH"]);
  add([
    "Tiêu chí",
    "Kết quả theo từng lượt tham gia do HR xác nhận; không dùng trạng thái hồ sơ",
  ]);
  add(["Trạng thái chương trình", filters.programStatus || "Tất cả"]);
  add([
    "Chương trình",
    filters.programId || "Tất cả",
    "Trạng thái",
    filters.status || "Tất cả",
    "Chương trình kết thúc từ",
    filters.from || "",
    "Chương trình bắt đầu đến",
    filters.to || "",
    "Từ khóa",
    filters.q || "",
  ]);
  add([
    "Chiều",
    "Tên",
    "Tổng lượt tham gia",
    "Đã hoàn thành",
    "Đang thực tập",
    "Tạm dừng / không hoàn thành",
    "Trạng thái thiếu / khác",
    "Tỷ lệ (%)",
  ]);
  const record = (dimension, name, stats) =>
    add([
      dimension,
      name,
      stats.total,
      stats.completed,
      stats.active,
      stats.notCompleted,
      stats.unknownStatus,
      stats.rate,
    ]);
  record("Tổng quan", "Tất cả lượt tham gia trong phạm vi", data.summary);
  for (const [dimension, groups] of [
    ["Chương trình", data.byProgram],
    ["Mentor", data.byMentor],
  ]) {
    for (const group of groups) record(dimension, group.name, group);
  }
  return {
    filename: "ty-le-hoan-thanh-chuong-trinh.csv",
    content: `\uFEFF${lines.join("\r\n")}`,
  };
}
module.exports = {
  validateQuery,
  rate,
  summarize,
  groupIdentity,
  groupRows,
  buildReport,
  report,
  interns,
  exportCsv,
};
