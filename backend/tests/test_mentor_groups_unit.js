// Kiểm tra mentorGroups (Nhóm của tôi - Mentor) bằng DB giả: không cần MySQL.
const assert = require("assert");
const db = require("../db");
db.getPool = () => ({
  query: async (sql, params) => {
    if (sql.includes("FROM group_members gm"))
      return [[
        { id: 1, name: "A", description: "", programId: 9, programName: "P", programStatus: "ONGOING", programStart: "2026-10-01", programEnd: "2026-12-31", internId: 5, internName: "An", internEmail: "an@x.vn", internPhone: null, studentCode: "S1", university: "U", major: "M", internStatus: "", isPrimary: 1, joinedAt: "2026-10-02 08:00:00" },
        { id: 2, name: "Cũ", description: "", programId: 8, programName: "Q", programStatus: "CLOSED", programStart: "2026-01-01", programEnd: "2026-03-01", internId: 5, internName: "An", internEmail: "an@x.vn", internPhone: null, studentCode: "S1", university: "U", major: "M", internStatus: "", isPrimary: 0, joinedAt: "2026-01-02 08:00:00" },
      ], []];
    if (sql.includes("FROM intern_tasks")) return [[{ internId: 5, total: 4, done: 1, percent: "37" }], []];
    if (sql.includes("FROM weekly_reports")) {
      assert.equal(params[1], "2026-10-19"); // thứ Hai của tuần chứa ngày 19/10/2026
      return [[{ internId: 5, isLate: 1 }], []];
    }
    if (sql.includes("FROM attendance_records")) return [[{ internId: 5, checkIn: "08:31", checkOut: null, correctionStatus: "PENDING" }], []];
    if (sql.includes("FROM meetings m")) {
      assert.ok(sql.includes("xp.mentor_id <> ?")); // chỉ lịch toàn thực tập sinh do mentor phụ trách
      return [params[0].length ? [{ id: 70, title: "Họp", location: null, meetingLink: null, status: "SCHEDULED", startAt: "2026-10-21 08:30:00", endAt: "2026-10-21 09:00:00" }] : [], []];
    }
    if (sql.includes("FROM meeting_attendees a JOIN")) return [[{ meetingId: 70, id: 5, fullName: "An" }], []];
    throw new Error("Truy vấn ngoài dự kiến: " + sql.slice(0, 50));
  },
});
(async () => {
  const groups = await require("../services/structure.service").mentorGroups(
    { id: 3, fullName: "Cô Lan" },
    new Date("2026-10-19T05:00:00Z"),
  );
  assert.equal(groups.length, 2);
  const [a, old] = groups;
  assert.equal(a.status, "ACTIVE");
  assert.equal(old.status, "ENDED");
  assert.equal(a.mentor.fullName, "Cô Lan");
  assert.equal(a.memberCount, 1);
  assert.equal(a.interns[0].weeklyReport.status, "LATE_SUBMITTED");
  assert.equal(a.interns[0].attendanceToday.status, "CHECKED_IN");
  assert.equal(a.interns[0].attendanceToday.correctionPending, true);
  assert.equal(a.interns[0].tasks.percent, 37);
  assert.equal(a.upcomingMeetings[0].state, "UPCOMING");
  console.log("[PASS] mentorGroups: tổng quan nhóm, tiến độ, lịch sắp tới");
})().catch((e) => { console.error(e); process.exit(1); });
