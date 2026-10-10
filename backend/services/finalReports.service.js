const db = require("../db");
const { HttpError } = require("../errors");
const weeks = require("../utils/weeks");
const { getVietnamToday } = require("../utils/date");
const FIELDS = [
  "title",
  "scope_type",
  "scope_value",
  "period_from",
  "period_to",
  "hr_note",
];
const SCOPE_TYPES = ["ALL", "UNIVERSITY", "PROGRAM"];
function parseId(raw) {
  const s = String(raw ?? "");
  if (!/^[1-9]\d*$/.test(s) || !Number.isSafeInteger(Number(s)))
    throw new HttpError(400, "Mã báo cáo không hợp lệ!");
  return Number(s);
}
// Nhãn phạm vi dễ đọc: "Toàn bộ thực tập sinh", "Trường: ...", "Chương trình: <tên>".
function describeScope(type, value, programs = []) {
  if (type === "UNIVERSITY") return `Trường: ${value || ""}`.trim();
  if (type === "PROGRAM") {
    const program = (programs || []).find((p) => String(p.id) === String(value));
    return `Chương trình: ${program ? program.name : `#${value}`}`;
  }
  return "Toàn bộ thực tập sinh";
}
function parseRecipients(raw) {
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function validateReportInput(input, { partial = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new HttpError(400, "Dữ liệu báo cáo không hợp lệ!");
  const extras = Object.keys(input).filter((key) => !FIELDS.includes(key));
  if (extras.length)
    throw new HttpError(400, "Báo cáo có trường dữ liệu không hợp lệ!");
  const titleRaw = input.title;
  if (
    (!partial || Object.hasOwn(input, "title")) &&
    (typeof titleRaw !== "string" ||
      !titleRaw.trim() ||
      titleRaw.trim().length > 255)
  )
    throw new HttpError(400, "Tiêu đề bắt buộc và không được quá 255 ký tự!");
  const scopeType = input.scope_type;
  if (
    (!partial || Object.hasOwn(input, "scope_type")) &&
    !SCOPE_TYPES.includes(scopeType)
  )
    throw new HttpError(400, "Phạm vi báo cáo không hợp lệ!");
  const scopeValue = input.scope_value ?? null;
  if (
    (!partial ||
      Object.hasOwn(input, "scope_type") ||
      Object.hasOwn(input, "scope_value")) &&
    scopeType !== "ALL" &&
    !(typeof scopeValue === "string" && scopeValue.trim())
  )
    throw new HttpError(400, "Vui lòng chọn giá trị phạm vi báo cáo!");
  if (
    scopeValue != null &&
    (typeof scopeValue !== "string" || scopeValue.trim().length > 255)
  )
    throw new HttpError(400, "Giá trị phạm vi không hợp lệ!");
  if (
    scopeType === "PROGRAM" &&
    scopeValue != null &&
    (!/^[1-9]\d*$/.test(scopeValue.trim()) ||
      !Number.isSafeInteger(Number(scopeValue.trim())))
  )
    throw new HttpError(400, "Mã chương trình không hợp lệ!");
  const periodFrom = input.period_from ?? null;
  const periodTo = input.period_to ?? null;
  for (const date of [periodFrom, periodTo])
    if (date != null && !weeks.isValidDate(date))
      throw new HttpError(400, "Ngày lọc phải có định dạng YYYY-MM-DD hợp lệ!");
  if (periodFrom && periodTo && periodFrom > periodTo)
    throw new HttpError(400, "Ngày bắt đầu không được sau ngày kết thúc!");
  const note = input.hr_note ?? null;
  if (note != null && (typeof note !== "string" || note.trim().length > 2000))
    throw new HttpError(400, "Nhận xét HR không được quá 2000 ký tự!");
  return {
    title: titleRaw?.trim(),
    scopeType,
    scopeValue: scopeType === "ALL" ? null : scopeValue?.trim(),
    periodFrom,
    periodTo,
    hrNote: note?.trim() || null,
  };
}
function validatePreviewQuery(query) {
  const allowed = ["scope_type", "scope_value", "from", "to"];
  if (Object.keys(query || {}).some((k) => !allowed.includes(k)))
    throw new HttpError(400, "Tham số xem trước không hợp lệ!");
  const data = validateReportInput({
    title: "preview",
    scope_type: query.scope_type,
    scope_value: query.scope_value,
    period_from: query.from,
    period_to: query.to,
  });
  return data;
}
function summarizeRows(
  rows,
  {
    today = getVietnamToday(),
    generatedAt = new Date().toISOString(),
    scope = null,
    hrNote = null,
  } = {},
) {
  const evaluated = rows.filter(
    (r) => r.skillScore != null && r.attitudeScore != null,
  );
  const avg = (field) =>
    evaluated.length
      ? Math.round(
          (evaluated.reduce((s, r) => s + Number(r[field]), 0) /
            evaluated.length) *
            10,
        ) / 10
      : null;
  const distribution = {
    "1.0-1.9": 0,
    "2.0-2.9": 0,
    "3.0-3.9": 0,
    "4.0-5.0": 0,
  };
  const interns = rows.map((r) => {
    const scored = r.skillScore != null && r.attitudeScore != null;
    const overall = scored
      ? Math.round(
          ((Number(r.skillScore) + Number(r.attitudeScore)) / 2) * 10,
        ) / 10
      : null;
    if (overall != null)
      distribution[
        overall < 2
          ? "1.0-1.9"
          : overall < 3
            ? "2.0-2.9"
            : overall < 4
              ? "3.0-3.9"
              : "4.0-5.0"
      ]++;
    const reportMap = new Map(
      (r.weeklyReports || []).map((x) => [String(x.weekStart).slice(0, 10), x]),
    );
    const periodStart =
      scope?.from &&
      (!r.startDate || scope.from > String(r.startDate).slice(0, 10))
        ? scope.from
        : r.startDate
          ? String(r.startDate).slice(0, 10)
          : null;
    const periodEndCandidates = [
      r.endDate ? String(r.endDate).slice(0, 10) : null,
      scope?.to || null,
    ].filter(Boolean);
    const periodEnd = periodEndCandidates.length
      ? periodEndCandidates.sort()[0]
      : null;
    const required = periodStart
      ? weeks.listRequiredWeeks({
          startDate: periodStart,
          endDate: periodEnd,
          today,
        })
      : [];
    const weekStats = {
      required: required.length,
      onTime: 0,
      late: 0,
      missing: 0,
      upcoming: 0,
    };
    for (const weekStart of required) {
      const state = weeks.weekStatus({
        weekStart,
        report: reportMap.get(weekStart),
        today,
      });
      if (state === "SUBMITTED") weekStats.onTime++;
      else if (state === "LATE_SUBMITTED") weekStats.late++;
      else if (state === "MISSING") weekStats.missing++;
      else weekStats.upcoming++;
    }
    return {
      internId: r.internId,
      fullName: r.fullName,
      studentCode: r.studentCode,
      university: r.university,
      major: r.major,
      programName: r.programName,
      departmentName: r.departmentName,
      mentorName: r.mentorName,
      startDate: r.startDate,
      endDate: r.endDate,
      evaluated: scored,
      skillScore: scored ? Number(r.skillScore) : null,
      skillComment: r.skillComment,
      attitudeScore: scored ? Number(r.attitudeScore) : null,
      attitudeComment: r.attitudeComment,
      overallScore: overall,
      overallComment: r.overallComment,
      weeklyReportStats: weekStats,
      taskStats: {
        total: Number(r.taskCount || 0),
        done: Number(r.completedTaskCount || 0),
      },
      totalWorkMinutes: Number(r.totalWorkMinutes || 0),
    };
  });
  const weekly = interns.reduce(
    (a, i) => {
      for (const k of Object.keys(a)) a[k] += i.weeklyReportStats[k];
      return a;
    },
    {
      required: 0,
      onTime: 0,
      late: 0,
      missing: 0,
      upcoming: 0,
    },
  );
  const avgSkill = avg("skillScore");
  const avgAttitude = avg("attitudeScore");
  const avgOverall = evaluated.length
    ? Math.round(
        (evaluated.reduce(
          (s, r) => s + (Number(r.skillScore) + Number(r.attitudeScore)) / 2,
          0,
        ) /
          evaluated.length) *
          10,
      ) / 10
    : null;
  return {
    generatedAt,
    scope,
    hrNote,
    summary: {
      totalWorkMinutes: interns.reduce((sum, i) => sum + i.totalWorkMinutes, 0),
      totalInterns: rows.length,
      total_interns: rows.length,
      evaluated: evaluated.length,
      notEvaluated: rows.length - evaluated.length,
      not_evaluated: rows.length - evaluated.length,
      avgSkill,
      avg_skill: avgSkill,
      avgAttitude,
      avg_attitude: avgAttitude,
      avgOverall,
      avg_overall: avgOverall,
      distribution,
    },
    weeklyReportStats: weekly,
    weekly_report_stats: weekly,
    interns,
  };
}
function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}
function toCsv(snapshot) {
  const header = [
    "H\u1ECD t\u00EAn",
    "M\u00E3 sinh vi\u00EAn",
    "Tr\u01B0\u1EDDng",
    "Ng\u00E0nh",
    "Ch\u01B0\u01A1ng tr\u00ECnh",
    "Ph\u00F2ng ban",
    "Mentor",
    "B\u1EAFt \u0111\u1EA7u",
    "K\u1EBFt th\u00FAc",
    "Tr\u1EA1ng th\u00E1i \u0111\u00E1nh gi\u00E1",
    "\u0110i\u1EC3m k\u1EF9 n\u0103ng",
    "Nh\u1EADn x\u00E9t k\u1EF9 n\u0103ng",
    "\u0110i\u1EC3m th\u00E1i \u0111\u1ED9",
    "Nh\u1EADn x\u00E9t th\u00E1i \u0111\u1ED9",
    "\u0110i\u1EC3m t\u1ED5ng",
    "Nh\u1EADn x\u00E9t chung",
    "Tu\u1EA7n ph\u1EA3i n\u1ED9p",
    "\u0110\u00FAng h\u1EA1n",
    "Tr\u1EC5",
    "Thi\u1EBFu",
    "Nhi\u1EC7m v\u1EE5",
    "\u0110\u00E3 ho\u00E0n th\u00E0nh",
    "T\u1ED5ng ph\u00FAt l\u00E0m vi\u1EC7c",
  ];
  const rows = snapshot.interns.map((i) => [
    i.fullName,
    i.studentCode,
    i.university,
    i.major,
    i.programName,
    i.departmentName,
    i.mentorName,
    i.startDate,
    i.endDate,
    i.evaluated ? "Đã đánh giá" : "Chưa đánh giá",
    i.skillScore,
    i.skillComment,
    i.attitudeScore,
    i.attitudeComment,
    i.overallScore,
    i.overallComment,
    i.weeklyReportStats.required,
    i.weeklyReportStats.onTime,
    i.weeklyReportStats.late,
    i.weeklyReportStats.missing,
    i.taskStats.total,
    i.taskStats.done,
    i.totalWorkMinutes,
  ]);
  return (
    "\uFEFF" +
    [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")
  );
}
function toDbFields(v) {
  return {
    title: v.title,
    scopeType: v.scopeType,
    scopeValue: v.scopeValue,
    periodFrom: v.periodFrom,
    periodTo: v.periodTo,
    hrNote: v.hrNote,
  };
}
async function buildSnapshot(fields) {
  const rows = await db.listFinalReportInterns({
    scopeType: fields.scopeType,
    scopeValue: fields.scopeValue,
    from: fields.periodFrom ?? fields.from ?? null,
    to: fields.periodTo ?? fields.to ?? null,
  });
  return summarizeRows(rows, {
    scope: {
      type: fields.scopeType,
      value: fields.scopeValue,
      from: fields.periodFrom ?? fields.from ?? null,
      to: fields.periodTo ?? fields.to ?? null,
    },
    hrNote: fields.hrNote,
  });
}
async function assertScopeExists(fields) {
  if (fields.scopeType === "ALL") return;
  const options = await db.getFinalReportFilterOptions();
  const valid =
    fields.scopeType === "UNIVERSITY"
      ? options.universities.some(
          (value) => String(value).trim() === fields.scopeValue,
        )
      : options.programs.some(
          (program) => String(program.id) === fields.scopeValue,
        );
  if (!valid)
    throw new HttpError(
      400,
      fields.scopeType === "UNIVERSITY"
        ? "Trường được chọn không tồn tại!"
        : "Chương trình được chọn không tồn tại!",
    );
}
async function preview(query) {
  const fields = validatePreviewQuery(query);
  await assertScopeExists(fields);
  return buildSnapshot(fields);
}
async function list(query) {
  if (
    Object.keys(query || {}).some(
      (k) => !["status", "page", "limit"].includes(k),
    )
  )
    throw new HttpError(400, "Tham số danh sách không hợp lệ!");
  const status = query.status || null;
  if (status && !["DRAFT", "FINALIZED"].includes(status))
    throw new HttpError(400, "Trạng thái báo cáo không hợp lệ!");
  const parsePage = (raw, fallback, max, label) => {
    if (raw == null) return fallback;
    if (
      typeof raw !== "string" ||
      !/^[1-9]\d*$/.test(raw) ||
      !Number.isSafeInteger(Number(raw)) ||
      Number(raw) > max
    )
      throw new HttpError(400, `${label} không hợp lệ!`);
    return Number(raw);
  };
  const page = parsePage(query.page, 1, 1000000, "Trang");
  const limit = parsePage(query.limit, 20, 100, "Số dòng");
  const options = await db.getFinalReportFilterOptions();
  const reports = await db.listFinalReports({
    status,
    limit,
    offset: (page - 1) * limit,
  });
  return {
    reports: reports.map((r) => {
      const { lastRecipients, ...rest } = r;
      const sendCount = Number(r.sendCount || 0);
      return {
        ...rest,
        sendCount,
        isSent: sendCount > 0,
        lastRecipients: parseRecipients(lastRecipients),
        scopeLabel: describeScope(r.scopeType, r.scopeValue, options.programs),
      };
    }),
    pagination: { page, limit },
    options,
  };
}
async function create(user, input) {
  const fields = validateReportInput(input);
  await assertScopeExists(fields);
  return db.createFinalReport(toDbFields(fields), user.id);
}
async function detail(rawId) {
  const report = await db.findFinalReportById(parseId(rawId));
  if (!report) throw new HttpError(404, "Không tìm thấy báo cáo!");
  if (report.status === "FINALIZED") {
    try {
      report.data = JSON.parse(report.snapshotJson);
    } catch {
      throw new Error("Snapshot báo cáo không hợp lệ");
    }
  } else
    report.data = await buildSnapshot({
      scopeType: report.scopeType,
      scopeValue: report.scopeValue,
      periodFrom: report.periodFrom,
      periodTo: report.periodTo,
      hrNote: report.hrNote,
    });
  delete report.snapshotJson;
  report.scopeLabel = describeScope(
    report.scopeType,
    report.scopeValue,
    report.scopeType === "PROGRAM"
      ? (await db.getFinalReportFilterOptions()).programs
      : [],
  );
  const sends =
    report.status === "FINALIZED"
      ? (await db.listFinalReportSends(report.id)).map((s) => ({
          ...s,
          recipients: parseRecipients(s.recipients),
        }))
      : [];
  report.sends = sends;
  report.sendCount = sends.length;
  report.isSent = sends.length > 0;
  return report;
}
async function update(rawId, input) {
  const id = parseId(rawId);
  const current = await db.findFinalReportById(id);
  if (!current) throw new HttpError(404, "Không tìm thấy báo cáo!");
  if (current.status !== "DRAFT")
    throw new HttpError(409, "Báo cáo đã chốt nên không thể sửa!");
  const fields = validateReportInput(input);
  await assertScopeExists(fields);
  const changed = await db.updateFinalReport(id, toDbFields(fields));
  if (!changed) {
    const latest = await db.findFinalReportById(id);
    if (!latest) throw new HttpError(404, "Không tìm thấy báo cáo!");
    if (latest.status !== "DRAFT")
      throw new HttpError(409, "Báo cáo đã chốt nên không thể sửa!");
  }
  return detail(id);
}
function validateFinalizeBody(body) {
  if (body == null) return { confirmIncomplete: false };
  if (typeof body !== "object" || Array.isArray(body))
    throw new HttpError(400, "Dữ liệu chốt báo cáo không hợp lệ!");
  if (Object.keys(body).some((key) => key !== "confirm_incomplete"))
    throw new HttpError(400, "Dữ liệu chốt báo cáo có trường không hợp lệ!");
  if (
    body.confirm_incomplete != null &&
    typeof body.confirm_incomplete !== "boolean"
  )
    throw new HttpError(400, "confirm_incomplete phải là true hoặc false!");
  return { confirmIncomplete: body.confirm_incomplete === true };
}
async function finalize(rawId, user, body) {
  const id = parseId(rawId);
  const { confirmIncomplete } = validateFinalizeBody(body);
  const current = await db.findFinalReportById(id);
  if (!current) throw new HttpError(404, "Không tìm thấy báo cáo!");
  if (current.status !== "DRAFT")
    throw new HttpError(409, "Báo cáo đã được chốt!");
  const snapshot = await buildSnapshot({
    scopeType: current.scopeType,
    scopeValue: current.scopeValue,
    periodFrom: current.periodFrom,
    periodTo: current.periodTo,
    hrNote: current.hrNote,
  });
  if (!snapshot.summary.evaluated)
    throw new HttpError(
      409,
      "Chưa có thực tập sinh nào được đánh giá trong phạm vi này!",
    );
  // Báo cáo gửi trường/lãnh đạo mà còn người chưa được đánh giá thì phải được HR xác nhận rõ ràng.
  if (snapshot.summary.notEvaluated > 0 && !confirmIncomplete) {
    const err = new HttpError(
      409,
      `Còn ${snapshot.summary.notEvaluated}/${snapshot.summary.totalInterns} thực tập sinh chưa được đánh giá trong phạm vi này. Hãy xác nhận nếu vẫn muốn chốt báo cáo!`,
    );
    err.code = "INCOMPLETE_EVALUATION";
    err.details = {
      notEvaluated: snapshot.summary.notEvaluated,
      totalInterns: snapshot.summary.totalInterns,
    };
    throw err;
  }
  if (!(await db.finalizeFinalReport(id, user.id, snapshot)))
    throw new HttpError(409, "Báo cáo đã được chốt ở nơi khác!");
  return detail(id);
}
async function remove(rawId) {
  const id = parseId(rawId);
  const current = await db.findFinalReportById(id);
  if (!current) throw new HttpError(404, "Không tìm thấy báo cáo!");
  if (current.status !== "DRAFT")
    throw new HttpError(409, "Báo cáo đã chốt nên không thể xóa!");
  const removed = await db.deleteFinalReport(id);
  if (!removed) {
    const latest = await db.findFinalReportById(id);
    if (latest?.status === "FINALIZED")
      throw new HttpError(409, "Báo cáo đã chốt nên không thể xóa!");
    if (!latest) throw new HttpError(404, "Không tìm thấy báo cáo!");
  }
  return { id };
}
async function exportCsv(rawId) {
  const report = await detail(rawId);
  return {
    filename: `bao-cao-cuoi-ky-${report.id}.csv`,
    content: toCsv(report.data),
  };
}
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 10;
function validateSendBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new HttpError(400, "Dữ liệu gửi báo cáo không hợp lệ!");
  if (Object.keys(body).some((key) => !["recipients", "message"].includes(key)))
    throw new HttpError(400, "Dữ liệu gửi báo cáo có trường không hợp lệ!");
  if (!Array.isArray(body.recipients) || !body.recipients.length)
    throw new HttpError(400, "Vui lòng nhập ít nhất một email người nhận!");
  const recipients = [
    ...new Set(
      body.recipients.map((item) =>
        typeof item === "string" ? item.trim().toLowerCase() : "",
      ),
    ),
  ];
  if (recipients.length > MAX_RECIPIENTS)
    throw new HttpError(
      400,
      `Chỉ gửi tối đa ${MAX_RECIPIENTS} người nhận mỗi lần!`,
    );
  if (
    recipients.some(
      (email) => !email || email.length > 254 || !EMAIL_REGEX.test(email),
    )
  )
    throw new HttpError(400, "Có địa chỉ email người nhận không hợp lệ!");
  if (
    body.message != null &&
    (typeof body.message !== "string" || body.message.trim().length > 1000)
  )
    throw new HttpError(400, "Lời nhắn không được vượt quá 1000 ký tự!");
  return { recipients, message: body.message?.trim() || "" };
}
// Gửi báo cáo ĐÃ CHỐT (kèm file CSV) tới trường/ban lãnh đạo. Bản nháp chưa được gửi vì số liệu còn thay đổi.
async function sendByEmail(rawId, body, user = null) {
  const input = validateSendBody(body);
  const report = await detail(rawId);
  if (report.status !== "FINALIZED")
    throw new HttpError(409, "Chỉ gửi được báo cáo đã chốt!");
  const emailQueue = require("./email/emailQueue");
  const emailSender = require("./email/emailSender");
  try {
    await emailQueue.sendFinalReportEmail({
      to: input.recipients,
      report,
      message: input.message,
      csv: toCsv(report.data),
      filename: `bao-cao-cuoi-ky-${report.id}.csv`,
    });
  } catch (err) {
    if (err.classification === "PERMANENT" && !err.code)
      throw new HttpError(409, err.message);
    throw new HttpError(
      502,
      `Gửi email thất bại: ${emailSender.getSafeErrorMessage(err)}`,
    );
  }
  const sentAt = new Date().toISOString();
  // Email đã gửi đi thành công: lỗi khi ghi lịch sử không được làm phản hồi thất bại.
  try {
    await db.recordFinalReportSend({
      reportId: report.id,
      userId: user?.id,
      recipients: input.recipients,
      message: input.message,
    });
    await db.upsertFinalReportRecipients({
      emails: input.recipients,
      scopeType: report.scopeType,
      scopeValue: report.scopeValue,
      userId: user?.id,
    });
  } catch (err) {
    console.error("[FINAL REPORTS] Không ghi được lịch sử gửi:", err);
  }
  return { id: report.id, recipients: input.recipients, sentAt };
}
// Gợi ý người nhận theo phạm vi báo cáo (cùng phạm vi trước, rồi tới nhóm dùng chung cho "Toàn bộ").
async function listRecipients(query) {
  const allowed = ["scope_type", "scope_value"];
  if (Object.keys(query || {}).some((k) => !allowed.includes(k)))
    throw new HttpError(400, "Tham số người nhận không hợp lệ!");
  const scopeType = query.scope_type ?? "ALL";
  if (!SCOPE_TYPES.includes(scopeType))
    throw new HttpError(400, "Phạm vi báo cáo không hợp lệ!");
  const scopeValue = query.scope_value ?? "";
  if (typeof scopeValue !== "string" || scopeValue.length > 255)
    throw new HttpError(400, "Giá trị phạm vi không hợp lệ!");
  const rows = await db.listFinalReportRecipients({ scopeType, scopeValue });
  const seen = new Set();
  return {
    recipients: rows.filter((r) => {
      if (seen.has(r.email)) return false;
      seen.add(r.email);
      return true;
    }),
  };
}
async function removeRecipient(rawId) {
  const id = parseId(rawId);
  if (!(await db.deleteFinalReportRecipient(id)))
    throw new HttpError(404, "Không tìm thấy người nhận!");
  return { id };
}
module.exports = {
  validateFinalizeBody,
  validateSendBody,
  sendByEmail,
  listRecipients,
  removeRecipient,
  describeScope,
  parseRecipients,
  validateReportInput,
  validatePreviewQuery,
  parseId,
  summarizeRows,
  csvCell,
  toCsv,
  preview,
  list,
  create,
  detail,
  update,
  finalize,
  remove,
  exportCsv,
};
