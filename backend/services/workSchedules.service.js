// Lịch làm việc linh hoạt theo nhóm (US8): HR tạo/sửa/xóa ca làm việc cho từng nhóm theo thứ trong tuần.
// Giờ hợp lệ: HH:MM hoặc HH:MM:SS, giờ vào phải trước giờ ra (cùng ngày);
// cùng nhóm + cùng thứ không được có 2 ca chồng giờ.
const db = require("../db");
const { HttpError } = require("../errors");

const MAX_GROUP_NAME_LENGTH = 100;
const MAX_GRACE_MINUTES = 120;
const DAY_LABELS = {
  1: "Thứ Hai",
  2: "Thứ Ba",
  3: "Thứ Tư",
  4: "Thứ Năm",
  5: "Thứ Sáu",
  6: "Thứ Bảy",
  7: "Chủ nhật",
};

function parseId(raw) {
  if (!/^[1-9]\d*$/.test(String(raw)) || !Number.isSafeInteger(Number(raw))) {
    throw new HttpError(400, "Mã lịch làm việc phải là số nguyên dương!");
  }
  return Number(raw);
}

// "8:30" không hợp lệ (bắt buộc 2 chữ số); trả về HH:MM:SS hoặc null.
function normalizeTime(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(text)) return null;
  return text.length === 5 ? `${text}:00` : text;
}

function parseDayOfWeek(raw) {
  if (typeof raw === "boolean" || raw == null || raw === "") return null;
  if (!/^[1-7]$/.test(String(raw).trim())) return null;
  return Number(raw);
}

function validateSchedule(input) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "Dữ liệu lịch làm việc không hợp lệ!");
  }

  const groupName =
    typeof input.group_name === "string"
      ? input.group_name.trim().replace(/\s+/g, " ")
      : "";
  if (!groupName) throw new HttpError(400, "Vui lòng nhập tên nhóm!");
  if (Array.from(groupName).length > MAX_GROUP_NAME_LENGTH) {
    throw new HttpError(
      400,
      `Tên nhóm không được vượt quá ${MAX_GROUP_NAME_LENGTH} ký tự!`,
    );
  }

  const dayOfWeek = parseDayOfWeek(input.day_of_week);
  if (dayOfWeek == null) {
    throw new HttpError(
      400,
      "Ngày trong tuần phải là số từ 1 (Thứ Hai) đến 7 (Chủ nhật)!",
    );
  }

  const startTime = normalizeTime(input.start_time);
  const endTime = normalizeTime(input.end_time);
  if (!startTime || !endTime) {
    throw new HttpError(
      400,
      "Giờ vào/giờ ra phải đúng định dạng HH:MM (00:00 - 23:59)!",
    );
  }
  // So sánh chuỗi HH:MM:SS cùng độ dài là đủ; giờ ra bằng giờ vào cũng không hợp lệ.
  if (startTime >= endTime) {
    throw new HttpError(400, "Giờ ra phải sau giờ vào!");
  }

  let graceMinutes = input.grace_minutes;
  if (graceMinutes == null || graceMinutes === "") {
    graceMinutes = 0;
  } else if (
    typeof graceMinutes === "boolean" ||
    !/^\d+$/.test(String(graceMinutes).trim()) ||
    Number(graceMinutes) > MAX_GRACE_MINUTES
  ) {
    throw new HttpError(
      400,
      `Thời gian du di phải là số phút nguyên từ 0 đến ${MAX_GRACE_MINUTES}!`,
    );
  } else {
    graceMinutes = Number(graceMinutes);
  }

  return { groupName, dayOfWeek, startTime, endTime, graceMinutes };
}

function toDto(row) {
  return {
    id: Number(row.id),
    group_name: row.group_name,
    day_of_week: Number(row.day_of_week),
    day_label: DAY_LABELS[Number(row.day_of_week)] || null,
    start_time: String(row.start_time).slice(0, 5),
    end_time: String(row.end_time).slice(0, 5),
    grace_minutes: Number(row.grace_minutes),
    created_by: row.created_by == null ? null : Number(row.created_by),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function throwForOutcome(outcome, value) {
  if (outcome === "NOT_FOUND") {
    throw new HttpError(404, "Không tìm thấy lịch làm việc!");
  }
  if (outcome === "OVERLAP") {
    throw new HttpError(
      409,
      `Nhóm "${value.groupName}" đã có ca làm việc trùng giờ vào ${DAY_LABELS[value.dayOfWeek]}!`,
    );
  }
  if (outcome === "LOCK_TIMEOUT") {
    throw new HttpError(409, "Hệ thống đang bận, vui lòng thử lại!");
  }
}

async function list(query = {}) {
  let groupName;
  if (query.group_name != null && query.group_name !== "") {
    if (typeof query.group_name !== "string") {
      throw new HttpError(400, "Tên nhóm không hợp lệ!");
    }
    groupName = query.group_name.trim().replace(/\s+/g, " ");
  }

  let dayOfWeek;
  if (query.day_of_week != null && query.day_of_week !== "") {
    dayOfWeek = parseDayOfWeek(query.day_of_week);
    if (dayOfWeek == null) {
      throw new HttpError(400, "Ngày trong tuần phải là số từ 1 đến 7!");
    }
  }

  const rows = await db.listWorkSchedules({ groupName, dayOfWeek });
  return rows.map(toDto);
}

async function get(rawId) {
  const row = await db.findWorkScheduleById(parseId(rawId));
  if (!row) throw new HttpError(404, "Không tìm thấy lịch làm việc!");
  return toDto(row);
}

async function create(input, user) {
  const value = validateSchedule(input);
  const result = await db.saveWorkScheduleAtomic(value, {
    createdBy: user?.id ?? null,
  });
  throwForOutcome(result.outcome, value);
  return toDto(await db.findWorkScheduleById(result.id));
}

async function update(rawId, input) {
  const id = parseId(rawId);
  const value = validateSchedule(input);
  const result = await db.saveWorkScheduleAtomic(value, { id });
  throwForOutcome(result.outcome, value);
  return toDto(await db.findWorkScheduleById(result.id));
}

async function remove(rawId) {
  const deleted = await db.deleteWorkSchedule(parseId(rawId));
  if (!deleted) throw new HttpError(404, "Không tìm thấy lịch làm việc!");
}

module.exports = {
  DAY_LABELS,
  MAX_GRACE_MINUTES,
  normalizeTime,
  parseDayOfWeek,
  validateSchedule,
  toDto,
  list,
  get,
  create,
  update,
  remove,
};
