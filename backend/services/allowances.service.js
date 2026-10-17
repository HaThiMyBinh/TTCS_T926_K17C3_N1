// Phụ cấp thực tập sinh: HR nhập các khoản phụ cấp (ăn uống, đi lại, điện thoại, nhà ở, khác) kèm
// số tiền VND, chu kỳ chi trả và khoảng ngày hiệu lực để quản lý quyền lợi.
const db = require("../db");
const { HttpError } = require("../errors");
const weeks = require("../utils/weeks");
const { getVietnamToday } = require("../utils/date");
const { normalizeInternFilters } = require("../utils/internFilters");
const { contractCovers } = require("./scheduleRules.service");

const ALLOWANCE_TYPES = ["MEAL", "TRANSPORT", "PHONE", "HOUSING", "OTHER"];
const PAY_CYCLES = ["MONTHLY", "DAILY", "ONE_TIME"];
const AMOUNT_MAX = 999999999;
const NOTE_MAX_LENGTH = 500;
// Trường client được gửi lên (tên snake_case); trường lạ như intern_id, created_by bị từ chối.
const INPUT_FIELDS = [
  "allowance_type",
  "amount",
  "pay_cycle",
  "effective_from",
  "effective_to",
  "note",
];
const REQUIRED_FIELDS = [
  "allowance_type",
  "amount",
  "pay_cycle",
  "effective_from",
];

function parseId(rawId, label) {
  const text = String(rawId ?? "");
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new HttpError(400, `${label} không hợp lệ!`);
  }
  return Number(text);
}

function has(input, key) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function validateDate(value, label) {
  if (!weeks.isValidDate(value)) {
    throw new HttpError(400, `${label} không hợp lệ (định dạng YYYY-MM-DD)!`);
  }
  return value;
}

/**
 * Kiểm tra từng trường được gửi. partial = true (PATCH): chỉ kiểm tra các trường có mặt.
 * Trả về object camelCase chỉ gồm các trường đã gửi.
 */
function validateAllowanceFields(input, { partial = false } = {}) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "Dữ liệu phụ cấp không hợp lệ!");
  }
  const extra = Object.keys(input).filter((key) => !INPUT_FIELDS.includes(key));
  if (extra.length > 0) {
    throw new HttpError(400, `Trường không được phép: ${extra.join(", ")}!`);
  }
  if (partial && !INPUT_FIELDS.some((key) => has(input, key))) {
    throw new HttpError(400, "Không có trường nào để cập nhật!");
  }
  if (!partial) {
    const missing = REQUIRED_FIELDS.filter(
      (key) =>
        input[key] === undefined || input[key] === null || input[key] === "",
    );
    if (missing.length > 0) {
      throw new HttpError(
        400,
        `Thiếu thông tin bắt buộc: ${missing.join(", ")}!`,
      );
    }
  }

  const out = {};
  if (has(input, "allowance_type")) {
    if (!ALLOWANCE_TYPES.includes(input.allowance_type)) {
      throw new HttpError(
        400,
        `Loại phụ cấp phải là một trong: ${ALLOWANCE_TYPES.join(", ")}!`,
      );
    }
    out.allowanceType = input.allowance_type;
  }
  if (has(input, "pay_cycle")) {
    if (!PAY_CYCLES.includes(input.pay_cycle)) {
      throw new HttpError(
        400,
        `Chu kỳ chi trả phải là một trong: ${PAY_CYCLES.join(", ")}!`,
      );
    }
    out.payCycle = input.pay_cycle;
  }
  if (has(input, "amount")) {
    // Chỉ nhận số nguyên thật (không nhận chuỗi "500000", số thực, true...).
    if (typeof input.amount !== "number" || !Number.isInteger(input.amount)) {
      throw new HttpError(400, "Số tiền phụ cấp phải là số nguyên (VND)!");
    }
    if (input.amount <= 0 || input.amount > AMOUNT_MAX) {
      throw new HttpError(
        400,
        `Số tiền phụ cấp phải lớn hơn 0 và không vượt quá ${AMOUNT_MAX.toLocaleString("vi-VN")} VND!`,
      );
    }
    out.amount = input.amount;
  }
  if (has(input, "effective_from")) {
    out.effectiveFrom = validateDate(
      input.effective_from,
      "Ngày bắt đầu hiệu lực",
    );
  }
  if (has(input, "effective_to")) {
    out.effectiveTo =
      input.effective_to === null || input.effective_to === ""
        ? null
        : validateDate(input.effective_to, "Ngày kết thúc hiệu lực");
  }
  if (has(input, "note")) {
    if (input.note === null || input.note === undefined) {
      out.note = null;
    } else if (typeof input.note !== "string") {
      throw new HttpError(400, "Ghi chú phải là chuỗi!");
    } else {
      const text = input.note.trim();
      if (text.length > NOTE_MAX_LENGTH) {
        throw new HttpError(
          400,
          `Ghi chú không được vượt quá ${NOTE_MAX_LENGTH} ký tự!`,
        );
      }
      out.note = text || null;
    }
  }
  return out;
}

// Các luật liên quan giữa nhiều trường, kiểm tra trên dữ liệu đã gộp (quan trọng với PATCH).
function validateCombination(fields) {
  if (fields.effectiveTo && fields.effectiveFrom > fields.effectiveTo) {
    throw new HttpError(
      400,
      "Ngày kết thúc hiệu lực không được trước ngày bắt đầu!",
    );
  }
  if (fields.allowanceType === "OTHER" && !fields.note) {
    throw new HttpError(
      400,
      "Phụ cấp loại Khác bắt buộc phải có ghi chú mô tả!",
    );
  }
  return fields;
}

// Trạng thái hiệu lực của một khoản phụ cấp tại ngày `today` (YYYY-MM-DD).
function allowanceStatus(allowance, today) {
  if (allowance.effectiveFrom > today) return "UPCOMING";
  if (allowance.effectiveTo && allowance.effectiveTo < today) return "EXPIRED";
  return "ACTIVE";
}

// Tổng hợp các khoản đang hiệu lực. Chỉ khoản theo THÁNG mới cộng vào totalMonthly;
// khoản theo ngày / một lần phụ thuộc ngày công thực tế nên không quy đổi.
function summarizeAllowances(allowances, today) {
  const summary = {
    totalCount: allowances.length,
    activeCount: 0,
    totalMonthly: 0,
    totalDaily: 0,
  };
  for (const item of allowances) {
    if (allowanceStatus(item, today) !== "ACTIVE") continue;
    summary.activeCount += 1;
    if (item.payCycle === "MONTHLY") summary.totalMonthly += item.amount;
    if (item.payCycle === "DAILY") summary.totalDaily += item.amount;
  }
  return summary;
}

// Khoảng hiệu lực phải nằm trong một hợp đồng đã xác nhận. Nếu chưa có ngày kết thúc thì phụ cấp
// kéo dài đến hết hợp đồng nên chỉ cần ngày bắt đầu nằm trong hợp đồng.
function isCoveredByContract(contracts, effectiveFrom, effectiveTo) {
  const last = effectiveTo || effectiveFrom;
  return contracts.some(
    (c) => contractCovers(c, effectiveFrom) && contractCovers(c, last),
  );
}

async function requireIntern(rawId) {
  const internId = parseId(rawId, "ID thực tập sinh");
  const intern = await db.findInternProfileById(internId);
  if (!intern) throw new HttpError(404, "Không tìm thấy hồ sơ thực tập sinh!");
  return intern;
}

async function assertContractRules(internId, fields) {
  const contracts = await db.listConfirmedContractsForInterns([internId]);
  if (contracts.length === 0) {
    throw new HttpError(
      409,
      "Thực tập sinh chưa có hợp đồng đã xác nhận nên chưa thể nhập phụ cấp!",
    );
  }
  if (
    !isCoveredByContract(contracts, fields.effectiveFrom, fields.effectiveTo)
  ) {
    throw new HttpError(
      409,
      "Thời gian hiệu lực phụ cấp phải nằm trong kỳ của một hợp đồng đã xác nhận!",
    );
  }
}

function throwForOutcome(result) {
  if (result.outcome === "NOT_FOUND") {
    throw new HttpError(404, "Không tìm thấy khoản phụ cấp!");
  }
  if (result.outcome === "OVERLAP") {
    throw new HttpError(
      409,
      "Đã có khoản phụ cấp cùng loại trùng khoảng thời gian hiệu lực. Hãy sửa hoặc kết thúc khoản cũ trước!",
    );
  }
}

async function listForIntern(rawInternId) {
  const intern = await requireIntern(rawInternId);
  const today = getVietnamToday();
  const items = (await db.listAllowancesByIntern(intern.id)).map((a) => ({
    ...a,
    status: allowanceStatus(a, today),
  }));
  return {
    intern: {
      id: intern.id,
      fullName: intern.fullName,
      studentCode: intern.studentCode,
    },
    items,
    summary: summarizeAllowances(items, today),
  };
}

async function create(user, rawInternId, body) {
  const intern = await requireIntern(rawInternId);
  const fields = validateCombination({
    note: null,
    effectiveTo: null,
    ...validateAllowanceFields(body),
  });
  await assertContractRules(intern.id, fields);
  const result = await db.saveAllowanceAtomic({
    internId: intern.id,
    fields,
    userId: user?.id,
  });
  throwForOutcome(result);
  return withStatus(await db.findAllowanceById(result.id));
}

async function update(user, rawInternId, rawAllowanceId, body) {
  const intern = await requireIntern(rawInternId);
  const allowanceId = parseId(rawAllowanceId, "ID khoản phụ cấp");
  const patch = validateAllowanceFields(body, { partial: true });
  const existing = await db.findAllowanceById(allowanceId);
  if (!existing || existing.internId !== intern.id) {
    throw new HttpError(404, "Không tìm thấy khoản phụ cấp!");
  }
  const fields = validateCombination({
    allowanceType: existing.allowanceType,
    amount: existing.amount,
    payCycle: existing.payCycle,
    effectiveFrom: existing.effectiveFrom,
    effectiveTo: existing.effectiveTo,
    note: existing.note,
    ...patch,
  });
  await assertContractRules(intern.id, fields);
  const result = await db.saveAllowanceAtomic({
    id: allowanceId,
    internId: intern.id,
    fields,
    userId: user?.id,
  });
  throwForOutcome(result);
  return withStatus(await db.findAllowanceById(allowanceId));
}

async function remove(rawInternId, rawAllowanceId) {
  const intern = await requireIntern(rawInternId);
  const allowanceId = parseId(rawAllowanceId, "ID khoản phụ cấp");
  if (!(await db.deleteAllowance(allowanceId, intern.id))) {
    throw new HttpError(404, "Không tìm thấy khoản phụ cấp!");
  }
  return { id: allowanceId };
}

async function overview(query = {}) {
  // Chỉ nhận q và university; normalizeInternFilters từ chối giá trị không phải chuỗi hoặc quá dài.
  const picked = {};
  for (const key of ["q", "university"]) {
    if (has(query, key)) picked[key] = query[key];
  }
  const filters = normalizeInternFilters(picked);
  const items = await db.listAllowanceOverview({
    filters,
    today: getVietnamToday(),
  });
  return {
    items,
    summary: {
      internCount: items.length,
      withAllowance: items.filter((i) => i.activeCount > 0).length,
      totalMonthly: items.reduce((sum, i) => sum + i.totalMonthly, 0),
    },
  };
}

// ---------- Thực tập sinh xem lịch sử phụ cấp của chính mình (chỉ đọc) ----------
const MY_ALLOWANCE_FILTERS = ["status", "type"];
const ALLOWANCE_STATUSES = ["ACTIVE", "UPCOMING", "EXPIRED"];

// Chỉ trả những trường thực tập sinh cần thấy; không lộ ID người nhập/sửa hay ID hồ sơ.
function toMyAllowance(allowance, today) {
  return {
    id: allowance.id,
    allowanceType: allowance.allowanceType,
    amount: allowance.amount,
    payCycle: allowance.payCycle,
    effectiveFrom: allowance.effectiveFrom,
    effectiveTo: allowance.effectiveTo,
    note: allowance.note,
    status: allowanceStatus(allowance, today),
    recordedAt: allowance.createdAt,
  };
}

function validateMyAllowanceQuery(query) {
  if (query == null || typeof query !== "object") return {};
  const unknown = Object.keys(query).filter(
    (key) => !MY_ALLOWANCE_FILTERS.includes(key),
  );
  if (unknown.length > 0) throw new HttpError(400, "Tham số lọc không hợp lệ!");
  const filters = {};
  if (has(query, "status")) {
    if (!ALLOWANCE_STATUSES.includes(query.status)) {
      throw new HttpError(
        400,
        `Trạng thái phải là một trong: ${ALLOWANCE_STATUSES.join(", ")}!`,
      );
    }
    filters.status = query.status;
  }
  if (has(query, "type")) {
    if (!ALLOWANCE_TYPES.includes(query.type)) {
      throw new HttpError(
        400,
        `Loại phụ cấp phải là một trong: ${ALLOWANCE_TYPES.join(", ")}!`,
      );
    }
    filters.type = query.type;
  }
  return filters;
}

// Hồ sơ được xác định theo email của tài khoản đang đăng nhập (giống nghỉ phép / hợp đồng của tôi),
// nên không có tham số ID nào để xem nhầm dữ liệu người khác. Bộ lọc chỉ áp dụng cho danh sách;
// phần tổng hợp luôn tính trên toàn bộ các khoản.
async function listMine(user, query = {}) {
  const filters = validateMyAllowanceQuery(query);
  const intern = await db.findInternProfileByEmail(user.email);
  if (!intern)
    throw new HttpError(404, "Tài khoản chưa có hồ sơ thực tập sinh!");
  const today = getVietnamToday();
  const all = (await db.listAllowancesByIntern(intern.id)).map((a) =>
    toMyAllowance(a, today),
  );
  const items = all.filter(
    (a) =>
      (!filters.status || a.status === filters.status) &&
      (!filters.type || a.allowanceType === filters.type),
  );
  return {
    intern: { fullName: intern.fullName, studentCode: intern.studentCode },
    items,
    summary: {
      ...summarizeAllowances(all, today),
      upcomingCount: all.filter((a) => a.status === "UPCOMING").length,
      expiredCount: all.filter((a) => a.status === "EXPIRED").length,
    },
  };
}

function withStatus(allowance) {
  return (
    allowance && {
      ...allowance,
      status: allowanceStatus(allowance, getVietnamToday()),
    }
  );
}

module.exports = {
  ALLOWANCE_TYPES,
  PAY_CYCLES,
  AMOUNT_MAX,
  NOTE_MAX_LENGTH,
  validateAllowanceFields,
  validateCombination,
  allowanceStatus,
  summarizeAllowances,
  isCoveredByContract,
  listForIntern,
  create,
  update,
  remove,
  overview,
  listMine,
  ALLOWANCE_STATUSES,
};
