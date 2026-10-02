// services/documents.service.js - Nghiệp vụ tải lên, thay thế, xóa, tải xuống tài liệu hồ sơ (US9)
//
// Luồng upload: validate buffer (RAM) -> ghi file UUID xuống đĩa -> ghi DB trong transaction
//   -> chỉ SAU KHI commit mới xóa file cũ. Bất kỳ lỗi nào sau bước ghi đĩa đều xóa file mới.
const db = require("../db");
const { HttpError } = require("../errors");
const {
  validateFileBuffer,
  sanitizeFileName,
  ALLOWED_DOC_TYPES,
} = require("./documentValidator");
const storage = require("./fileStorage");

const STATUS_REJECTED = "Từ chối"; // Chỉ hồ sơ bị từ chối mới khóa tài liệu
const DOC_LABEL = { CV: "CV", APPLICATION_LETTER: "Đơn xin thực tập" };

// DTO trả về client (không lộ stored_name)
function toDocDto(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    application_id: Number(row.applicationId ?? row.application_id),
    doc_type: row.docType ?? row.doc_type,
    original_name: sanitizeFileName(row.originalName ?? row.original_name),
    mime_type: row.mimeType ?? row.mime_type,
    size_bytes: Number(row.sizeBytes ?? row.size_bytes),
    uploaded_at: row.uploadedAt ?? row.uploaded_at,
    updated_at: row.updatedAt ?? row.updated_at,
  };
}

// Tiến độ hoàn thiện: 0/2, 1/2, 2/2
function calculateProgress(documents = []) {
  const types = new Set(documents.map((d) => d.doc_type ?? d.docType));
  const hasCV = types.has("CV");
  const hasLetter = types.has("APPLICATION_LETTER");
  const totalUploaded = Number(hasCV) + Number(hasLetter);
  const isComplete = totalUploaded === 2;
  return {
    totalUploaded,
    requiredTotal: 2,
    hasCV,
    hasLetter,
    isComplete,
    statusLabel: isComplete ? "Đã đủ hồ sơ" : "Chưa đủ hồ sơ",
    progressText: `${totalUploaded}/2 tài liệu`,
    percent: totalUploaded * 50,
  };
}

function parseId(raw, message) {
  if (!/^\d+$/.test(String(raw))) throw new HttpError(400, message);
  return Number(raw);
}

function lockedMessage(status, action) {
  return `Hồ sơ của bạn đang ở trạng thái [${status}], không thể ${action}!`;
}

// Hồ sơ của Intern đang đăng nhập; chưa có (tài khoản do Admin tạo) thì tạo hồ sơ 'Chờ duyệt'
async function getInternApplication(user) {
  if (!user || !user.id) throw new HttpError(401, "Chưa xác thực người dùng!");

  let app = await db.findApplicationByUserIdOrEmail(user.id, user.email);
  if (!app) {
    app = await db.createCandidateProfileForUser(user.id);
  }
  if (!app) {
    throw new HttpError(404, "Không tìm thấy hồ sơ ứng tuyển liên kết với tài khoản này!");
  }
  return app;
}

function buildLockReason(app) {
  if (app.status === "Từ chối") {
    return `Hồ sơ đã bị từ chối (${app.rejectionReason || "Không đạt yêu cầu"}). Không thể chỉnh sửa tài liệu.`;
  }
  return "";
}

// GET /me/documents
async function listMyDocuments(user) {
  const app = await getInternApplication(user);
  const documents = (await db.findDocumentsByApplicationId(app.id)).map(toDocDto);
  const isLocked = app.status === STATUS_REJECTED;

  return {
    application: {
      id: Number(app.id),
      name: app.name,
      email: app.email,
      status: app.status,
      rejection_reason: app.rejectionReason || null,
      is_locked: isLocked,
      lock_reason: isLocked ? buildLockReason(app) : "",
    },
    documents,
    progress: calculateProgress(documents),
  };
}

// POST /me/documents - tải lên mới hoặc thay thế (UNIQUE application_id + doc_type)
async function uploadDocument(user, { file, docType }) {
  if (!file || !file.buffer) {
    throw new HttpError(400, "Vui lòng đính kèm file tài liệu (trường 'file')!");
  }
  if (!docType || !ALLOWED_DOC_TYPES.includes(docType)) {
    throw new HttpError(
      400,
      "Loại tài liệu (doc_type) không hợp lệ! Chỉ chấp nhận CV hoặc APPLICATION_LETTER.",
    );
  }

  // Validate đuôi, dung lượng, magic bytes trước khi ghi đĩa
  const meta = validateFileBuffer({
    buffer: file.buffer,
    originalname: file.originalname,
    size: file.buffer.length,
  });

  // Kiểm tra nhanh để khỏi ghi đĩa vô ích; kiểm tra chính thức nằm trong transaction
  const app = await getInternApplication(user);
  if (app.status === STATUS_REJECTED) {
    throw new HttpError(409, lockedMessage(app.status, "tải lên hoặc chỉnh sửa tài liệu"));
  }

  const storedName = storage.saveBuffer(file.buffer);

  // Lỗi hoặc hồ sơ bị khóa thì xóa file vừa lưu
  let result;
  try {
    result = await db.saveDocumentIfPending({
      applicationId: app.id,
      docType,
      originalName: meta.cleanName,
      storedName,
      mimeType: meta.mimeType,
      sizeBytes: file.buffer.length,
    });
  } catch (dbErr) {
    storage.removeFile(storedName);
    console.error("[DOCUMENTS] Lỗi khi lưu tài liệu vào database:", dbErr);
    throw new HttpError(500, "Lỗi khi lưu thông tin tài liệu vào cơ sở dữ liệu!");
  }

  if (result.outcome === "LOCKED") {
    storage.removeFile(storedName);
    throw new HttpError(409, lockedMessage(result.status, "tải lên hoặc chỉnh sửa tài liệu"));
  }
  if (result.outcome !== "SAVED") {
    storage.removeFile(storedName);
    throw new HttpError(404, "Không tìm thấy hồ sơ ứng tuyển liên kết với tài khoản này!");
  }

  // Upload đè: xóa file cũ sau khi DB đã commit
  const replaced = Boolean(result.previousStoredName);
  if (replaced) storage.removeFile(result.previousStoredName);

  const documents = await db.findDocumentsByApplicationId(app.id);
  return {
    document: toDocDto(result.document),
    progress: calculateProgress(documents.map(toDocDto)),
    message: `${replaced ? "Đã thay thế" : "Đã tải lên"} ${DOC_LABEL[docType]} thành công!`,
  };
}

// GET /:id/documents/:docId/download - chủ hồ sơ (Intern) hoặc HR
async function downloadDocument(user, { applicationId: rawAppId, docId: rawDocId }) {
  if (!user) throw new HttpError(401, "Chưa xác thực người dùng!");
  if (user.role !== "HR" && user.role !== "Intern") {
    throw new HttpError(
      403,
      `Từ chối truy cập: Vai trò [${user.role}] không được phép tải tài liệu ứng tuyển!`,
    );
  }

  const applicationId = parseId(rawAppId, "Mã hồ sơ không hợp lệ!");
  const docId = parseId(rawDocId, "Mã tài liệu không hợp lệ!");

  const app = await db.findApplicationById(applicationId);
  if (!app) throw new HttpError(404, "Không tìm thấy hồ sơ ứng viên!");

  if (user.role === "Intern") {
    const isOwner =
      (app.userId && Number(app.userId) === Number(user.id)) ||
      (app.email && app.email.toLowerCase() === String(user.email).toLowerCase());
    if (!isOwner) {
      throw new HttpError(
        403,
        "Từ chối truy cập: Bạn không có quyền xem hoặc tải tài liệu của ứng viên khác!",
      );
    }
  }

  const doc = await db.findDocumentById(docId);
  if (!doc || Number(doc.applicationId) !== applicationId) {
    throw new HttpError(404, "Không tìm thấy tài liệu yêu cầu!");
  }

  // resolveStoredPath ép đường dẫn nằm trong uploads/ kể cả khi stored_name trong DB bị sửa
  let filePath = null;
  try {
    filePath = storage.resolveStoredPath(doc.storedName);
  } catch {
    // Đường dẫn không hợp lệ -> filePath giữ null, xử lý 404 ngay bên dưới
  }
  if (!filePath || !storage.fileExists(doc.storedName)) {
    throw new HttpError(404, "File tài liệu không còn tồn tại trên máy chủ!");
  }

  return {
    filePath,
    originalName: sanitizeFileName(doc.originalName),
    mimeType: doc.mimeType || "application/octet-stream",
  };
}

// GET /:id/documents - HR xem danh sách file + tiến độ x/2 của một hồ sơ
async function listApplicationDocuments(rawAppId) {
  const applicationId = parseId(rawAppId, "Mã hồ sơ không hợp lệ!");
  const app = await db.findApplicationById(applicationId);
  if (!app) throw new HttpError(404, "Không tìm thấy hồ sơ ứng viên!");
  const documents = (await db.findDocumentsByApplicationId(applicationId)).map(toDocDto);
  return {
    application: { id: Number(app.id), name: app.name, email: app.email },
    documents,
    progress: calculateProgress(documents),
  };
}

// DELETE /me/documents/:docId - khi hồ sơ không bị 'Từ chối'
async function deleteMyDocument(user, rawDocId) {
  const docId = parseId(rawDocId, "Mã tài liệu không hợp lệ!");
  const app = await getInternApplication(user);

  const result = await db.deleteDocumentIfPending({ applicationId: app.id, docId });

  if (result.outcome === "LOCKED") {
    throw new HttpError(409, lockedMessage(result.status, "xóa tài liệu"));
  }
  if (result.outcome !== "DELETED") {
    // Gồm cả docId của hồ sơ khác: không tiết lộ là có tồn tại
    throw new HttpError(404, "Không tìm thấy tài liệu cần xóa!");
  }

  // DB đã commit: xóa file vật lý
  storage.removeFile(result.storedName);

  const documents = await db.findDocumentsByApplicationId(app.id);
  return {
    message: "Đã xóa tài liệu thành công!",
    progress: calculateProgress(documents.map(toDocDto)),
  };
}

module.exports = {
  calculateProgress,
  listMyDocuments,
  uploadDocument,
  downloadDocument,
  listApplicationDocuments,
  deleteMyDocument,
};
