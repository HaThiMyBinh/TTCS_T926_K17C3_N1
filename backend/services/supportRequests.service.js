const db = require("../db");
const { HttpError } = require("../errors");
const { assertHasConfirmedContract } = require("./contractGate");
const notifications = require("./notifications.service");
const internNotify = require("./internNotify.service");
const storage = require("./fileStorage");
const { validateAttachment } = require("./attachmentValidator");

const TYPES = [
  "INTERNSHIP_CERTIFICATE",
  "INTRODUCTION_LETTER",
  "INCOME_CONFIRMATION",
  "DOCUMENT_SUPPORT",
  "OTHER",
];
const STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "RESOLVED",
  "REJECTED",
  "CANCELLED",
];
const DECISIONS = ["START", "RESOLVE", "REJECT"];

function parseId(value, message = "ID không hợp lệ!") {
  const text = String(value ?? "");
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text)))
    throw new HttpError(400, message);
  return Number(text);
}
function validateBody(body) {
  const allowed = ["request_type", "title", "description"];
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))
  )
    throw new HttpError(400, "Dữ liệu yêu cầu hỗ trợ không hợp lệ!");
  if (!TYPES.includes(body.request_type))
    throw new HttpError(400, "Loại yêu cầu không hợp lệ!");
  if (
    typeof body.title !== "string" ||
    body.title.trim().length < 3 ||
    body.title.trim().length > 150
  )
    throw new HttpError(400, "Tiêu đề phải từ 3 đến 150 ký tự!");
  const description = body.description === undefined ? "" : body.description;
  if (typeof description !== "string" || description.length > 2000)
    throw new HttpError(400, "Mô tả tối đa 2000 ký tự!");
  if (body.request_type === "OTHER" && !description.trim())
    throw new HttpError(400, "Vui lòng mô tả yêu cầu loại Khác!");
  return {
    requestType: body.request_type,
    title: body.title.trim(),
    description: description.trim(),
  };
}
function parsePage(value, label, fallback, max) {
  if (value === undefined || value === "") return fallback;
  if (!/^[1-9]\d*$/.test(String(value)) || Number(value) > max)
    throw new HttpError(400, `${label} không hợp lệ!`);
  return Number(value);
}
function validateFilters(query = {}, hr = false) {
  const allowed = hr
    ? ["status", "type", "q", "page", "pageSize"]
    : ["status", "type"];
  if (
    !query ||
    typeof query !== "object" ||
    Array.isArray(query) ||
    Object.keys(query).some((key) => !allowed.includes(key)) ||
    Object.values(query).some((value) => Array.isArray(value))
  )
    throw new HttpError(400, "Tham số lọc không hợp lệ!");
  if (query.status && !STATUSES.includes(query.status))
    throw new HttpError(400, "Trạng thái không hợp lệ!");
  if (query.type && !TYPES.includes(query.type))
    throw new HttpError(400, "Loại yêu cầu không hợp lệ!");
  if (
    query.q !== undefined &&
    (typeof query.q !== "string" || query.q.length > 100)
  )
    throw new HttpError(400, "Từ khóa tìm kiếm không hợp lệ!");
  const filters = {
    status: query.status || null,
    type: query.type || null,
    q: query.q?.trim() || null,
  };
  return hr
    ? {
        ...filters,
        page: parsePage(query.page, "Trang", 1, 1000000),
        pageSize: parsePage(query.pageSize, "Kích thước trang", 20, 100),
      }
    : filters;
}
function validateDecision(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !["decision", "note"].includes(key))
  )
    throw new HttpError(400, "Dữ liệu xử lý không hợp lệ!");
  if (!DECISIONS.includes(body.decision))
    throw new HttpError(400, "Quyết định không hợp lệ!");
  if (body.note !== undefined && typeof body.note !== "string")
    throw new HttpError(400, "Ghi chú phải là chuỗi!");
  const note = (body.note || "").trim();
  if (note.length > 1000)
    throw new HttpError(400, "Ghi chú tối đa 1000 ký tự!");
  if (body.decision === "REJECT" && !note)
    throw new HttpError(400, "Vui lòng nhập lý do từ chối!");
  return { decision: body.decision, note };
}
async function currentIntern(user, store = db) {
  const intern = await store.findInternProfileByEmail(user.email);
  if (!intern)
    throw new HttpError(404, "Tài khoản chưa có hồ sơ thực tập sinh!");
  return intern;
}
function publicAttachment(attachment) {
  return {
    id: attachment.id,
    kind: attachment.kind,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: Number(attachment.sizeBytes),
  };
}
function stripInternOnlyFields(row) {
  const { handledBy, handledByName, ...safe } = row;
  return safe;
}

async function mine(user, query) {
  const intern = await currentIntern(user);
  const filters = validateFilters(query);
  const [all, summary] = await Promise.all([
    db.listSupportRequests(intern.id),
    db.supportSummary(intern.id),
  ]);
  const items = all.filter(
    (item) =>
      (!filters.status || item.status === filters.status) &&
      (!filters.type || item.requestType === filters.type),
  );
  const attachments = await db.listSupportAttachmentsByRequestIds(
    items.map((item) => item.id),
  );
  const grouped = new Map();
  for (const attachment of attachments) {
    if (!grouped.has(attachment.requestId))
      grouped.set(attachment.requestId, []);
    grouped.get(attachment.requestId).push(publicAttachment(attachment));
  }
  return {
    items: items.map((item) => ({
      ...stripInternOnlyFields(item),
      attachments: grouped.get(item.id) || [],
    })),
    summary,
  };
}
async function create(user, body) {
  const intern = await currentIntern(user);
  const input = validateBody(body);
  await assertHasConfirmedContract(
    intern.id,
    "Cần có ít nhất một hợp đồng đã xác nhận mới được gửi yêu cầu hỗ trợ!",
  );
  const result = await db.createSupportRequest({
    internId: intern.id,
    ...input,
  });
  if (result.outcome === "LIMIT")
    throw new HttpError(409, "Bạn đã có tối đa 10 yêu cầu đang mở!");
  if (result.outcome === "DUPLICATE")
    throw new HttpError(409, "Bạn đã có yêu cầu đang mở cùng loại!");
  try {
    await notifications.pushSafe(await db.listActiveHrUserIds(), {
      type: "SUPPORT_REQUEST_NEW",
      title: "Yêu cầu hỗ trợ mới",
      message: `${intern.fullName || "Thực tập sinh"}: ${input.title}`.slice(
        0,
        500,
      ),
      targetTab: "tab-support-requests",
      refId: result.id,
    });
  } catch (err) {
    console.error("[SUPPORT] Không tạo được thông báo:", err.message);
  }
  return { id: result.id, status: "PENDING" };
}
async function listHr(query) {
  const filters = validateFilters(query, true);
  const [pageData, summary] = await Promise.all([
    db.listSupportRequests(null, filters, filters),
    db.supportSummary(null),
  ]);
  return {
    ...pageData,
    page: filters.page,
    pageSize: filters.pageSize,
    summary,
  };
}
async function detail(rawId, internId = null, forIntern = false) {
  const id = parseId(rawId);
  const row = await db.findSupportRequest(id, internId);
  if (!row) throw new HttpError(404, "Không tìm thấy yêu cầu hỗ trợ!");
  return {
    ...(forIntern ? stripInternOnlyFields(row) : row),
    attachments: (await db.listSupportAttachments(id)).map(publicAttachment),
  };
}
async function cancel(user, rawId) {
  const intern = await currentIntern(user);
  const id = parseId(rawId);
  if (!(await db.cancelSupportRequest(id, intern.id))) {
    if (!(await db.findSupportRequest(id, intern.id)))
      throw new HttpError(404, "Không tìm thấy yêu cầu hỗ trợ!");
    throw new HttpError(409, "Chỉ hủy được yêu cầu đang chờ tiếp nhận!");
  }
  return null;
}
function transitionFor(decision) {
  return {
    START: { from: ["PENDING"], to: "IN_PROGRESS" },
    RESOLVE: { from: ["IN_PROGRESS"], to: "RESOLVED" },
    REJECT: { from: ["PENDING", "IN_PROGRESS"], to: "REJECTED" },
  }[decision];
}
async function notifyProcessUpdate(
  request,
  input,
  hasResultFile,
  notifier = internNotify,
) {
  const outcome =
    input.decision === "START"
      ? "đang được xử lý"
      : input.decision === "RESOLVE"
        ? "đã giải quyết"
        : "bị từ chối";
  const fileText =
    input.decision === "RESOLVE" && hasResultFile
      ? " Có file kết quả đính kèm."
      : "";
  try {
    await notifier.toInterns([request.internId], {
      type: "SUPPORT_REQUEST_UPDATED",
      title: "Yêu cầu hỗ trợ được cập nhật",
      message:
        `${request.title}: ${outcome}${input.note ? `: ${input.note}` : "."}${fileText}`.slice(
          0,
          500,
        ),
      targetTab: "tab-my-support",
      refId: request.id,
    });
  } catch (err) {
    console.error("[SUPPORT] Không tạo được thông báo:", err.message);
  }
}
async function processWithDeps(user, rawId, body, deps = {}) {
  const store = deps.db || db;
  const id = parseId(rawId);
  const input = validateDecision(body);
  const request = await store.findSupportRequest(id);
  if (!request) throw new HttpError(404, "Không tìm thấy yêu cầu hỗ trợ!");
  const transition = transitionFor(input.decision);
  if (!transition.from.includes(request.status))
    throw new HttpError(
      409,
      "Yêu cầu đã được xử lý hoặc không ở trạng thái phù hợp!",
    );
  const resultCount =
    input.decision === "RESOLVE"
      ? await store.countSupportAttachments(id, "RESULT")
      : 0;
  if (input.decision === "RESOLVE" && !input.note && !resultCount)
    throw new HttpError(
      400,
      "Giải quyết yêu cầu cần ghi chú hoặc file kết quả!",
    );
  if (
    !(await store.processSupportRequest(
      id,
      transition.from,
      transition.to,
      user.id,
      input.note,
    ))
  )
    throw new HttpError(409, "Yêu cầu đã được xử lý ở nơi khác!");
  await notifyProcessUpdate(
    request,
    input,
    resultCount > 0,
    deps.internNotify || internNotify,
  );
  return null;
}
async function process(user, rawId, body) {
  return processWithDeps(user, rawId, body);
}
async function upload(user, rawId, file, kind, internId = null) {
  if (kind === "REQUEST") internId = (await currentIntern(user)).id;
  const id = parseId(rawId);
  const request = await db.findSupportRequest(id, internId);
  if (!request) throw new HttpError(404, "Không tìm thấy yêu cầu hỗ trợ!");
  const requiredStatus = kind === "REQUEST" ? "PENDING" : "IN_PROGRESS";
  if (request.status !== requiredStatus)
    throw new HttpError(
      409,
      "Không thể tải file khi yêu cầu không còn ở trạng thái phù hợp!",
    );
  const limit = kind === "REQUEST" ? 5 : 3;
  if ((await db.countSupportAttachments(id, kind)) >= limit)
    throw new HttpError(409, `Tối đa ${limit} file cho loại đính kèm này!`);
  if (!file) throw new HttpError(400, "Vui lòng chọn file!");
  const meta = validateAttachment({
    buffer: file.buffer,
    originalname: file.originalname,
  });
  const storedName = storage.saveBuffer(file.buffer);
  try {
    const attachmentId = await db.insertSupportAttachment({
      requestId: id,
      kind,
      requiredStatus,
      originalName: meta.cleanName,
      storedName,
      mimeType: meta.mimeType,
      sizeBytes: file.buffer.length,
      uploadedBy: user.id,
    });
    if (!attachmentId)
      throw new HttpError(
        409,
        "Không thể tải file khi yêu cầu không còn ở trạng thái phù hợp!",
      );
    return { id: attachmentId, originalName: meta.cleanName, kind };
  } catch (err) {
    storage.removeFile(storedName);
    if (!(err instanceof HttpError))
      console.error("[SUPPORT] Lưu metadata file thất bại:", err.message);
    throw err;
  }
}
async function removeAttachment(user, rawId, rawAttachmentId) {
  const intern = await currentIntern(user);
  const id = parseId(rawId);
  const attachmentId = parseId(rawAttachmentId);
  const request = await db.findSupportRequest(id, intern.id);
  if (!request) throw new HttpError(404, "Không tìm thấy yêu cầu hỗ trợ!");
  if (request.status !== "PENDING")
    throw new HttpError(409, "Chỉ xóa file khi yêu cầu còn chờ tiếp nhận!");
  const attachment = await db.findSupportAttachment(attachmentId, id);
  if (!attachment || attachment.kind !== "REQUEST")
    throw new HttpError(404, "Không tìm thấy file đính kèm!");
  if (await db.deleteSupportAttachment(attachmentId, id, "REQUEST"))
    storage.removeFile(attachment.storedName);
  return null;
}
async function removeResultAttachment(rawId, rawAttachmentId) {
  const id = parseId(rawId);
  const attachmentId = parseId(rawAttachmentId);
  const request = await db.findSupportRequest(id);
  if (!request) throw new HttpError(404, "Không tìm thấy yêu cầu hỗ trợ!");
  if (request.status !== "IN_PROGRESS")
    throw new HttpError(
      409,
      "Chỉ xóa file kết quả khi yêu cầu đang được xử lý!",
    );
  const attachment = await db.findSupportAttachment(attachmentId, id);
  if (!attachment || attachment.kind !== "RESULT")
    throw new HttpError(404, "Không tìm thấy file kết quả!");
  if (await db.deleteSupportAttachment(attachmentId, id, "RESULT"))
    storage.removeFile(attachment.storedName);
  return null;
}
async function download(user, rawId, rawAttachmentId) {
  const id = parseId(rawId);
  const attachmentId = parseId(rawAttachmentId);
  const internId =
    user.role === "Intern" ? (await currentIntern(user)).id : null;
  const request = await db.findSupportRequest(id, internId);
  if (!request) throw new HttpError(404, "Không tìm thấy yêu cầu hỗ trợ!");
  const attachment = await db.findSupportAttachment(attachmentId, id);
  if (!attachment) throw new HttpError(404, "Không tìm thấy file đính kèm!");
  const filePath = storage.resolveExistingPath(attachment.storedName);
  if (!filePath) throw new HttpError(404, "File không còn tồn tại!");
  return {
    filePath,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
  };
}
module.exports = {
  TYPES,
  STATUSES,
  DECISIONS,
  parseId,
  validateBody,
  validateFilters,
  validateDecision,
  transitionFor,
  mine,
  create,
  listHr,
  detail,
  cancel,
  process,
  processWithDeps,
  upload,
  removeAttachment,
  removeResultAttachment,
  download,
};
