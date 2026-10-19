// Kiểm tra internGroups (Nhóm của tôi - Intern) bằng DB giả: không cần MySQL.
const assert = require("assert");
const db = require("../db");
db.getPool = () => ({
  query: async (sql, params) => {
    if (sql.includes("FROM group_members gm JOIN program_groups g"))
      return [[{ id: 1, name: "A", description: "mô tả", programId: 9, programName: "P", programStatus: "ONGOING", programStart: "2026-10-01", programEnd: "2026-12-31", isPrimary: 1, joinedAt: "2026-10-02 08:00:00" }], []];
    if (sql.includes("FROM mentors WHERE id")) {
      assert.ok(!/phone/.test(sql)); // không công khai số điện thoại mentor
      return [[{ id: 3, fullName: "Cô Lan", email: "lan@x.vn", department: "IT", specialization: "Node" }], []];
    }
    if (sql.includes("FROM group_support_mentors")) {
      assert.ok(!/phone/.test(sql));
      return [[{ groupId: 1, id: 4, fullName: "Thầy Nam", email: "nam@x.vn", department: "IT", specialization: "QA" }], []];
    }
    if (sql.includes("FROM group_members gm JOIN intern_profiles ip")) {
      assert.ok(!/email|phone/.test(sql.split("FROM")[0])); // thành viên khác chỉ lộ thông tin học tập cơ bản
      return [[{ groupId: 1, id: 5, fullName: "An", university: "U", major: "M", joinedAt: "2026-10-02 08:00:00" }, { groupId: 1, id: 6, fullName: "Bình", university: "U", major: "N", joinedAt: "2026-10-03 08:00:00" }], []];
    }
    if (sql.includes("FROM meetings m"))
      return [[{ id: 70, title: "Họp nhóm", location: "P1", meetingLink: null, organizerName: "Cô Lan", startAt: "2026-10-21 08:30:00", endAt: "2026-10-21 09:00:00" }], []];
    throw new Error("Truy vấn ngoài dự kiến: " + sql.slice(0, 50));
  },
});
(async () => {
  const [g] = await require("../services/structure.service").internGroups(
    { id: 5, mentorId: 3 },
    new Date("2026-10-19T05:00:00Z"),
  );
  assert.equal(g.status, "ACTIVE");
  assert.equal(g.isPrimary, true);
  assert.equal(g.memberCount, 2);
  assert.equal(g.members.find((m) => m.id === 5).isSelf, true);
  assert.equal(g.mentors.main.fullName, "Cô Lan");
  assert.equal(g.mentors.support[0].fullName, "Thầy Nam");
  assert.equal(g.upcomingMeetings[0].state, "UPCOMING");
  console.log("[PASS] internGroups: tổng quan, thành viên, mentor chính/hỗ trợ, lịch họp");
})().catch((e) => { console.error(e); process.exit(1); });
