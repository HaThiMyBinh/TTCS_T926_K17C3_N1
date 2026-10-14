// Nghiệp vụ phụ cấp thực tập sinh: HR nhập khoản phụ cấp (loại, số tiền VND, kỳ/tháng, ghi chú).
// Mỗi intern chỉ có 1 khoản cho mỗi (loại phụ cấp, kỳ); nhập trùng trả 409.
const db = require("../db");
const { HttpError } = require("../errors");

const TYPE_MAX_LENGTH = 100;
const NOTE_MAX_LENGTH = 500;
const AMOUNT_MAX = 1_000_000_000_000; // 1.000 tỷ VND - chặn nhập nhầm quá lớn
const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

function parseId(rawId, label) {
  const text = String(rawId ?? "");
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new HttpError(400, `${label} không hợp lệ!`);
  }
  return Number(text);
}

function validateAllowanceType(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "Vui lòng nhập loại phụ cấp!");
  }
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length > TYPE_MAX_LENGTH) {
    throw new HttpError(
      400,
      `Loại phụ cấp tối đa ${TYPE_MAX_LENGTH} ký tự!`,
    );
  }
  return text;
}

// Chỉ nhận số thật (không nhận chuỗi "500000"), nguyên, > 0.
function validateAmount(value) {
  if (value === undefined || value === null || value === "") {
    throw new HttpError(400, "Vui lòng nhập số tiền phụ cấp!");
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError(400, "Số tiền phụ cấp phải là số!");
  }
  if (value <= 0) {
    throw new HttpError(400, "Số tiền phụ cấp phải lớn hơn 0!");
  }
  if (!Number.isInteger(value)) {
    throw new HttpError(400, "Số tiền phụ cấp (VND) phải là số nguyên!");
  }
  if (value > AMOUNT_MAX) {
    throw new HttpError(400, "Số tiền phụ cấp vượt quá giới hạn cho phép!");
  }
  return value;
}

// Kỳ/tháng dạng YYYY-MM (tháng 01-12).
function validatePeriod(value) {
  if (value === undefined || value === null || value === "") {
    throw new HttpError(400, "Vui lòng nhập kỳ phụ cấp (YYYY-MM)!");
  }
  if (typeof value !== "string" || !PERIOD_REGEX.test(value.trim())) {
    throw new HttpError(
      400,
      "Kỳ phụ cấp không hợp lệ, cần định dạng YYYY-MM (tháng 01-12)!",
    );
  }
  return value.trim();
}

function validateNote(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new HttpError(400, "Ghi chú phải là chuỗi!");
  }
  const text = value.trim();
  if (!text) return null;
  if (text.length > NOTE_MAX_LENGTH) {
    throw new HttpError(400, `Ghi chú tối đa ${NOTE_MAX_LENGTH} ký tự!`);
  }
  return text;
}

function toAllowanceDto(row) {
  return {
    id: Number(row.id),
    intern_id: Number(row.internId),
    allowance_type: row.allowanceType,
    amount: Number(row.amount),
    period: row.period,
    note: row.note ?? null,
    created_by: row.createdBy == null ? null : Number(row.createdBy),
    created_at:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : (row.createdAt ?? null),
  };
}

// Tạo khoản phụ cấp. Quyền HR được chặn ở route; service kiểm tra dữ liệu & trùng lặp.
async function createAllowance(user, input) {
  const body = input && typeof input === "object" ? input : {};

  const internId = parseId(body.intern_id, "Mã thực tập sinh");
  const allowanceType = validateAllowanceType(body.allowance_type);
  const amount = validateAmount(body.amount);
  const period = validatePeriod(body.period);
  const note = validateNote(body.note);

  const intern = await db.findInternProfileById(internId);
  if (!intern) throw new HttpError(404, "Không tìm thấy thực tập sinh!");

  const duplicateMessage = `Thực tập sinh đã có phụ cấp "${allowanceType}" trong kỳ ${period}!`;
  if (await db.findInternAllowanceByKey(internId, allowanceType, period)) {
    throw new HttpError(409, duplicateMessage);
  }

  const result = await db.insertInternAllowance({
    internId,
    allowanceType,
    amount,
    period,
    note,
    createdBy: user?.id ?? null,
  });
  // Hai request cùng lúc: UNIQUE (intern_id, allowance_type, period) chặn request đến sau.
  if (result.duplicate) throw new HttpError(409, duplicateMessage);

  return toAllowanceDto(result.allowance);
}

module.exports = {
  PERIOD_REGEX,
  validateAllowanceType,
  validateAmount,
  validatePeriod,
  validateNote,
  toAllowanceDto,
  createAllowance,
};
