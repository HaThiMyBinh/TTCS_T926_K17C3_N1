const assert = require("assert");
const {
  MAX_CAPACITY,
  validateProgram,
  validDate,
  parseId,
  toDto,
} = require("../services/programs.service");

const baseProgram = {
  name: "Internship",
  department_id: "2",
  start_date: "2026-01-01",
  end_date: "2026-02-01",
  capacity: "4",
  status: "DRAFT",
};

function rejectsWithMessage(callback, messagePattern) {
  assert.throws(callback, messagePattern);
}

assert.equal(validDate("2024-02-29"), true);
assert.equal(validDate("2025-02-29"), false);
assert.equal(validDate("2025-2-01"), false);
assert.equal(validateProgram(baseProgram).capacity, 4);
assert.equal(validateProgram({ ...baseProgram, capacity: "" }).capacity, null);

rejectsWithMessage(
  () => validateProgram({ ...baseProgram, name: " " }),
  /tên chương trình/i,
);
rejectsWithMessage(
  () => validateProgram({ ...baseProgram, name: "x".repeat(256) }),
  /255/,
);
rejectsWithMessage(
  () => validateProgram({ ...baseProgram, description: "x".repeat(2001) }),
  /2000/,
);
rejectsWithMessage(
  () => validateProgram({ ...baseProgram, description: { unexpected: true } }),
  /Mô tả phải là văn bản/,
);
rejectsWithMessage(
  () => validateProgram({ ...baseProgram, start_date: "2025-02-30" }),
  /YYYY-MM-DD/,
);
rejectsWithMessage(
  () => validateProgram({ ...baseProgram, end_date: "2025-01-01" }),
  /Ngày kết thúc/,
);

for (const capacity of [0, -1, 1.5, "x", MAX_CAPACITY + 1]) {
  rejectsWithMessage(
    () => validateProgram({ ...baseProgram, capacity }),
    /Số lượng/i,
  );
}

rejectsWithMessage(
  () => validateProgram({ ...baseProgram, status: "INVALID" }),
  /Trạng thái/,
);
rejectsWithMessage(() => parseId("1abc"), /Mã/);

assert.deepEqual(
  toDto({
    id: 3,
    department_id: 2,
    department_name: "R&D",
    name: "N",
    description: null,
    start_date: null,
    end_date: null,
    capacity: null,
    status: "DRAFT",
    created_by: null,
    created_at: "now",
    updated_at: "now",
    private_field: "hidden",
  }),
  {
    id: 3,
    department_id: 2,
    department_name: "R&D",
    name: "N",
    description: null,
    start_date: null,
    end_date: null,
    capacity: null,
    status: "DRAFT",
    created_by: null,
    created_at: "now",
    updated_at: "now",
  },
);

console.log("PROGRAM UNIT: validation, ngày, capacity, status, độ dài, ID, DTO PASS");
