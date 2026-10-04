// Nghiệp vụ duyệt / từ chối hồ sơ (US7)
const EventEmitter = require("events");
const db = require("../db");
const { HttpError } = require("../errors");
const { sanitizeFileName } = require("./documentValidator");
const {
  REQUIRED_DOC_TYPES,
  isReviewableStatus,
  validateReviewConditions,
} = require("./reviewRules");

// Phát sau khi DB đã cập nhật; server.js lắng nghe để gửi email nền
const applicationEvents = new EventEmitter();
const REVIEWED_EVENT = "application.reviewed";

// Mã trạng thái phía API <-> nhãn lưu trong database (ENUM tiếng Việt có sẵn)
const STATUS_TO_DB = {
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Từ chối",
};
const DB_TO_STATUS = Object.fromEntries(
  Object.entries(STATUS_TO_DB).map(([code, label]) => [label, code]),
);

const MAX_REASON_LENGTH = 1000;

// Chuyển bản ghi DB thành DTO trả cho client (status là mã APPROVED/REJECTED/PENDING)
function toDto(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    phone: row.phone || "",
    university: row.university || "",
    major: row.major || "",
    cvLink: row.cvLink || "",
    status: DB_TO_STATUS[row.status] || row.status,
    rejection_reason: row.rejectionReason || null,
    reviewed_by: row.reviewedBy != null ? Number(row.reviewedBy) : null,
    reviewed_at: row.reviewedAt || null,
    applied_at: row.createdAt || null,
    documents: row.documents || [],
  };
}

// Tài liệu của nhiều hồ sơ trong 1 truy vấn (tránh N+1) -> Map<applicationId, DTO[]>
async function loadDocumentsByApplication(applicationIds) {
  const byApp = new Map();
  if (applicationIds.length === 0) return byApp;
  const docRows = await db.findDocumentsByApplicationIds(applicationIds);
  for (const d of docRows) {
    const key = Number(d.applicationId);
    if (!byApp.has(key)) byApp.set(key, []);
    byApp.get(key).push({
      id: Number(d.id),
      doc_type: d.docType,
      original_name: sanitizeFileName(d.originalName),
      size_bytes: Number(d.sizeBytes),
      uploaded_at: d.uploadedAt,
    });
  }
  return byApp;
}

async function listApplications(requester) {
  const rows = await db.listApplications();
  const dtos = rows.map(toDto);

  // Chỉ HR thấy tài liệu ứng viên
  if (requester && requester.role === "HR") {
    const byApp = await loadDocumentsByApplication(dtos.map((d) => d.id));
    for (const dto of dtos) dto.documents = byApp.get(dto.id) || [];
  }
  return dtos;
}

// Gắn hồ sơ ứng tuyển + tài liệu vào danh sách hồ sơ thực tập sinh (khớp theo email) - chỉ dành cho HR.
// Thực tập sinh chưa có hồ sơ ứng tuyển -> application: null, documents: [].
async function attachApplicationsToStudents(students) {
  const emailOf = (s) => String(s.email || "").toLowerCase();
  const apps = await db.findApplicationsByEmails([
    ...new Set(students.map(emailOf).filter(Boolean)),
  ]);
  const appByEmail = new Map(apps.map((a) => [emailOf(a), toDto(a)]));
  const docsByApp = await loadDocumentsByApplication(
    [...appByEmail.values()].map((a) => a.id),
  );

  return students.map((s) => {
    const app = appByEmail.get(emailOf(s));
    return {
      ...s,
      application: app
        ? {
            id: app.id,
            status: app.status,
            rejection_reason: app.rejection_reason,
          }
        : null,
      documents: app ? docsByApp.get(app.id) || [] : [],
    };
  });
}

function parseId(rawId) {
  if (!/^\d+$/.test(String(rawId))) {
    throw new HttpError(400, "ID hồ sơ không hợp lệ!");
  }
  return Number(rawId);
}

// require_documents: mặc định true (duyệt phải đủ CV + Đơn xin thực tập).
// Chỉ khi truyền đúng false (trang duyệt hồ sơ online) mới bỏ qua điều kiện tài liệu.
async function changeStatus(
  { id: rawId, status, rejection_reason, require_documents },
  reviewer,
) {
  const id = parseId(rawId);

  if (!isReviewableStatus(status)) {
    throw new HttpError(
      400,
      "Trạng thái không hợp lệ! Chỉ chấp nhận APPROVED hoặc REJECTED.",
    );
  }

  let reason = null;
  if (status === "REJECTED") {
    reason =
      typeof rejection_reason === "string" ? rejection_reason.trim() : "";
    if (!reason) {
      throw new HttpError(400, "Vui lòng nhập lý do từ chối!");
    }
    if (reason.length > MAX_REASON_LENGTH) {
      throw new HttpError(
        400,
        `Lý do từ chối tối đa ${MAX_REASON_LENGTH} ký tự!`,
      );
    }
  }

  const requireDocs = status === "APPROVED" && require_documents !== false;

  // Duyệt: báo lỗi sớm (404 -> 409 -> 400) trước khi chạm vào UPDATE
  if (status === "APPROVED") await assertCanReview(id, requireDocs);

  // Cập nhật atomic: chỉ đổi khi hồ sơ còn 'Chờ duyệt' (và đủ tài liệu nếu là duyệt)
  const updated = await db.reviewApplicationAtomic({
    id,
    newStatus: STATUS_TO_DB[status],
    rejectionReason: reason,
    reviewerId: reviewer.id,
    requiredDocs: requireDocs ? REQUIRED_DOC_TYPES.length : 0,
  });

  if (updated) {
    const dto = toDto(updated);

    // Lỗi từ consumer không được làm hỏng việc duyệt đã thành công
    try {
      applicationEvents.emit(REVIEWED_EVENT, {
        application: dto,
        action: status,
        reviewer,
      });
    } catch (emitErr) {
      console.error(
        "[APPLICATIONS] Lỗi khi phát sự kiện application.reviewed:",
        emitErr,
      );
    }

    return {
      message:
        status === "APPROVED"
          ? "Đã duyệt hồ sơ ứng viên!"
          : "Đã từ chối hồ sơ ứng viên!",
      data: dto,
    };
  }

  // Không có dòng nào đổi: xác định lý do (404 / 409 / 400 do tài liệu bị xóa lúc đang duyệt)
  await assertCanReview(id, requireDocs);
  throw new HttpError(
    409,
    "Hồ sơ vừa được xử lý ở nơi khác, vui lòng tải lại danh sách!",
  );
}

// Ném 404 (không tồn tại), 409 (không còn 'Chờ duyệt') hoặc 400 (duyệt khi thiếu tài liệu)
async function assertCanReview(id, requireDocs) {
  const app = await db.findApplicationById(id);
  if (!app) throw new HttpError(404, "Không tìm thấy hồ sơ ứng viên!");
  if (app.status !== STATUS_TO_DB.PENDING) {
    throw new HttpError(
      409,
      `Hồ sơ không ở trạng thái PENDING (hiện tại: ${DB_TO_STATUS[app.status] || app.status}). Có thể đã được HR khác xử lý.`,
    );
  }
  if (requireDocs) {
    const documents = await db.findDocumentsByApplicationId(id);
    const check = validateReviewConditions({ status: "APPROVED", documents });
    if (!check.valid) throw new HttpError(check.httpStatus, check.message);
  }
}

module.exports = {
  listApplications,
  attachApplicationsToStudents,
  changeStatus,
  applicationEvents,
  REVIEWED_EVENT,
};
