const assert = require("assert");
const {
  MAX_PROGRAM_DURATION_DAYS,
  calculateProgramTime,
  getVietnamToday,
  toDto,
  validateProgram,
  validDate,
} = require("../services/programs.service");

const base = {
  name: "Internship",
  department_id: 1,
  status: "DRAFT",
};

function expectBadProgram(input, message) {
  assert.throws(() => validateProgram(input), new RegExp(message, "i"));
}

assert.equal(validDate("2024-02-29"), true);
assert.equal(validDate("2025-02-29"), false);
assert.equal(validDate("2024-02-30"), false);
assert.equal(getVietnamToday(new Date("2028-03-01T16:59:00Z")), "2028-03-01");
assert.equal(getVietnamToday(new Date("2028-03-01T17:00:00Z")), "2028-03-02");
expectBadProgram(
  { ...base, start_date: "2028-02-30", end_date: "2028-03-01" },
  "ngày phải",
);
expectBadProgram(
  { ...base, start_date: "2028-03-02", end_date: "2028-03-01" },
  "không được trước",
);

assert.equal(
  validateProgram({ ...base, start_date: "2028-03-01", end_date: "2028-03-01" }).endDate,
  "2028-03-01",
);
assert.equal(
  validateProgram({
    ...base,
    status: "OPEN",
    start_date: "2026-01-01",
    end_date: "2026-02-01",
  }).startDate,
  "2026-01-01",
  "Ngày trong quá khứ vẫn được chấp nhận",
);
expectBadProgram(
  { ...base, status: "OPEN", start_date: "2028-03-01" },
  "phải có đủ ngày",
);
expectBadProgram(
  { ...base, status: "ONGOING", end_date: "2028-03-01" },
  "phải có đủ ngày",
);
assert.equal(validateProgram(base).startDate, null);
assert.equal(validateProgram({ ...base, status: "CLOSED" }).endDate, null);

const start = "2028-01-01";
const maxEnd = new Date(Date.UTC(2028, 0, 1) + (MAX_PROGRAM_DURATION_DAYS - 1) * 86400000)
  .toISOString()
  .slice(0, 10);
assert.equal(
  validateProgram({ ...base, start_date: start, end_date: maxEnd }).endDate,
  maxEnd,
);
const tooLongEnd = new Date(Date.UTC(2028, 0, 1) + MAX_PROGRAM_DURATION_DAYS * 86400000)
  .toISOString()
  .slice(0, 10);
expectBadProgram(
  { ...base, start_date: start, end_date: tooLongEnd },
  "không được vượt quá",
);

assert.deepEqual(
  calculateProgramTime("2028-06-02", "2028-06-03", "2028-06-01"),
  { time_state: "UPCOMING", duration_days: 2, days_remaining: 2 },
);
assert.deepEqual(
  calculateProgramTime("2028-06-02", "2028-06-03", "2028-06-02"),
  { time_state: "RUNNING", duration_days: 2, days_remaining: 1 },
);
assert.deepEqual(
  calculateProgramTime("2028-06-02", "2028-06-03", "2028-06-03"),
  { time_state: "RUNNING", duration_days: 2, days_remaining: 0 },
);
assert.deepEqual(
  calculateProgramTime("2028-06-02", "2028-06-03", "2028-06-04"),
  { time_state: "ENDED", duration_days: 2, days_remaining: 0 },
);
assert.deepEqual(
  calculateProgramTime(null, null, "2028-06-02"),
  { time_state: "UNSCHEDULED", duration_days: null, days_remaining: null },
);
assert.equal(
  calculateProgramTime("2024-02-28", "2024-02-29", "2024-02-28").duration_days,
  2,
);
assert.deepEqual(
  toDto({ start_date: "2028-06-02", end_date: "2028-06-03" }, "2028-06-02"),
  {
    id: undefined,
    department_id: undefined,
    department_name: undefined,
    name: undefined,
    description: undefined,
    start_date: "2028-06-02",
    end_date: "2028-06-03",
    capacity: undefined,
    status: undefined,
    created_by: undefined,
    created_at: undefined,
    updated_at: undefined,
    time_state: "RUNNING",
    duration_days: 2,
    days_remaining: 1,
  },
);

console.log("PROGRAM DATES UNIT: validation, duration, time-state boundaries, leap year PASS");
