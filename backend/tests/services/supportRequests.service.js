// Yêu cầu hỗ trợ của thực tập sinh: xin chứng nhận / giấy tờ / hỗ trợ khác.
const db = require("../db");
const { HttpError } = require("../errors");

const REQUEST_TYPES = ["CERTIFICATE", "DOCUMENT", "OTHER"]; // chứng nhận | giấy tờ | khác
const REQUEST_TYPE_LABELS = {
  CERTIFICATE: "Chứng nhận",
  DOCUMENT: "Giấy tờ",
  OTHER: "Khác",
};
const STATUS_PENDING = "Chờ xử lý"; // trạng thái mặc định khi mới gửi
const TITLE_MAX_LENGTH = 200;
const CONTENT_MAX_LENGTH = 2000;
const ALLOWED_FIELDS = ["request_type", "title", "content"];

function validateCreateBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Dữ liệu yêu cầu hỗ trợ không hợp lệ!");
  }
  // Chặn các trường như status / intern_id / handled_by: do server quyết định.
  if (Object.keys(body).some((key) => !ALLOWED_FIELDS.includes(key))) {
    throw new HttpError(400, "Dữ liệu yêu cầu hỗ trợ có trường không được phép!");
  }

  if (!REQUEST_TYPES.includes(body.request_type)) {
    throw new HttpError(
      400,
      "Loại yêu cầu không hợp lệ (CERTIFICATE, DOCUMENT hoặc OTHER)!",
    );
  }

  if (typeof body.title !== "string" || !body.title.trim()) {
    throw new HttpError(400, "Vui lòng nhập tiêu đề yêu cầu!");
  }
  const title = body.title.trim().replace(/\s+/g, " ");
  if (title.length > TITLE_MAX_LENGTH) {
    throw new HttpError(400, `Tiêu đề tối đa ${TITLE_MAX_LENGTH} ký tự!`);
  }

  if (typeof body.content !== "string" || !body.content.trim()) {
    throw new HttpError(400, "Nội dung yêu cầu không được để trống!");
  }
  const content = body.content.trim();
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new HttpError(400, `Nội dung tối đa ${CONTENT_MAX_LENGTH} ký tự!`);
  }

  return { requestType: body.request_type, title, content };
}

function toSupportRequestDto(row) {
  const iso = (value) =>
    value instanceof Date ? value.toISOString() : (value ?? null);
  return {
    id: Number(row.id),
    intern_id: Number(row.internId),
    request_type: row.requestType,
    request_type_label: REQUEST_TYPE_LABELS[row.requestType] || row.requestType,
    title: row.title,
    content: row.content,
    status: row.status,
    response: row.response ?? null,
    handled_by: row.handledBy == null ? null : Number(row.handledBy),
    handled_at: iso(row.handledAt),
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
  };
}

// Intern gửi yêu cầu hỗ trợ cho chính mình (hồ sơ lấy từ token, không nhận từ body).
async function createSupportRequest(user, body) {
  if (!user || user.role !== "Intern") {
    throw new HttpError(403, "Chỉ thực tập sinh mới được gửi yêu cầu hỗ trợ!");
  }
  if (typeof user.email !== "string" || !user.email.trim()) {
    throw new HttpError(401, "Không xác định được tài khoản đăng nhập!");
  }

  const input = validateCreateBody(body);

  const intern = await db.findInternProfileByEmail(user.email.trim());
  if (!intern) {
    throw new HttpError(
      404,
      "Không tìm thấy hồ sơ thực tập sinh tương ứng với tài khoản!",
    );
  }

  const row = await db.insertSupportRequest({
    internId: intern.id,
    ...input,
  });
  return toSupportRequestDto(row);
}

module.exports = {
  REQUEST_TYPES,
  STATUS_PENDING,
  TITLE_MAX_LENGTH,
  CONTENT_MAX_LENGTH,
  validateCreateBody,
  toSupportRequestDto,
  createSupportRequest,
};
