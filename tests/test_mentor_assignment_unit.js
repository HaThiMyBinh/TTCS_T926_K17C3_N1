const assert = require("assert");
const {
  resolveUniqueMentorId,
} = require("../services/mentorAssignment.service");

const mentors = [
  { id: 11, fullName: "Nguyễn Văn An" },
  { id: 12, full_name: "Lê Hoàng Nam" },
];

const cases = [
  ["exact unique match", "Nguyễn Văn An", mentors, 11],
  ["case insensitive Vietnamese match", "nguyễn văn an", mentors, 11],
  ["trim leading/trailing whitespace", "  NGUYỄN VĂN AN  ", mentors, 11],
  ["supports database snake_case DTO", "lê hoàng nam", mentors, 12],
  ["no match", "Không có", mentors, null],
  ["empty name", "", mentors, null],
  ["whitespace-only name", "   ", mentors, null],
  ["null name", null, mentors, null],
  ["non-string name", 11, mentors, null],
  ["no candidates", "Nguyễn Văn An", [], null],
  ["invalid candidate list", "Nguyễn Văn An", null, null],
  [
    "duplicate case-insensitive names are ambiguous",
    "Nguyễn Văn An",
    [...mentors, { id: 13, fullName: "nguyễn văn an" }],
    null,
  ],
  [
    "duplicate trimmed names are ambiguous",
    "Lê Hoàng Nam",
    [...mentors, { id: 13, fullName: " Lê Hoàng Nam " }],
    null,
  ],
  [
    "invalid matched mentor id",
    "Nguyễn Văn An",
    [{ id: "NaN", fullName: "Nguyễn Văn An" }],
    null,
  ],
  [
    "missing matched mentor id",
    "Nguyễn Văn An",
    [{ fullName: "Nguyễn Văn An" }],
    null,
  ],
];

for (const [label, name, candidates, expected] of cases) {
  assert.strictEqual(resolveUniqueMentorId(name, candidates), expected, label);
}

console.log(
  `MENTOR ASSIGNMENT UNIT: ${cases.length} matching/ambiguity cases PASS`,
);
