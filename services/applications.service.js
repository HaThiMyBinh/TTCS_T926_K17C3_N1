// services/applications.service.js - Nghiệp vụ duyệt / từ chối hồ sơ (US7)
const db = require("../db");

// Mã trạng thái phía API <-> nhãn lưu trong database (ENUM tiếng Việt có sẵn)
const STATUS_TO_DB = {
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Từ chối",
};
const DB_TO_STATUS = Object.fromEntries(
  Object.entries(STATUS_TO_DB).map(([code, label]) => [label, code]),
);

const REVIEWABLE_TARGETS = ["APPROVED", "REJECTED"];
const MAX_REASON_LENGTH = 1000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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
  };
}

async function listApplications() {
  const rows = await db.listApplications();
  return rows.map(toDto);
}

function parseId(rawId) {
  if (!/^\d+$/.test(String(rawId))) {
    throw new HttpError(400, "ID hồ sơ không hợp lệ!");
  }
  return Number(rawId);
}

async function changeStatus({ id: rawId, status, rejection_reason }, reviewer) {
  const id = parseId(rawId);

  // 1. Validate đầu vào -> 400
  if (typeof status !== "string" || !REVIEWABLE_TARGETS.includes(status)) {
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

  // 2. Cập nhật atomic: UPDATE ... WHERE id = ? AND status = 'Chờ duyệt'
  const updated = await db.reviewApplicationAtomic({
    id,
    newStatus: STATUS_TO_DB[status],
    rejectionReason: reason,
    reviewerId: reviewer.id,
  });

  if (updated) {
    return {
      message:
        status === "APPROVED"
          ? "Đã duyệt hồ sơ ứng viên!"
          : "Đã từ chối hồ sơ ứng viên!",
      data: toDto(updated),
    };
  }

  // 3. Không có dòng nào đổi: phân biệt 404 (không tồn tại) và 409 (đã xử lý)
  const existing = await db.findApplicationById(id);
  if (!existing) {
    throw new HttpError(404, "Không tìm thấy hồ sơ ứng viên!");
  }
  throw new HttpError(
    409,
    `Hồ sơ không ở trạng thái PENDING (hiện tại: ${DB_TO_STATUS[existing.status] || existing.status}). Có thể đã được HR khác xử lý.`,
  );
}

module.exports = { listApplications, changeStatus, HttpError, toDto };
