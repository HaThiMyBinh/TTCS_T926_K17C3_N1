function check(name, condition) {
  if (!condition) {
    console.error(`[FAIL] ${name}`);
    process.exitCode = 1;
  } else console.log(`[PASS] ${name}`);
}
const s = require("../services/finalReports.service");
const rows = [
  {
    internId: 1,
    fullName: "A",
    skillScore: 4,
    attitudeScore: 5,
    taskCount: 3,
    completedTaskCount: 2,
    weeklyReports: [],
  },
  {
    internId: 2,
    fullName: "B",
    skillScore: 2,
    attitudeScore: 3,
    taskCount: 0,
    completedTaskCount: 0,
    weeklyReports: [],
  },
  {
    internId: 3,
    fullName: "C",
    skillScore: null,
    attitudeScore: null,
    weeklyReports: [],
  },
];
const data = s.summarizeRows(rows, { today: "2026-10-09" });
check(
  "summary excludes unevaluated intern from average",
  data.summary.evaluated === 2 &&
    data.summary.notEvaluated === 1 &&
    data.summary.avgSkill === 3,
);
check("summary rounds overall average", data.summary.avgOverall === 3.5);
check(
  "empty averages are null",
  s.summarizeRows([]).summary.avgOverall === null,
);
const weekData = s.summarizeRows(
  [
    {
      internId: 4,
      fullName: "Weeks",
      startDate: "2026-09-28",
      endDate: null,
      skillScore: null,
      attitudeScore: null,
      weeklyReports: [
        { weekStart: "2026-09-28", isLate: 0 },
        { weekStart: "2026-10-05", isLate: 1 },
      ],
    },
  ],
  { today: "2026-10-09" },
);
check(
  "weekly report stats classify on-time and late reports",
  weekData.interns[0].weeklyReportStats.required === 2 &&
    weekData.interns[0].weeklyReportStats.onTime === 1 &&
    weekData.interns[0].weeklyReportStats.late === 1,
);
const missingWeek = s.summarizeRows(
  [
    {
      internId: 5,
      fullName: "Missing",
      startDate: "2026-09-28",
      skillScore: null,
      attitudeScore: null,
      weeklyReports: [],
    },
  ],
  { today: "2026-10-09" },
);
check(
  "weekly report stats separate missing and upcoming weeks",
  missingWeek.interns[0].weeklyReportStats.missing === 1 &&
    missingWeek.interns[0].weeklyReportStats.upcoming === 1,
);
check("unevaluated intern has no score", data.interns[2].overallScore === null);
check(
  "report validates scope and lengths",
  (() => {
    try {
      s.validateReportInput({ title: "Final", scope_type: "ALL" });
      return true;
    } catch {
      return false;
    }
  })(),
);
check(
  "report rejects unknown body field",
  (() => {
    try {
      s.validateReportInput({
        title: "x",
        scope_type: "ALL",
        email: "x",
      });
      return false;
    } catch (e) {
      return e.status === 400;
    }
  })(),
);
check(
  "report requires scope value",
  (() => {
    try {
      s.validateReportInput({ title: "x", scope_type: "PROGRAM" });
      return false;
    } catch (e) {
      return e.status === 400;
    }
  })(),
);
check(
  "preview rejects invalid date range",
  (() => {
    try {
      s.validatePreviewQuery({
        scope_type: "ALL",
        from: "2026-02-01",
        to: "2026-01-01",
      });
      return false;
    } catch (e) {
      return e.status === 400;
    }
  })(),
);
check(
  "csv injection neutralized and quoted",
  s.csvCell("=SUM(A1:A2)") === '"\'=SUM(A1:A2)"',
);
check(
  "csv escapes quotes and preserves Vietnamese",
  s.csvCell('Báo cáo, "đạt"') === '"Báo cáo, ""đạt"""',
);
check(
  "csv quotes embedded line breaks",
  s.csvCell("dòng một\ndòng hai") === '"dòng một\ndòng hai"',
);
check("csv export includes UTF-8 BOM", s.toCsv(data).charCodeAt(0) === 0xfeff);
check(
  "report rejects unknown scope",
  (() => {
    try {
      s.validateReportInput({ title: "x", scope_type: "OTHER" });
      return false;
    } catch (e) {
      return e.status === 400;
    }
  })(),
);
check(
  "summary totals work minutes",
  s.summarizeRows(
    [
      {
        internId: 9,
        fullName: "W",
        skillScore: null,
        attitudeScore: null,
        totalWorkMinutes: 90,
        weeklyReports: [],
      },
      {
        internId: 10,
        fullName: "X",
        skillScore: null,
        attitudeScore: null,
        totalWorkMinutes: 30,
        weeklyReports: [],
      },
    ],
    { today: "2026-10-09" },
  ).summary.totalWorkMinutes === 120,
);
check(
  "finalize body accepts empty and confirm flag",
  s.validateFinalizeBody(undefined).confirmIncomplete === false &&
    s.validateFinalizeBody({ confirm_incomplete: true }).confirmIncomplete ===
      true,
);
check(
  "finalize body rejects unknown field",
  (() => {
    try {
      s.validateFinalizeBody({ force: true });
      return false;
    } catch (e) {
      return e.status === 400;
    }
  })(),
);
check(
  "send body normalizes and dedupes recipients",
  (() => {
    const r = s.validateSendBody({
      recipients: [" A@x.edu.vn ", "a@x.edu.vn"],
      message: " hi ",
    });
    return (
      r.recipients.length === 1 &&
      r.recipients[0] === "a@x.edu.vn" &&
      r.message === "hi"
    );
  })(),
);
check(
  "send body rejects invalid email",
  (() => {
    try {
      s.validateSendBody({ recipients: ["not-an-email"] });
      return false;
    } catch (e) {
      return e.status === 400;
    }
  })(),
);
check(
  "send body rejects empty recipients",
  (() => {
    try {
      s.validateSendBody({ recipients: [] });
      return false;
    } catch (e) {
      return e.status === 400;
    }
  })(),
);
check(
  "send body limits recipients",
  (() => {
    try {
      s.validateSendBody({
        recipients: Array.from({ length: 11 }, (_, i) => `u${i}@x.vn`),
      });
      return false;
    } catch (e) {
      return e.status === 400;
    }
  })(),
);
check(
  "describeScope hiển thị nhãn dễ đọc",
  s.describeScope("ALL") === "Toàn bộ thực tập sinh" &&
    s.describeScope("UNIVERSITY", "ĐH Thái Nguyên") === "Trường: ĐH Thái Nguyên" &&
    s.describeScope("PROGRAM", "3", [{ id: 3, name: "Thực tập hè 2026" }]) ===
      "Chương trình: Thực tập hè 2026" &&
    s.describeScope("PROGRAM", "9", []) === "Chương trình: #9",
);
check(
  "parseRecipients chịu được dữ liệu hỏng",
  JSON.stringify(s.parseRecipients('["a@x.vn","b@x.vn"]')) ===
    '["a@x.vn","b@x.vn"]' &&
    s.parseRecipients("không phải json").length === 0 &&
    s.parseRecipients(null).length === 0 &&
    s.parseRecipients('{"a":1}').length === 0,
);
console.log("[PASS] final reports unit checks");
