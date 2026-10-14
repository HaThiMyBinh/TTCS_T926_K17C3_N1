// Nghiệp vụ quản lý hợp đồng của thực tập sinh chính thức.
const db = require("../db");
const { HttpError } = require("../errors");
const { validateFileBuffer, sanitizeFileName } = require("./documentValidator");
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
    intern_id: Number(row.internId),
    title: row.title,
    start_date: row.startDate,
    end_date: row.endDate,
    note: row.note,
    program_id: row.programId == null ? null : Number(row.programId),
    original_name: sanitizeFileName(row.originalName),
    mime_type: row.mimeType,
    size_bytes: Number(row.sizeBytes),
    uploaded_by: row.uploadedBy,
    uploaded_at: row.uploadedAt,
    updated_at: row.updatedAt,
    confirmation_status: row.confirmationStatus || "PENDING",
    confirmed_at: row.confirmedAt,
    confirmed_by: row.confirmedBy == null ? null : Number(row.confirmedBy),
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
    throw new HttpError(
      400,
      `${fieldName} không được vượt quá ${maxLength} ký tự!`,
    );
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
    throw new HttpError(400, "Ngày kết thúc phải bằng hoặc sau ngày bắt đầu!");
  }
}

// Hợp đồng gắn với chương trình thì khoảng ngày của hợp đồng phải nằm trong khoảng ngày của chương trình
// (chương trình chưa có ngày thì không giới hạn). Chỉ kiểm tra những ngày hợp đồng đã có.
function assertWithinProgramDates(program, startDate, endDate) {
  if (!program) return;
  if (startDate && program.start_date && startDate < program.start_date) {
    throw new HttpError(
      400,
      `Ngày bắt đầu hợp đồng không được trước ngày bắt đầu chương trình (${program.start_date})!`,
    );
  }
  if (endDate && program.end_date && endDate > program.end_date) {
    throw new HttpError(
      400,
      `Ngày kết thúc hợp đồng không được sau ngày kết thúc chương trình (${program.end_date})!`,
    );
  }
  if (startDate && program.end_date && startDate > program.end_date) {
    throw new HttpError(
      400,
      `Ngày bắt đầu hợp đồng không được sau ngày kết thúc chương trình (${program.end_date})!`,
    );
  }
  if (endDate && program.start_date && endDate < program.start_date) {
    throw new HttpError(
      400,
      `Ngày kết thúc hợp đồng không được trước ngày bắt đầu chương trình (${program.start_date})!`,
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
  const { file, title, start_date, end_date, note, program_id } = metadata;

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

  const programId = program_id ? parseId(program_id, "Mã chương trình") : null;
  if (programId != null) {
    const program = await db.findProgramById(programId);
    if (!program) throw new HttpError(404, "Không tìm thấy chương trình thực tập!");
    assertWithinProgramDates(program, start_date, end_date);
  }

  const storedName = storage.saveBuffer(file.buffer);
  try {
    const row = await db.insertContract({
      internId,
      title: textFields.title,
      startDate: start_date || null,
      endDate: end_date || null,
      note: textFields.note,
      programId,
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

async function getDownloadForInternId(
  internId,
  contractId,
  missingFileMessage,
) {
  const contract = await db.findContractById(internId, contractId);
  if (!contract) {
    throw new HttpError(404, "Không tìm thấy hợp đồng của thực tập sinh!");
  }

  const filePath = storage.resolveExistingPath(contract.storedName);
  if (!filePath) {
    throw new HttpError(404, missingFileMessage);
  }

  return {
    filePath,
    originalName: sanitizeFileName(contract.originalName),
    mimeType: contract.mimeType,
  };
}

async function getDownload(rawInternId, rawContractId) {
  const internId = parseId(rawInternId, "Mã thực tập sinh");
  const contractId = parseId(rawContractId, "Mã hợp đồng");
  return getDownloadForInternId(
    internId,
    contractId,
    "File hợp đồng không còn trên máy chủ. Vui lòng tải hợp đồng lên lại!",
  );
}

async function findInternForUser(user) {
  if (!user?.email)
    throw new HttpError(404, "Tài khoản chưa có hồ sơ thực tập sinh!");
  const intern = await db.findInternProfileByEmail(user.email);
  if (!intern)
    throw new HttpError(404, "Tài khoản chưa có hồ sơ thực tập sinh!");
  return intern;
}

async function listForIntern(user) {
  const intern = await findInternForUser(user);
  return (await db.listContractsByInternId(intern.id)).map(toDto);
}

async function getDownloadForIntern(user, rawContractId) {
  const contractId = parseId(rawContractId, "Mã hợp đồng");
  const intern = await findInternForUser(user);
  return getDownloadForInternId(
    intern.id,
    contractId,
    "File hợp đồng không còn trên máy chủ. Vui lòng liên hệ HR để được hỗ trợ!",
  );
}

async function confirmForIntern(user, rawContractId) {
  const contractId = parseId(rawContractId, "Mã hợp đồng");
  const intern = await findInternForUser(user);
  const result = await db.confirmContractAtomic(intern.id, contractId, user.id);
  if (result.outcome === "NOT_FOUND") {
    throw new HttpError(404, "Không tìm thấy hợp đồng của thực tập sinh!");
  }
  if (result.outcome === "ALREADY_CONFIRMED") {
    throw new HttpError(409, "Hợp đồng này đã được bạn xác nhận trước đó!");
  }
  if (result.outcome !== "CONFIRMED" || !result.contract) {
    throw new HttpError(409, "Hợp đồng hiện không ở trạng thái chờ xác nhận!");
  }
  return toDto(result.contract);
}

async function remove(rawInternId, rawContractId) {
  const internId = parseId(rawInternId, "Mã thực tập sinh");
  const contractId = parseId(rawContractId, "Mã hợp đồng");
  const result = await db.deleteContract(internId, contractId);
  if (result.outcome === "NOT_FOUND") {
    throw new HttpError(404, "Không tìm thấy hợp đồng của thực tập sinh!");
  }
  if (result.outcome === "CONFIRMED") {
    throw new HttpError(
      409,
      "Không thể xóa hợp đồng đã được thực tập sinh xác nhận!",
    );
  }

  storage.removeFile(result.storedName);
}

const UPDATABLE_FIELDS = ["program_id", "start_date", "end_date"];

// Sửa chương trình và/hoặc khoảng ngày của hợp đồng
// (kể cả hợp đồng đã xác nhận).
async function updateContract(rawInternId, rawContractId, body) {
  const internId = parseId(rawInternId, "Mã thực tập sinh");
  const contractId = parseId(rawContractId, "Mã hợp đồng");
  const provided = UPDATABLE_FIELDS.filter(
    (field) => body && Object.hasOwn(body, field),
  );
  if (provided.length === 0) {
    throw new HttpError(
      400,
      "Cần gửi ít nhất một trường: program_id, start_date hoặc end_date!",
    );
  }

  const changes = {};
  if (provided.includes("program_id")) {
    // null hoặc chuỗi rỗng nghĩa là gỡ liên kết chương trình.
    const rawProgramId = body.program_id;
    changes.programId =
      rawProgramId === null || rawProgramId === ""
        ? null
        : parseId(rawProgramId, "Mã chương trình");
  }
  // Ngày bắt buộc phải hợp lệ; không cho xóa trắng ngày của hợp đồng đã có.
  if (provided.includes("start_date")) {
    if (typeof body.start_date !== "string" || !isValidDate(body.start_date)) {
      throw new HttpError(400, "Ngày bắt đầu không hợp lệ!");
    }
    changes.startDate = body.start_date;
  }
  if (provided.includes("end_date")) {
    if (typeof body.end_date !== "string" || !isValidDate(body.end_date)) {
      throw new HttpError(400, "Ngày kết thúc không hợp lệ!");
    }
    changes.endDate = body.end_date;
  }

  const existing = await db.findContractById(internId, contractId);
  if (!existing) {
    throw new HttpError(404, "Không tìm thấy hợp đồng của thực tập sinh!");
  }

  // Chương trình sau khi sửa: chương trình mới nếu có gửi, nếu không thì chương trình đang gắn.
  const effectiveProgramId = provided.includes("program_id")
    ? changes.programId
    : existing.programId;
  const program =
    effectiveProgramId != null
      ? await db.findProgramById(effectiveProgramId)
      : null;
  if (changes.programId != null && !program) {
    throw new HttpError(404, "Không tìm thấy chương trình thực tập!");
  }

  // Kiểm tra khoảng ngày sau khi gộp với giá trị đang lưu
  // (có thể chỉ đổi một đầu).
  const startDate = changes.startDate ?? existing.startDate;
  const endDate = changes.endDate ?? existing.endDate;
  validateDates(startDate, endDate);
  assertWithinProgramDates(program, startDate, endDate);

  // Hợp đồng đã xác nhận mà HR đổi một ngày ĐÃ CÓ sang giá trị khác thì thực tập sinh phải xác nhận lại.
  // Điền ngày vào chỗ còn trống (hoặc đổi chương trình) thì không thay đổi điều khoản đã xác nhận.
  const changesExistingDate = (key) =>
    changes[key] !== undefined &&
    existing[key] != null &&
    changes[key] !== existing[key];
  const reconfirmationRequired =
    existing.confirmationStatus === "CONFIRMED" &&
    (changesExistingDate("startDate") || changesExistingDate("endDate"));
  if (reconfirmationRequired) changes.resetConfirmation = true;

  const row = await db.updateContractFields(internId, contractId, changes);
  if (!row) {
    throw new HttpError(404, "Không tìm thấy hợp đồng của thực tập sinh!");
  }
  return reconfirmationRequired
    ? { ...toDto(row), reconfirmation_required: true }
    : toDto(row);
}

function removeFiles(storedNames = []) {
  storedNames.forEach((storedName) => storage.removeFile(storedName));
}

module.exports = {
  parseId,
  toDto,
  validateDates,
  assertWithinProgramDates,
  validateContractText,
  list,
  upload,
  getDownload,
  listForIntern,
  getDownloadForIntern,
  confirmForIntern,
  remove,
  updateContract,
  removeFiles,
};
