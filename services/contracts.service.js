// Nghiệp vụ quản lý hợp đồng của thực tập sinh chính thức.
const db = require("../db");
const { HttpError } = require("../errors");
const {
  validateFileBuffer,
  sanitizeFileName,
} = require("./documentValidator");
const storage = require("./fileStorage");

const MAX_TITLE_LENGTH = 255;
const MAX_NOTE_LENGTH = 1000;

function parseId(raw, label) {
  if (!/^\d+$/.test(String(raw))) {
    throw new HttpError(400, `${label} không hợp lệ!`);
  }
  return Number(raw);
}

// DTO công khai không bao giờ chứa tên file UUID trong storage.
function toDto(row) {
  return {
    id: Number(row.id),
    intern_id: Number(row.internId ?? row.intern_id),
    title: row.title,
    start_date: row.startDate ?? row.start_date,
    end_date: row.endDate ?? row.end_date,
    note: row.note,
    original_name: sanitizeFileName(row.originalName ?? row.original_name),
    mime_type: row.mimeType ?? row.mime_type,
    size_bytes: Number(row.sizeBytes ?? row.size_bytes),
    uploaded_by: row.uploadedBy ?? row.uploaded_by,
    uploaded_at: row.uploadedAt ?? row.uploaded_at,
    updated_at: row.updatedAt ?? row.updated_at,
  };
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function normalizeTextField(value, fieldName, maxLength) {
  const normalized = String(value || "").trim();
  if (Array.from(normalized).length > maxLength) {
    throw new HttpError(400, `${fieldName} không được vượt quá ${maxLength} ký tự!`);
  }
  return normalized || null;
}

function validateContractText(title, note) {
  return {
    title: normalizeTextField(title, "Tiêu đề hợp đồng", MAX_TITLE_LENGTH),
    note: normalizeTextField(note, "Ghi chú", MAX_NOTE_LENGTH),
  };
}

function validateDates(startDate, endDate) {
  if (startDate && !isValidDate(startDate)) {
    throw new HttpError(400, "Ngày bắt đầu không hợp lệ!");
  }
  if (endDate && !isValidDate(endDate)) {
    throw new HttpError(400, "Ngày kết thúc không hợp lệ!");
  }
  if (startDate && endDate && endDate < startDate) {
    throw new HttpError(
      400,
      "Ngày kết thúc phải bằng hoặc sau ngày bắt đầu!",
    );
  }
}

async function list(rawInternId) {
  const internId = parseId(rawInternId, "Mã thực tập sinh");
  const intern = await db.findInternProfileById(internId);
  if (!intern) throw new HttpError(404, "Không tìm thấy hồ sơ thực tập sinh!");

  const contracts = await db.listContractsByInternId(internId);
  return contracts.map(toDto);
}

async function upload(rawInternId, user, metadata) {
  const internId = parseId(rawInternId, "Mã thực tập sinh");
  const { file, title, start_date, end_date, note } = metadata;

  if (!file?.buffer) {
    throw new HttpError(
      400,
      "Vui lòng đính kèm file hợp đồng (trường 'file')!",
    );
  }

  const fileMetadata = validateFileBuffer({
    buffer: file.buffer,
    originalname: file.originalname,
    size: file.buffer.length,
  });
  validateDates(start_date, end_date);
  const textFields = validateContractText(title, note);

  const intern = await db.findInternProfileById(internId);
  if (!intern) throw new HttpError(404, "Không tìm thấy hồ sơ thực tập sinh!");

  const storedName = storage.saveBuffer(file.buffer);
  try {
    const row = await db.insertContract({
      internId,
      title: textFields.title,
      startDate: start_date || null,
      endDate: end_date || null,
      note: textFields.note,
      originalName: fileMetadata.cleanName,
      storedName,
      mimeType: fileMetadata.mimeType,
      sizeBytes: file.buffer.length,
      uploadedBy: user.id,
    });
    return toDto(row);
  } catch (err) {
    storage.removeFile(storedName);
    console.error("[CONTRACTS] Lỗi khi lưu hợp đồng vào database:", err);
    throw new HttpError(
      500,
      "Lỗi khi lưu thông tin hợp đồng vào cơ sở dữ liệu!",
    );
  }
}

async function getDownload(rawInternId, rawContractId) {
  const internId = parseId(rawInternId, "Mã thực tập sinh");
  const contractId = parseId(rawContractId, "Mã hợp đồng");
  const contract = await db.findContractById(internId, contractId);
  if (!contract) {
    throw new HttpError(404, "Không tìm thấy hợp đồng của thực tập sinh!");
  }

  return {
    filePath: storage.resolveStoredPath(contract.storedName),
    originalName: sanitizeFileName(contract.originalName),
    mimeType: contract.mimeType,
  };
}

async function remove(rawInternId, rawContractId) {
  const internId = parseId(rawInternId, "Mã thực tập sinh");
  const contractId = parseId(rawContractId, "Mã hợp đồng");
  const storedName = await db.deleteContract(internId, contractId);
  if (!storedName) {
    throw new HttpError(404, "Không tìm thấy hợp đồng của thực tập sinh!");
  }

  storage.removeFile(storedName);
}

function removeFiles(storedNames = []) {
  storedNames.forEach((storedName) => storage.removeFile(storedName));
}

module.exports = {
  parseId,
  toDto,
  validateDates,
  validateContractText,
  list,
  upload,
  getDownload,
  remove,
  removeFiles,
};
