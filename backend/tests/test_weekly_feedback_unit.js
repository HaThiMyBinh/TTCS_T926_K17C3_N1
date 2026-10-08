// Unit test phản hồi báo cáo tuần của mentor: không cần MySQL, dùng db giả trong bộ nhớ.
const assert = require("assert");

const lower = (v) => String(v).toLowerCase();
const mentors = [
  { id: 1, fullName: "Mentor Một", email: "m1@test.local" },
  { id: 2, fullName: "Mentor Hai", email: "m2@test.local" },
  { id: 3, fullName: "Mentor Ba", email: "m3@test.local" },
];
const interns = [
  {
    id: 10,
    fullName: "A",
    studentCode: "SV10",
    email: "a@test.local",
    mentorId: 1,
    createdAt: new Date("2026-09-16T10:00:00+07:00"),
  },
  {
    id: 11,
    fullName: "B",
    studentCode: "SV11",
    email: "b@test.local",
    mentorId: 2,
    createdAt: new Date("2026-09-16T10:00:00+07:00"),
  },
  {
    id: 12,
    fullName: "C (chưa có mentor)",
    studentCode: "SV12",
    email: "c@test.local",
    mentorId: null,
    createdAt: new Date("2026-09-16T10:00:00+07:00"),
  },
];

let reports = [];
let feedbacks = [];
let nextReportId = 1;
let nextFeedbackId = 1;
let clock = 0; // mỗi lần ghi tăng 1 giây để mốc thời gian luôn tăng dần
const tick = () => new Date(Date.UTC(2026, 9, 7, 3, 0, 0) + clock++ * 1000);

// Giống LEFT JOIN trong WEEKLY_REPORT_SELECT.
const joinReport = (r) => {
  const intern = interns.find((i) => i.id === r.internId);
  const f = feedbacks.find((x) => x.reportId === r.id);
  const m = f && mentors.find((x) => x.id === f.mentorId);
  return {
    ...r,
    internName: intern.fullName,
    studentCode: intern.studentCode,
    internMentorId: intern.mentorId,
    feedbackId: f ? f.id : null,
    feedbackContent: f ? f.content : null,
    feedbackMentorId: f ? f.mentorId : null,
    feedbackMentorName: m ? m.fullName : null,
    feedbackCreatedAt: f ? f.createdAt : null,
    feedbackUpdatedAt: f ? f.updatedAt : null,
  };
};

const addReport = (
  internId,
  weekStart,
  updatedAt = new Date("2026-10-07T09:00:00+07:00"),
) => {
  const row = {
    id: nextReportId++,
    internId,
    weekStart,
    content: "Nội dung",
    difficulties: null,
    nextPlan: null,
    isLate: 0,
    submittedAt: updatedAt,
    updatedAt,
  };
  reports.push(row);
  return row;
};

const fakeDb = {
  findMentorByEmail: async (e) =>
    mentors.find((m) => lower(m.email) === lower(e)) || null,
  findInternProfileByEmail: async (e) =>
    interns.find((i) => lower(i.email) === lower(e)) || null,
  findInternProfileById: async (id) => interns.find((i) => i.id === id) || null,
  findInternContractPeriod: async () => ({ startDate: null, endDate: null }),
  listInternsWithPeriodForMentor: async (mentorId) =>
    interns.filter((i) => i.mentorId === mentorId),
  findWeeklyReportById: async (id) => {
    const r = reports.find((x) => x.id === id);
    return r ? joinReport(r) : null;
  },
  listWeeklyReportsForIntern: async (internId) =>
    reports.filter((r) => r.internId === internId).map(joinReport),
  listWeeklyReportsForMentor: async (
    mentorId,
    { internId = null, weekStart = null } = {},
  ) =>
    reports
      .map(joinReport)
      .filter((r) => r.internMentorId === mentorId)
      .filter((r) => !internId || r.internId === internId)
      .filter((r) => !weekStart || r.weekStart === weekStart),
  listWeeklyReportAttachmentsByReportIds: async () => ({}),
  upsertWeeklyReportFeedback: async ({ reportId, mentorId, content }) => {
    const existing = feedbacks.find((f) => f.reportId === reportId);
    if (existing) {
      Object.assign(existing, { mentorId, content, updatedAt: tick() });
    } else {
      const now = tick();
      feedbacks.push({
        id: nextFeedbackId++,
        reportId,
        mentorId,
        content,
        createdAt: now,
        updatedAt: now,
      });
    }
    return joinReport(reports.find((r) => r.id === reportId));
  },
  deleteWeeklyReportFeedback: async (reportId) => {
    const before = feedbacks.length;
    feedbacks = feedbacks.filter((f) => f.reportId !== reportId);
    return before - feedbacks.length;
  },
};

const dbPath = require.resolve("../db");
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: fakeDb,
  children: [],
  paths: [],
};

const service = require("../services/weeklyReports.service");

const mentor1 = { email: "m1@test.local", role: "Mentor" };
const mentor2 = { email: "m2@test.local", role: "Mentor" };
const mentorNoProfile = { email: "ghost@test.local", role: "Mentor" };
const internA = { email: "a@test.local", role: "Intern" };
const TODAY = "2026-10-07"; // thứ Tư; tuần hiện tại bắt đầu 2026-10-05
const WEEK = "2026-10-05";

const is400 = (e) => e.status === 400;

async function rejects(promise, status, label) {
  try {
    await promise;
  } catch (err) {
    assert.strictEqual(
      err.status,
      status,
      `${label}: cần ${status}, nhận ${err.status} (${err.message})`,
    );
    return err;
  }
  assert.fail(`${label}: mong đợi lỗi HTTP ${status} nhưng không có lỗi`);
}

function testValidate() {
  const v = (input) => service.validateFeedbackInput(input);
  const bad = (input) => assert.throws(() => v(input), is400);

  assert.deepStrictEqual(v({ content: "  Làm tốt lắm  " }), {
    content: "Làm tốt lắm",
  });
  assert.strictEqual(service.FEEDBACK_MAX_LENGTH, 2000);
  assert.strictEqual(v({ content: "x".repeat(2000) }).content.length, 2000);
  // Trim trước khi đếm: 2000 ký tự + khoảng trắng hai đầu vẫn hợp lệ
  assert.strictEqual(
    v({ content: `  ${"x".repeat(2000)}  ` }).content.length,
    2000,
  );

  bad({ content: "x".repeat(2001) });
  bad({ content: "" });
  bad({ content: "   \n\t " });
  bad({ content: 123 });
  bad({ content: null });
  bad({ content: ["a"] });
  bad({}); // thiếu content
  bad(null);
  bad(undefined);
  bad("text");
  bad([]);
  bad({ content: "ok", mentor_id: 2 }); // trường lạ
  bad({ content: "ok", report_id: 1 });

  // Nội dung được lưu thuần văn bản, không bị biến đổi (escape thực hiện khi hiển thị)
  assert.strictEqual(
    v({ content: "<script>alert(1)</script>" }).content,
    "<script>alert(1)</script>",
  );
}

function testOutdated() {
  const f = service.isFeedbackOutdated;
  const d = (s) => new Date(`2026-10-07T${s}+07:00`);
  assert.strictEqual(f(d("10:00:05"), d("10:00:00")), true, "báo cáo sửa sau");
  assert.strictEqual(f(d("10:00:00"), d("10:00:00")), false, "cùng thời điểm");
  assert.strictEqual(f(d("09:00:00"), d("10:00:00")), false, "báo cáo cũ hơn");
  assert.strictEqual(
    f("2026-10-07 10:00:05", "2026-10-07 10:00:00"),
    true,
    "dạng chuỗi MySQL",
  );
  assert.strictEqual(f(null, d("10:00:00")), false, "thiếu mốc báo cáo");
  assert.strictEqual(f(d("10:00:00"), undefined), false, "thiếu mốc phản hồi");
  assert.strictEqual(f("rác", "rác"), false, "chuỗi không hợp lệ");
}

async function testSubmitAndUpdate() {
  const report = addReport(10, WEEK);

  // Chưa có phản hồi
  let mine = await service.listMyReports(internA);
  assert.strictEqual(mine[0].feedback, null);
  assert.strictEqual(mine[0].feedback_outdated, false);

  // Gửi lần đầu (có trim)
  const first = await service.submitFeedback(mentor1, String(report.id), {
    content: "  Cần bổ sung số liệu  ",
  });
  assert.strictEqual(first.id, report.id);
  assert.strictEqual(first.feedback.content, "Cần bổ sung số liệu");
  assert.strictEqual(first.feedback.mentor_name, "Mentor Một");
  assert.strictEqual(first.feedback_outdated, false);
  assert.strictEqual(feedbacks.length, 1);

  // Gửi lại: cập nhật, vẫn 1 bản ghi, giữ created_at
  const createdAt = feedbacks[0].createdAt;
  const second = await service.submitFeedback(mentor1, report.id + "", {
    content: "Đã tốt hơn",
  });
  assert.strictEqual(second.feedback.content, "Đã tốt hơn");
  assert.strictEqual(feedbacks.length, 1, "chỉ được 1 phản hồi / báo cáo");
  assert.strictEqual(feedbacks[0].createdAt, createdAt);

  // Intern thấy phản hồi (chỉ đọc) qua danh sách của mình
  mine = await service.listMyReports(internA);
  assert.strictEqual(mine[0].feedback.content, "Đã tốt hơn");
  assert.strictEqual(mine[0].feedback.mentor_name, "Mentor Một");

  // Mentor đọc được phản hồi trong danh sách báo cáo
  const listed = await service.listReportsForMentor(
    mentor1,
    {},
    { today: TODAY },
  );
  assert.strictEqual(listed[0].feedback.content, "Đã tốt hơn");

  // Intern sửa báo cáo sau khi được phản hồi -> feedback_outdated
  report.updatedAt = new Date("2099-01-01T00:00:00+07:00");
  const outdated = await service.listMyReports(internA);
  assert.strictEqual(outdated[0].feedback_outdated, true);
  const outdatedForMentor = await service.listReportsForMentor(
    mentor1,
    {},
    { today: TODAY },
  );
  assert.strictEqual(outdatedForMentor[0].feedback_outdated, true);

  // Mentor phản hồi lại -> hết lỗi thời
  report.updatedAt = new Date("2026-10-07T09:00:00+07:00");
  return report;
}

async function testPermissions(report) {
  // Mentor khác (không phụ trách) -> 403, không thay đổi dữ liệu
  const before = JSON.stringify(feedbacks);
  const err = await rejects(
    service.submitFeedback(mentor2, report.id, { content: "xâm nhập" }),
    403,
    "mentor khác ghi",
  );
  assert.ok(/phân công/.test(err.message));
  await rejects(
    service.deleteFeedback(mentor2, report.id),
    403,
    "mentor khác xóa",
  );
  assert.strictEqual(JSON.stringify(feedbacks), before, "dữ liệu không đổi");

  // Mentor chưa có hồ sơ -> 403
  await rejects(
    service.submitFeedback(mentorNoProfile, report.id, { content: "x" }),
    403,
    "mentor không có hồ sơ",
  );

  // Báo cáo của intern chưa có mentor -> không mentor nào phản hồi được
  const orphan = addReport(12, WEEK);
  await rejects(
    service.submitFeedback(mentor1, orphan.id, { content: "x" }),
    403,
    "intern chưa có mentor",
  );

  // id không hợp lệ -> 400; không tồn tại -> 404
  for (const bad of [
    "abc",
    "0",
    "-1",
    "1.5",
    "",
    "1; DROP TABLE x",
    undefined,
  ]) {
    await rejects(
      service.submitFeedback(mentor1, bad, { content: "x" }),
      400,
      `id sai: ${bad}`,
    );
  }
  await rejects(
    service.submitFeedback(mentor1, "99999", { content: "x" }),
    404,
    "báo cáo không tồn tại",
  );
  await rejects(
    service.deleteFeedback(mentor1, "99999"),
    404,
    "xóa báo cáo không tồn tại",
  );

  // Nội dung sai -> 400 (sau khi qua kiểm tra quyền)
  await rejects(
    service.submitFeedback(mentor1, report.id, { content: "  " }),
    400,
    "rỗng",
  );
  await rejects(
    service.submitFeedback(mentor1, report.id, { content: "x".repeat(2001) }),
    400,
    "quá dài",
  );
  assert.strictEqual(feedbacks.length, 1, "phản hồi lỗi không được ghi");
}

async function testOverview() {
  // Tuần này: A (mentor 1) có báo cáo + phản hồi; thêm intern khác mentor 1 chưa phản hồi
  const ov = await service.getMentorOverview(
    mentor1,
    { week_start: WEEK },
    { today: TODAY },
  );
  const rowA = ov.interns.find((r) => r.intern_id === 10);
  assert.strictEqual(rowA.has_feedback, true);
  assert.strictEqual(rowA.feedback_outdated, false);
  assert.strictEqual(ov.summary.feedback_pending, 0);

  // Mentor 2: B nộp báo cáo nhưng chưa được phản hồi -> feedback_pending = 1
  addReport(11, WEEK);
  const ov2 = await service.getMentorOverview(
    mentor2,
    { week_start: WEEK },
    { today: TODAY },
  );
  const rowB = ov2.interns.find((r) => r.intern_id === 11);
  assert.strictEqual(rowB.has_feedback, false);
  assert.strictEqual(ov2.summary.feedback_pending, 1);
  assert.strictEqual(ov2.summary.submitted, 1);

  // Sau khi phản hồi -> không còn chờ
  await service.submitFeedback(
    mentor2,
    reports.find((r) => r.internId === 11).id,
    {
      content: "OK",
    },
  );
  const ov3 = await service.getMentorOverview(
    mentor2,
    { week_start: WEEK },
    { today: TODAY },
  );
  assert.strictEqual(ov3.summary.feedback_pending, 0);
  assert.strictEqual(ov3.interns[0].has_feedback, true);

  // Intern chưa nộp báo cáo không tính vào feedback_pending
  feedbacks = feedbacks.filter(
    (f) => f.reportId !== reports.find((r) => r.internId === 11).id,
  );
  reports = reports.filter((r) => r.internId !== 11);
  const ov4 = await service.getMentorOverview(
    mentor2,
    { week_start: WEEK },
    { today: TODAY },
  );
  assert.strictEqual(ov4.interns[0].report_id, null);
  assert.strictEqual(ov4.summary.feedback_pending, 0);

  // Trạng thái các tuần của intern có has_feedback
  const status = await service.getMyStatus(internA, { today: TODAY });
  const w = status.weeks.find((x) => x.week_start === WEEK);
  assert.strictEqual(w.has_feedback, true);
}

async function testDelete(report) {
  const res = await service.deleteFeedback(mentor1, String(report.id));
  assert.strictEqual(res.feedback, null);
  assert.strictEqual(res.feedback_outdated, false);
  assert.strictEqual(
    feedbacks.filter((f) => f.reportId === report.id).length,
    0,
  );
  // Xóa lần hai -> 404
  await rejects(service.deleteFeedback(mentor1, report.id), 404, "xóa lần hai");
  // Báo cáo còn nguyên
  assert.ok(reports.some((r) => r.id === report.id));
}

(async () => {
  testValidate();
  testOutdated();
  const report = await testSubmitAndUpdate();
  await testPermissions(report);
  await testOverview();
  await testDelete(report);
  console.log("PASS test_weekly_feedback_unit");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
