const models = require("../services/export/reportModels");
const completion = require("../services/completionRate.service");
const origin = require("../services/internOriginReport.service");
const now = new Date("2026-10-16T18:30:00.000Z");
const name = `O'Brien <script>alert(1)</script> & "Đại học"`;
function fixtures() {
  const c = completion.buildReport([
    {
      id: 1,
      programId: 1,
      programName: name,
      mentorName: "Mentor",
      status: "Hoàn thành",
    },
    {
      id: 2,
      programId: 1,
      programName: name,
      mentorName: "Mentor",
      status: "Đang thực tập",
    },
    {
      id: 3,
      programId: 1,
      programName: name,
      mentorName: "Mentor",
      status: "Tạm dừng",
    },
  ]);
  const o = origin.buildOriginReport(
    [{ university: name, major: "CNTT", count: 3 }],
    { funnelRows: [] },
  );
  const a = {
    summary: {
      totalInterns: 1,
      requiredDays: 3,
      presentDays: 1,
      leaveDays: 0,
      totalWorkMinutes: 120,
      attendanceRate: 33.3,
    },
    groups: [],
    interns: [
      {
        intern: {
          fullName: name,
          studentCode: "00009",
          university: "Đại học Y",
          major: "CNTT",
        },
        requiredDays: 3,
        presentDays: 1,
        leaveDays: 0,
        totalWorkMinutes: 120,
        attendanceRate: 33.3,
      },
    ],
  };
  const f = {
    id: 7,
    title: "Báo cáo cuối kỳ",
    status: "FINALIZED",
    scopeType: "ALL",
    password_hash: "PRIVATE_HASH",
    token: "PRIVATE_TOKEN",
    data: {
      summary: {
        totalInterns: 1,
        evaluated: 1,
        notEvaluated: 0,
        avgSkill: 4,
        avgAttitude: 5,
        avgOverall: 4.5,
      },
      interns: [
        {
          fullName: name,
          studentCode: "00009",
          startDate: "2026-01-02",
          endDate: null,
          evaluated: true,
          skillScore: 4,
          attitudeScore: 5,
          overallScore: 4.5,
          weeklyReportStats: { required: 3, onTime: 2, late: 1, missing: 0 },
          taskStats: { total: 2, done: 1 },
          totalWorkMinutes: 120,
          filePath: "/PRIVATE_PATH",
        },
      ],
    },
  };
  return {
    completion: models.completion(c, { q: name, from: "2026-01-01" }, now),
    origin: models.origin(o, { groupBy: "both" }, now),
    attendance: models.attendance(
      a,
      { from: "2026-01-01", to: "2026-01-31" },
      now,
    ),
    final: models.finalReport(f, now),
  };
}
module.exports = { fixtures, name, now };
