const db = require("../db");
const { HttpError } = require("../errors");
const { getVietnamToday } = require("../utils/date");

const STATUSES = ["DRAFT", "OPEN", "ONGOING", "CLOSED"];
const MAX_CAPACITY = 2147483647;
const MAX_PROGRAM_DURATION_DAYS = 730;
const TIME_STATES = ["UPCOMING", "RUNNING", "ENDED", "UNSCHEDULED"];

function dateOrdinal(value) {
  if (!validDate(value) || value == null || value === "") return null;
  return Math.floor(Date.parse(`${value}T00:00:00Z`) / 86400000);
}

function calculateProgramTime(startDate, endDate, today) {
  if (!startDate || !endDate) {
    return {
      time_state: "UNSCHEDULED",
      duration_days: null,
      days_remaining: null,
    };
  }

  const start = dateOrdinal(startDate);
  const end = dateOrdinal(endDate);
  const current = dateOrdinal(today);
  if (current == null)
    throw new TypeError("Hôm nay phải là ngày hợp lệ YYYY-MM-DD");
  const durationDays = end - start + 1;
  let timeState = "RUNNING";

  if (current < start) timeState = "UPCOMING";
  else if (current > end) timeState = "ENDED";

  return {
    time_state: timeState,
    duration_days: durationDays,
    days_remaining: Math.max(0, end - current),
  };
}

function textLength(value) {
  return Array.from(value).length;
}

function parseId(raw) {
  if (!/^[1-9]\d*$/.test(String(raw))) {
    throw new HttpError(400, "Mã phải là số nguyên dương!");
  }

  const id = Number(raw);
  if (!Number.isSafeInteger(id)) {
    throw new HttpError(400, "Mã phải là số nguyên dương!");
  }
  return id;
}

function validDate(value) {
  if (value == null || value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function validateProgram(input = {}) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "Dữ liệu chương trình không hợp lệ!");
  }

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new HttpError(400, "Vui lòng nhập tên chương trình!");
  if (textLength(name) > 255) {
    throw new HttpError(400, "Tên chương trình không được vượt quá 255 ký tự!");
  }

  const departmentId = Number(input.department_id);
  if (!Number.isSafeInteger(departmentId) || departmentId < 1) {
    throw new HttpError(400, "Vui lòng chọn phòng ban hợp lệ!");
  }

  if (input.description != null && typeof input.description !== "string") {
    throw new HttpError(400, "Mô tả phải là văn bản!");
  }
  const description = input.description || "";
  if (textLength(description) > 2000) {
    throw new HttpError(400, "Mô tả không được vượt quá 2000 ký tự!");
  }

  const startDate =
    input.start_date == null || input.start_date === ""
      ? null
      : input.start_date;
  const endDate =
    input.end_date == null || input.end_date === "" ? null : input.end_date;
  if (!validDate(startDate) || !validDate(endDate)) {
    throw new HttpError(
      400,
      "Ngày phải đúng định dạng YYYY-MM-DD và là ngày có thật!",
    );
  }
  if (startDate && endDate && endDate < startDate) {
    throw new HttpError(400, "Ngày kết thúc không được trước ngày bắt đầu!");
  }

  let capacity = input.capacity;
  if (capacity === "" || capacity == null) {
    capacity = null;
  } else if (
    !/^[1-9]\d*$/.test(String(capacity)) ||
    !Number.isSafeInteger(Number(capacity)) ||
    Number(capacity) > MAX_CAPACITY
  ) {
    throw new HttpError(400, "Số lượng phải là số nguyên từ 1 trở lên!");
  }

  const status =
    input.status == null || input.status === "" ? "DRAFT" : input.status;
  if (!STATUSES.includes(status)) {
    throw new HttpError(400, "Trạng thái chương trình không hợp lệ!");
  }
  if ((status === "OPEN" || status === "ONGOING") && (!startDate || !endDate)) {
    throw new HttpError(
      400,
      "Chương trình OPEN hoặc ONGOING phải có đủ ngày bắt đầu và kết thúc!",
    );
  }
  if (startDate && endDate) {
    const durationDays = dateOrdinal(endDate) - dateOrdinal(startDate) + 1;
    if (durationDays > MAX_PROGRAM_DURATION_DAYS) {
      throw new HttpError(
        400,
        `Thời lượng chương trình không được vượt quá ${MAX_PROGRAM_DURATION_DAYS} ngày!`,
      );
    }
  }

  return {
    departmentId,
    name,
    description,
    startDate,
    endDate,
    capacity: capacity == null ? null : Number(capacity),
    status,
  };
}

// API callers pass today's VN date to include calculated time fields. The
// default keeps the pre-existing DTO shape for legacy direct service callers.
function toDto(row, today = null) {
  if (!row) return null;
  const dto = {
    id: row.id,
    department_id: row.department_id,
    department_name: row.department_name,
    name: row.name,
    description: row.description,
    start_date: row.start_date,
    end_date: row.end_date,
    capacity: row.capacity,
    status: row.status,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  return today == null
    ? dto
    : { ...dto, ...calculateProgramTime(row.start_date, row.end_date, today) };
}

async function departments() {
  return db.listDepartments();
}

async function addDepartment(input = {}) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new HttpError(400, "Vui lòng nhập tên phòng ban!");
  if (textLength(name) > 150) {
    throw new HttpError(400, "Tên phòng ban không được vượt quá 150 ký tự!");
  }

  if (input.description != null && typeof input.description !== "string") {
    throw new HttpError(400, "Mô tả phòng ban phải là văn bản!");
  }
  const description = input.description || "";
  if (textLength(description) > 2000) {
    throw new HttpError(400, "Mô tả phòng ban không được vượt quá 2000 ký tự!");
  }

  if (await db.findDepartmentByName(name)) {
    throw new HttpError(409, "Phòng ban đã tồn tại!");
  }

  try {
    return await db.insertDepartment({ name, description });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      throw new HttpError(409, "Phòng ban đã tồn tại!");
    }
    throw err;
  }
}

async function removeDepartment(rawId) {
  const result = await db.deleteDepartment(parseId(rawId));
  if (result === "NOT_FOUND")
    throw new HttpError(404, "Không tìm thấy phòng ban!");
  if (result === "IN_USE") {
    throw new HttpError(
      409,
      "Không thể xóa phòng ban đã có chương trình thực tập!",
    );
  }
}

async function list(query = {}) {
  const filters = {};
  if (query.department_id != null && query.department_id !== "") {
    filters.departmentId = parseId(query.department_id);
  }
  if (query.status != null && query.status !== "") {
    if (!STATUSES.includes(query.status)) {
      throw new HttpError(400, "Trạng thái chương trình không hợp lệ!");
    }
    filters.status = query.status;
  }
  if (query.time_state != null && query.time_state !== "") {
    if (!TIME_STATES.includes(query.time_state)) {
      throw new HttpError(400, "Trạng thái thời gian không hợp lệ!");
    }
    filters.timeState = query.time_state;
  }

  const today = getVietnamToday();
  const programs = (await db.listPrograms(filters)).map((row) =>
    toDto(row, today),
  );
  return filters.timeState
    ? programs.filter((program) => program.time_state === filters.timeState)
    : programs;
}

async function get(rawId) {
  const row = await db.findProgramById(parseId(rawId));
  if (!row) throw new HttpError(404, "Không tìm thấy chương trình thực tập!");
  return toDto(row, getVietnamToday());
}

function throwSaveError(outcome) {
  if (outcome === "DUPLICATE") {
    throw new HttpError(
      409,
      "Chương trình trùng tên trong phòng ban và khoảng ngày này!",
    );
  }
  if (outcome === "LOCK_TIMEOUT") {
    throw new HttpError(
      409,
      "Chương trình đang được cập nhật, vui lòng thử lại!",
    );
  }
  if (outcome === "NOT_FOUND") {
    throw new HttpError(404, "Không tìm thấy chương trình thực tập!");
  }
}

async function create(input, user) {
  const values = validateProgram(input);
  if (!(await db.findDepartmentById(values.departmentId))) {
    throw new HttpError(404, "Phòng ban không tồn tại!");
  }

  const result = await db.saveProgramAtomic(values, {
    createdBy: user?.id || null,
  });
  throwSaveError(result.outcome);
  return get(result.id);
}

async function update(rawId, input) {
  const id = parseId(rawId);
  let updateInput = input;
  if (input != null && typeof input === "object" && !Array.isArray(input)) {
    const existing = await db.findProgramById(id);
    updateInput = { ...input };
    if (!Object.prototype.hasOwnProperty.call(input, "start_date")) {
      updateInput.start_date = existing?.start_date ?? null;
    }
    if (!Object.prototype.hasOwnProperty.call(input, "end_date")) {
      updateInput.end_date = existing?.end_date ?? null;
    }
  }
  const values = validateProgram(updateInput);
  if (!(await db.findDepartmentById(values.departmentId))) {
    throw new HttpError(404, "Phòng ban không tồn tại!");
  }

  // Không cho thu hẹp khoảng ngày làm các hợp đồng đang gắn với chương trình nằm ngoài khoảng mới.
  const outside = await db.countContractsOutsideProgramRange(
    id,
    values.startDate,
    values.endDate,
  );
  if (outside > 0) {
    throw new HttpError(
      409,
      `Không thể đổi khoảng ngày vì có ${outside} hợp đồng gắn với chương trình này nằm ngoài khoảng mới!`,
    );
  }

  const result = await db.saveProgramAtomic(values, { id });
  throwSaveError(result.outcome);
  return get(result.id);
}

async function remove(rawId) {
  const result = await db.deleteProgram(parseId(rawId));
  if (result === "NOT_FOUND") {
    throw new HttpError(404, "Không tìm thấy chương trình thực tập!");
  }
  if (result === "ONGOING") {
    throw new HttpError(409, "Không thể xóa chương trình đang diễn ra!");
  }
}

module.exports = {
  STATUSES,
  MAX_CAPACITY,
  MAX_PROGRAM_DURATION_DAYS,
  TIME_STATES,
  parseId,
  validDate,
  dateOrdinal,
  getVietnamToday,
  calculateProgramTime,
  validateProgram,
  toDto,
  departments,
  addDepartment,
  removeDepartment,
  list,
  get,
  create,
  update,
  remove,
};
