// Dịch vụ Thống kê thực tập sinh theo trường / ngành (HR - US5)
const db = require("../db");
const { HttpError } = require("../errors");
const weeks = require("../utils/weeks");
const { getVietnamToday } = require("../utils/date");
const { csvCell } = require("./finalReports.service");

const ALLOWED_QUERY = ["groupBy", "status", "from", "to", "q", "limit"];
const ALLOWED_INTERNS_QUERY = [
  "university",
  "major",
  "status",
  "from",
  "to",
  "q",
  "page",
  "pageSize",
];
const GROUP_BY_OPTIONS = ["university", "major", "both"];
const VALID_STATUSES = ["Đang thực tập", "Hoàn thành", "Tạm dừng"];

function normalizeKey(str) {
  if (!str) return "";
  return String(str)
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
}

function isUnknown(value) {
  if (value == null) return true;
  const trimmed = String(value).trim();
  if (trimmed === "") return true;
  const key = normalizeKey(trimmed);
  return key === "" || key === "chua cap nhat";
}

function cleanText(value) {
  if (value == null) return "";
  return String(value).trim().replace(/\s+/g, " ");
}

function escapeLike(str) {
  return String(str).replace(/([%_\\])/g, "\\$1");
}

function validateReportQuery(query = {}) {
  for (const [key, val] of Object.entries(query)) {
    if (Array.isArray(val)) {
      throw new HttpError(400, "Tham số báo cáo không được lặp lại!");
    }
    if (!ALLOWED_QUERY.includes(key)) {
      throw new HttpError(400, "Tham số báo cáo không hợp lệ!");
    }
  }

  const groupBy = query.groupBy || "both";
  if (!GROUP_BY_OPTIONS.includes(groupBy)) {
    throw new HttpError(400, "Cách gom nhóm không hợp lệ!");
  }

  let status = null;
  if (
    query.status !== undefined &&
    query.status !== null &&
    query.status !== ""
  ) {
    if (typeof query.status !== "string" || query.status.trim().length > 50) {
      throw new HttpError(400, "Trạng thái không hợp lệ!");
    }
    status = query.status.trim();
    if (!VALID_STATUSES.includes(status))
      throw new HttpError(400, "Trạng thái không hợp lệ!");
  }

  let from = null;
  let to = null;
  if (query.from !== undefined && query.from !== null && query.from !== "") {
    if (typeof query.from !== "string" || !weeks.isValidDate(query.from)) {
      throw new HttpError(400, "Ngày bắt đầu không hợp lệ!");
    }
    from = query.from;
  }
  if (query.to !== undefined && query.to !== null && query.to !== "") {
    if (typeof query.to !== "string" || !weeks.isValidDate(query.to)) {
      throw new HttpError(400, "Ngày kết thúc không hợp lệ!");
    }
    to = query.to;
  }
  if (from && to && from > to) {
    throw new HttpError(400, "Ngày bắt đầu không được sau ngày kết thúc!");
  }

  let limit = 20;
  if (query.limit !== undefined && query.limit !== null && query.limit !== "") {
    const rawLimit = String(query.limit).trim();
    if (!/^[1-9]\d*$/.test(rawLimit)) {
      throw new HttpError(400, "Giới hạn số lượng không hợp lệ!");
    }
    const numLimit = Number(rawLimit);
    if (numLimit > 100) {
      throw new HttpError(400, "Giới hạn số lượng không được vượt quá 100!");
    }
    limit = numLimit;
  }

  let q = null;
  if (query.q !== undefined && query.q !== null && query.q !== "") {
    if (typeof query.q !== "string" || query.q.length > 100) {
      throw new HttpError(400, "Từ khóa tìm kiếm không hợp lệ!");
    }
    q = query.q.trim();
  }

  return { groupBy, status, from, to, limit, q };
}

function validateInternsQuery(query = {}) {
  for (const [key, val] of Object.entries(query)) {
    if (Array.isArray(val)) {
      throw new HttpError(400, "Tham số danh sách không được lặp lại!");
    }
    if (!ALLOWED_INTERNS_QUERY.includes(key)) {
      throw new HttpError(400, "Tham số danh sách không hợp lệ!");
    }
  }

  let page = 1;
  if (query.page !== undefined && query.page !== null && query.page !== "") {
    const rawPage = String(query.page).trim();
    if (!/^[1-9]\d*$/.test(rawPage)) {
      throw new HttpError(400, "Phân trang không hợp lệ!");
    }
    page = Number(rawPage);
  }

  let pageSize = 20;
  if (
    query.pageSize !== undefined &&
    query.pageSize !== null &&
    query.pageSize !== ""
  ) {
    const rawPageSize = String(query.pageSize).trim();
    if (!/^[1-9]\d*$/.test(rawPageSize)) {
      throw new HttpError(400, "Phân trang không hợp lệ!");
    }
    const num = Number(rawPageSize);
    if (num > 100) {
      throw new HttpError(400, "Kích thước trang không được vượt quá 100!");
    }
    pageSize = num;
  }

  let status = null;
  if (
    query.status !== undefined &&
    query.status !== null &&
    query.status !== ""
  ) {
    if (typeof query.status !== "string" || query.status.trim().length > 50) {
      throw new HttpError(400, "Trạng thái không hợp lệ!");
    }
    status = query.status.trim();
    if (!VALID_STATUSES.includes(status))
      throw new HttpError(400, "Trạng thái không hợp lệ!");
  }

  let from = null;
  let to = null;
  if (query.from !== undefined && query.from !== null && query.from !== "") {
    if (typeof query.from !== "string" || !weeks.isValidDate(query.from)) {
      throw new HttpError(400, "Ngày bắt đầu không hợp lệ!");
    }
    from = query.from;
  }
  if (query.to !== undefined && query.to !== null && query.to !== "") {
    if (typeof query.to !== "string" || !weeks.isValidDate(query.to)) {
      throw new HttpError(400, "Ngày kết thúc không hợp lệ!");
    }
    to = query.to;
  }
  if (from && to && from > to) {
    throw new HttpError(400, "Ngày bắt đầu không được sau ngày kết thúc!");
  }

  let q = null;
  if (query.q !== undefined && query.q !== null && query.q !== "") {
    if (typeof query.q !== "string" || query.q.length > 100) {
      throw new HttpError(400, "Từ khóa tìm kiếm không hợp lệ!");
    }
    q = query.q.trim();
  }

  const university =
    query.university != null ? String(query.university).trim() : null;
  const major = query.major != null ? String(query.major).trim() : null;

  if (!university && !major) {
    throw new HttpError(400, "Cần chọn trường hoặc ngành để xem danh sách!");
  }

  return { university, major, status, from, to, q, page, pageSize };
}

function groupItems(items, total, limit = 20) {
  const map = new Map();
  for (const item of items) {
    const count = Number(item.count || 0);
    const unk = isUnknown(item.rawName);
    const key = unk ? "__UNKNOWN__" : normalizeKey(item.rawName);
    const display = unk ? "Chưa cập nhật" : cleanText(item.rawName);
    if (!map.has(key)) {
      map.set(key, {
        key,
        count: 0,
        variants: Object.create(null),
        isUnknown: unk,
      });
    }
    const grp = map.get(key);
    grp.count += count;
    grp.variants[display] = (grp.variants[display] || 0) + count;
  }

  const list = [];
  for (const grp of map.values()) {
    let bestName = grp.isUnknown ? "Chưa cập nhật" : "";
    if (!grp.isUnknown) {
      let maxCount = -1;
      for (const [v, c] of Object.entries(grp.variants)) {
        if (
          c > maxCount ||
          (c === maxCount && v.localeCompare(bestName, "vi") < 0)
        ) {
          maxCount = c;
          bestName = v;
        }
      }
    }
    const percent =
      total > 0 ? Number(((grp.count * 100) / total).toFixed(1)) : 0;
    list.push({
      key: grp.key,
      name: bestName,
      count: grp.count,
      percent,
      isUnknown: grp.isUnknown,
    });
  }

  list.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name, "vi");
  });

  if (list.length <= limit) {
    return list.map(({ name, count, percent }) => ({ name, count, percent }));
  }

  let kept = list.slice(0, limit);
  let remainder = list.slice(limit);

  const unknownInRemainder = remainder.find((x) => x.isUnknown);
  if (unknownInRemainder) {
    remainder = remainder.filter((x) => !x.isUnknown);
    let lastNonUnknownIdx = -1;
    for (let i = kept.length - 1; i >= 0; i--) {
      if (!kept[i].isUnknown) {
        lastNonUnknownIdx = i;
        break;
      }
    }
    if (lastNonUnknownIdx !== -1) {
      const kickedOut = kept[lastNonUnknownIdx];
      kept.splice(lastNonUnknownIdx, 1);
      kept.push(unknownInRemainder);
      remainder.push(kickedOut);
    }
  }

  const result = kept.map(({ name, count, percent }) => ({
    name,
    count,
    percent,
  }));
  if (remainder.length > 0) {
    const khacCount = remainder.reduce((s, x) => s + x.count, 0);
    const khacPercent =
      total > 0 ? Number(((khacCount * 100) / total).toFixed(1)) : 0;
    result.push({ name: "Khác", count: khacCount, percent: khacPercent });
  }
  return result;
}

function buildOriginReport(
  internRows = [],
  { groupBy = "both", limit = 20, funnelRows = [] } = {},
) {
  const total = internRows.reduce((sum, r) => sum + Number(r.count || 0), 0);
  const unknown = internRows
    .filter((r) => isUnknown(r.university) || isUnknown(r.major))
    .reduce((sum, r) => sum + Number(r.count || 0), 0);

  const byUniversity = groupItems(
    internRows.map((r) => ({ rawName: r.university, count: r.count })),
    total,
    limit,
  );

  const byMajor = groupItems(
    internRows.map((r) => ({ rawName: r.major, count: r.count })),
    total,
    limit,
  );

  // Ma trận Trường x Ngành
  // Top universities và Top majors (không kể "Khác" ban đầu)
  const uniNames = byUniversity.map((u) => u.name);
  const majorNames = byMajor.map((m) => m.name);

  // Tạo map tra cứu normalizedKey -> canonical name trong danh sách
  const uniKeyMap = new Map();
  for (const name of uniNames) {
    if (name === "Chưa cập nhật") uniKeyMap.set("__UNKNOWN__", name);
    else if (name !== "Khác") uniKeyMap.set(normalizeKey(name), name);
  }
  const majorKeyMap = new Map();
  for (const name of majorNames) {
    if (name === "Chưa cập nhật") majorKeyMap.set("__UNKNOWN__", name);
    else if (name !== "Khác") majorKeyMap.set(normalizeKey(name), name);
  }

  const matrixData = Object.create(null);
  const byUniTotals = Object.create(null);
  const byMajorTotals = Object.create(null);

  for (const u of uniNames) {
    matrixData[u] = Object.create(null);
    byUniTotals[u] = 0;
    for (const m of majorNames) {
      matrixData[u][m] = 0;
    }
  }
  for (const m of majorNames) {
    byMajorTotals[m] = 0;
  }

  for (const row of internRows) {
    const c = Number(row.count || 0);
    const uKey = isUnknown(row.university)
      ? "__UNKNOWN__"
      : normalizeKey(row.university);
    const mKey = isUnknown(row.major) ? "__UNKNOWN__" : normalizeKey(row.major);

    const uTarget =
      uniKeyMap.get(uKey) || (uniNames.includes("Khác") ? "Khác" : null);
    const mTarget =
      majorKeyMap.get(mKey) || (majorNames.includes("Khác") ? "Khác" : null);

    if (uTarget && mTarget) {
      matrixData[uTarget][mTarget] = (matrixData[uTarget][mTarget] || 0) + c;
      byUniTotals[uTarget] = (byUniTotals[uTarget] || 0) + c;
      byMajorTotals[mTarget] = (byMajorTotals[mTarget] || 0) + c;
    }
  }

  const matrix = {
    universities: uniNames,
    majors: majorNames,
    data: matrixData,
    totals: {
      byUniversity: byUniTotals,
      byMajor: byMajorTotals,
      grandTotal: total,
    },
  };

  // Phễu tuyển dụng theo trường (từ candidate_profiles)
  const funnelMap = new Map();
  for (const f of funnelRows) {
    const count = Number(f.count || 0);
    const unk = isUnknown(f.university);
    const key = unk ? "__UNKNOWN__" : normalizeKey(f.university);
    const display = unk ? "Chưa cập nhật" : cleanText(f.university);

    if (!funnelMap.has(key)) {
      funnelMap.set(key, {
        key,
        variants: Object.create(null),
        isUnknown: unk,
        applied: 0,
        approved: 0,
        rejected: 0,
        pending: 0,
      });
    }
    const item = funnelMap.get(key);
    item.variants[display] = (item.variants[display] || 0) + count;
    item.applied += count;
    if (f.status === "Đã duyệt") item.approved += count;
    else if (f.status === "Từ chối") item.rejected += count;
    else if (f.status === "Chờ duyệt") item.pending += count;
  }

  const funnel = [];
  for (const item of funnelMap.values()) {
    let name = item.isUnknown ? "Chưa cập nhật" : "";
    if (!item.isUnknown) {
      let maxCount = -1;
      for (const [v, c] of Object.entries(item.variants)) {
        if (
          c > maxCount ||
          (c === maxCount && v.localeCompare(name, "vi") < 0)
        ) {
          maxCount = c;
          name = v;
        }
      }
    }
    const approvalRate =
      item.applied > 0
        ? Number(((item.approved * 100) / item.applied).toFixed(1))
        : 0;
    funnel.push({
      name,
      applied: item.applied,
      approved: item.approved,
      rejected: item.rejected,
      pending: item.pending,
      approvalRate,
    });
  }

  funnel.sort((a, b) => {
    if (b.applied !== a.applied) return b.applied - a.applied;
    return a.name.localeCompare(b.name, "vi");
  });

  return {
    total,
    unknown,
    byUniversity: groupBy === "major" ? [] : byUniversity,
    byMajor: groupBy === "university" ? [] : byMajor,
    matrix: groupBy === "both" ? matrix : null,
    funnel: groupBy === "major" ? [] : funnel,
  };
}

async function report(query = {}) {
  const filters = validateReportQuery(query);
  const [internRows, funnelRows] = await Promise.all([
    db.getInternOriginCounts(filters),
    db.getCandidateFunnelByUniversity(filters),
  ]);
  return buildOriginReport(internRows, {
    groupBy: filters.groupBy,
    limit: filters.limit,
    funnelRows,
  });
}

async function interns(query = {}) {
  const filters = validateInternsQuery(query);
  return db.listInternsByOrigin({
    ...filters,
    isUnknownUniversity: !!filters.university && isUnknown(filters.university),
    isUnknownMajor: !!filters.major && isUnknown(filters.major),
    normalizeKey,
  });
}

async function exportCsv(query = {}) {
  const filters = validateReportQuery(query);
  const data = await report({ ...query, groupBy: "both" });
  const today = getVietnamToday();
  const filename = `thuc-tap-sinh-theo-truong-nganh_${today}.csv`;

  const lines = [];

  // 1. Tiêu đề và bộ lọc
  lines.push(
    [csvCell("BÁO CÁO THỐNG KÊ THỰC TẬP SINH THEO TRƯỜNG / NGÀNH")].join(","),
  );
  lines.push([csvCell(`Thời điểm xuất: ${today}`)].join(","));
  lines.push(
    [csvCell(`Trạng thái lọc: ${filters.status || "Tất cả"}`)].join(","),
  );
  lines.push(
    [
      csvCell(
        `Khoảng ngày: ${filters.from || "Không giới hạn"} đến ${filters.to || "Không giới hạn"}`,
      ),
    ].join(","),
  );
  lines.push([csvCell(`Từ khóa tìm kiếm: ${filters.q || "Không"}`)].join(","));
  lines.push(
    [
      csvCell(`Tổng số thực tập sinh: ${data.total}`),
      csvCell(`Hồ sơ chưa cập nhật trường/ngành: ${data.unknown}`),
    ].join(","),
  );
  lines.push("");

  // 2. Thống kê theo trường
  lines.push([csvCell("1. THỐNG KÊ THEO TRƯỜNG")].join(","));
  lines.push(
    [
      csvCell("STT"),
      csvCell("Tên trường"),
      csvCell("Số lượng"),
      csvCell("Tỷ lệ (%)"),
    ].join(","),
  );
  if (data.byUniversity.length === 0) {
    lines.push(
      [
        csvCell(""),
        csvCell("Không có dữ liệu"),
        csvCell(0),
        csvCell("0%"),
      ].join(","),
    );
  } else {
    data.byUniversity.forEach((u, i) => {
      lines.push(
        [
          csvCell(i + 1),
          csvCell(u.name),
          csvCell(u.count),
          csvCell(`${u.percent}%`),
        ].join(","),
      );
    });
  }
  lines.push("");

  // 3. Thống kê theo ngành
  lines.push([csvCell("2. THỐNG KÊ THEO NGÀNH")].join(","));
  lines.push(
    [
      csvCell("STT"),
      csvCell("Tên ngành"),
      csvCell("Số lượng"),
      csvCell("Tỷ lệ (%)"),
    ].join(","),
  );
  if (data.byMajor.length === 0) {
    lines.push(
      [
        csvCell(""),
        csvCell("Không có dữ liệu"),
        csvCell(0),
        csvCell("0%"),
      ].join(","),
    );
  } else {
    data.byMajor.forEach((m, i) => {
      lines.push(
        [
          csvCell(i + 1),
          csvCell(m.name),
          csvCell(m.count),
          csvCell(`${m.percent}%`),
        ].join(","),
      );
    });
  }
  lines.push("");

  // 4. Ma trận Trường x Ngành
  lines.push([csvCell("3. MA TRẬN TRƯỜNG × NGÀNH")].join(","));
  const matrixHeaders = [
    csvCell("Trường / Ngành"),
    ...data.matrix.majors.map(csvCell),
    csvCell("Tổng cộng"),
  ];
  lines.push(matrixHeaders.join(","));
  if (data.matrix.universities.length === 0) {
    lines.push([csvCell("Không có dữ liệu")].join(","));
  } else {
    for (const u of data.matrix.universities) {
      const row = [csvCell(u)];
      for (const m of data.matrix.majors) {
        row.push(csvCell(data.matrix.data[u]?.[m] || 0));
      }
      row.push(csvCell(data.matrix.totals.byUniversity[u] || 0));
      lines.push(row.join(","));
    }
    const totalRow = [csvCell("Tổng cộng")];
    for (const m of data.matrix.majors) {
      totalRow.push(csvCell(data.matrix.totals.byMajor[m] || 0));
    }
    totalRow.push(csvCell(data.matrix.totals.grandTotal || 0));
    lines.push(totalRow.join(","));
  }
  lines.push("");

  // 5. Phễu tuyển dụng theo trường
  lines.push([csvCell("4. PHỄU TUYỂN DỤNG THEO TRƯỜNG (ỨNG VIÊN)")].join(","));
  lines.push(
    [
      csvCell("STT"),
      csvCell("Tên trường"),
      csvCell("Số hồ sơ nộp"),
      csvCell("Đã duyệt"),
      csvCell("Từ chối"),
      csvCell("Chờ duyệt"),
      csvCell("Tỷ lệ duyệt (%)"),
    ].join(","),
  );
  if (data.funnel.length === 0) {
    lines.push(
      [
        csvCell(""),
        csvCell("Không có dữ liệu"),
        csvCell(0),
        csvCell(0),
        csvCell(0),
        csvCell(0),
        csvCell("0%"),
      ].join(","),
    );
  } else {
    data.funnel.forEach((f, i) => {
      lines.push(
        [
          csvCell(i + 1),
          csvCell(f.name),
          csvCell(f.applied),
          csvCell(f.approved),
          csvCell(f.rejected),
          csvCell(f.pending),
          csvCell(`${f.approvalRate}%`),
        ].join(","),
      );
    });
  }

  return {
    filename,
    content: lines.join("\r\n"),
  };
}

module.exports = {
  normalizeKey,
  isUnknown,
  cleanText,
  escapeLike,
  validateReportQuery,
  validateInternsQuery,
  groupItems,
  buildOriginReport,
  report,
  interns,
  exportCsv,
};
