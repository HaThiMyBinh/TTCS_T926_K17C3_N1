// Unit test báo cáo tuần: không cần MySQL, dùng db giả trong bộ nhớ.
const assert = require("assert");
const fs = require("fs");

const lower = (v) => String(v).toLowerCase();
const mentors = [
  { id: 1, email: "m1@test.local" },
  { id: 2, email: "m2@test.local" },
];
// A bắt đầu 16/09 (theo ngày tạo hồ sơ), B của mentor 2, C có hợp đồng từ 05/10.
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
    fullName: "C",
    studentCode: "SV12",
    email: "c@test.local",
    mentorId: 1,
    createdAt: new Date("2026-01-01T10:00:00+07:00"),
  },
];
const periods = { 12: { startDate: "2026-10-05", endDate: null } };

let reports = [];
let attachments = [];
let nextReportId = 1;
let nextAttachmentId = 1;
let failInsert = false;

const joinReport = (r) => {
  const intern = interns.find((i) => i.id === r.internId);
  return {
    ...r,
    internName: intern.fullName,
    studentCode: intern.studentCode,
    internMentorId: intern.mentorId,
  };
};

const fakeDb = {
  findMentorByEmail: async (e) =>
    mentors.find((m) => lower(m.email) === lower(e)) || null,
  findInternProfileByEmail: async (e) =>
    interns.find((i) => lower(i.email) === lower(e)) || null,
  findInternProfileById: async (id) => interns.find((i) => i.id === id) || null,
  findInternContractPeriod: async (id) =>
    periods[id] || { startDate: null, endDate: null },
  listInternsWithPeriodForMentor: async (mentorId) =>
    interns
      .filter((i) => i.mentorId === mentorId)
      .map((i) => ({ ...i, ...(periods[i.id] || {}) })),
  upsertWeeklyReport: async (data) => {
    const existing = reports.find(
      (r) => r.internId === data.internId && r.weekStart === data.weekStart,
    );
    if (existing) {
      // Giống SQL: nộp lại chỉ đổi nội dung, giữ is_late và submitted_at
      Object.assign(existing, {
        content: data.content,
        difficulties: data.difficulties,
        nextPlan: data.nextPlan,
      });
      return joinReport(existing);
    }
    const row = {
      id: nextReportId++,
      internId: data.internId,
      weekStart: data.weekStart,
      content: data.content,
      difficulties: data.difficulties,
      nextPlan: data.nextPlan,
      isLate: data.isLate ? 1 : 0,
      submittedAt: "2026-01-01 00:00:00",
      updatedAt: "2026-01-01 00:00:00",
    };
    reports.push(row);
    return joinReport(row);
  },
  findWeeklyReportById: async (id) => {
    const r = reports.find((x) => x.id === id);
    return r ? joinReport(r) : null;
  },
  listWeeklyReportsForIntern: async (internId) =>
    reports
      .filter((r) => r.internId === internId)
      .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))
      .map(joinReport),
  listWeeklyReportsForMentor: async (
    mentorId,
    { internId = null, weekStart = null } = {},
  ) =>
    reports
      .map(joinReport)
      .filter((r) => r.internMentorId === mentorId)
      .filter((r) => !internId || r.internId === internId)
      .filter((r) => !weekStart || r.weekStart === weekStart),
  listWeeklyReportAttachmentsByReportIds: async (ids) => {
    const out = {};
    for (const a of attachments) {
      if (ids.map(Number).includes(a.reportId))
        (out[a.reportId] ||= []).push(a);
    }
    return out;
  },
  findWeeklyReportAttachmentById: async (reportId, id) =>
    attachments.find((a) => a.id === id && a.reportId === reportId) || null,
  insertWeeklyReportAttachmentLimited: async (data, max) => {
    if (failInsert) throw new Error("db down");
    if (attachments.filter((a) => a.reportId === data.reportId).length >= max)
      return { outcome: "LIMIT" };
    const row = {
      id: nextAttachmentId++,
      reportId: data.reportId,
      originalName: data.originalName,
      storedName: data.storedName,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      uploadedAt: "2026-01-01 00:00:00",
    };
    attachments.push(row);
    return { outcome: "SAVED", attachment: row };
  },
  deleteWeeklyReportAttachment: async (reportId, id) => {
    const before = attachments.length;
    attachments = attachments.filter(
      (a) => !(a.id === id && a.reportId === reportId),
    );
    return before - attachments.length;
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
const storage = require("../services/fileStorage");
const path = require("path");

const internA = { email: "a@test.local", role: "Intern" };
const internB = { email: "b@test.local", role: "Intern" };
const internC = { email: "c@test.local", role: "Intern" };
const mentor1 = { email: "m1@test.local", role: "Mentor" };
const mentor2 = { email: "m2@test.local", role: "Mentor" };

const TODAY = "2026-10-07"; // thứ Tư; tuần hiện tại bắt đầu 2026-10-05
const is400 = (e) => e.status === 400;
const body = (extra = {}) => ({
  week_start: "2026-10-05",
  content: "  Đã hoàn thành trang đăng nhập  ",
  ...extra,
});

async function rejects(promise, status, label) {
  try {
    await promise;
  } catch (err) {
    assert.strictEqual(
      err.status,
      status,
      `${label}: cần ${status}, nhận ${err.status} (${err.message})`,
    );
    return;
  }
  assert.fail(`${label}: mong đợi lỗi HTTP ${status} nhưng không có lỗi`);
}

function testValidate() {
  const v = (input) => service.validateReportInput(input, { today: TODAY });
  const bad = (input) => assert.throws(() => v(input), is400);

  assert.deepStrictEqual(v(body()), {
    weekStart: "2026-10-05",
    content: "Đã hoàn thành trang đăng nhập",
    difficulties: null,
    nextPlan: null,
  });
  const full = v(body({ difficulties: " Thiếu API ", next_plan: " Nối API " }));
  assert.strictEqual(full.difficulties, "Thiếu API");
  assert.strictEqual(full.nextPlan, "Nối API");
  assert.strictEqual(v(body({ difficulties: "   " })).difficulties, null);
  assert.strictEqual(v(body({ next_plan: null })).nextPlan, null);

  bad(null);
  bad([]);
  bad({ content: "x" }); // thiếu week_start
  bad(body({ week_start: "2026-10-06" })); // không phải thứ Hai
  bad(body({ week_start: "2026-02-30" }));
  bad(body({ week_start: "05/10/2026" }));
  bad(body({ week_start: "2026-10-12" })); // tuần tương lai
  assert.strictEqual(
    v(body({ week_start: "2026-09-28" })).weekStart,
    "2026-09-28",
  );
  bad(body({ content: "" }));
  bad(body({ content: "   " }));
  bad(body({ content: 123 }));
  bad(body({ content: "x".repeat(5001) }));
  assert.strictEqual(
    v(body({ content: "x".repeat(5000) })).content.length,
    5000,
  );
  bad(body({ difficulties: "x".repeat(2001) }));
  bad(body({ next_plan: 5 }));
  bad(body({ is_late: true })); // không cho client tự gửi trường lạ
}

async function testSubmit() {
  const submit = (user, input, today = TODAY) =>
    service.submitMyReport(user, input, { today });

  // Đúng hạn
  const onTime = await submit(internA, body());
  assert.strictEqual(onTime.is_late, false);
  assert.strictEqual(onTime.week_start, "2026-10-05");
  assert.strictEqual(onTime.week_end, "2026-10-11");
  assert.strictEqual(onTime.deadline, "2026-10-11 23:59");
  assert.strictEqual(onTime.content, "Đã hoàn thành trang đăng nhập");

  // Nộp bù tuần trước -> trễ
  const late = await submit(internA, body({ week_start: "2026-09-28" }));
  assert.strictEqual(late.is_late, true);

  // Nộp lại cùng tuần: cập nhật bản cũ, không tạo thêm, không đổi nhãn trễ
  const edited = await submit(
    internA,
    body({ content: "Bản sửa", difficulties: "Khó" }),
    "2026-10-14",
  );
  assert.strictEqual(edited.id, onTime.id);
  assert.strictEqual(edited.content, "Bản sửa");
  assert.strictEqual(
    edited.is_late,
    false,
    "Sửa sau hạn không được đổi thành trễ",
  );
  assert.strictEqual(reports.filter((r) => r.internId === 10).length, 2);

  // Ranh giới: Chủ nhật 11/10 vẫn đúng hạn, thứ Hai 12/10 là trễ
  const sunday = await submit(
    internB,
    body({ week_start: "2026-10-05" }),
    "2026-10-11",
  );
  assert.strictEqual(sunday.is_late, false);
  const monday = await submit(
    internB,
    body({ week_start: "2026-09-28" }),
    "2026-10-12",
  );
  assert.strictEqual(monday.is_late, true);

  // Ngoài kỳ thực tập (C bắt đầu 05/10) và lỗi khác
  await rejects(
    submit(internC, body({ week_start: "2026-09-28" })),
    400,
    "trước kỳ thực tập",
  );
  await submit(internC, body());
  await rejects(
    submit(internA, body({ week_start: "2026-10-12" })),
    400,
    "tuần tương lai",
  );
  await rejects(submit(internA, body({ content: "" })), 400, "thiếu nội dung");
  await rejects(
    submit({ role: "Intern", email: "ghost@test.local" }, body()),
    404,
    "chưa có hồ sơ",
  );
  await rejects(submit({ role: "Intern" }, body()), 404, "token thiếu email");
}

async function testStatus() {
  const st = await service.getMyStatus(internA, { today: TODAY });
  assert.strictEqual(st.current_week_start, "2026-10-05");
  assert.strictEqual(st.period_start, "2026-09-16");
  assert.deepStrictEqual(
    st.weeks.map((w) => [w.week_start, w.status]),
    [
      ["2026-10-05", "SUBMITTED"],
      ["2026-09-28", "LATE_SUBMITTED"],
      ["2026-09-21", "MISSING"],
      ["2026-09-14", "MISSING"],
    ],
  );
  assert.deepStrictEqual(st.summary, {
    submitted: 1,
    late_submitted: 1,
    missing: 2,
    upcoming: 0,
  });
  assert.ok(st.weeks[0].report_id);
  assert.strictEqual(st.weeks[2].report_id, null);
  assert.strictEqual(st.weeks[0].deadline, "2026-10-11 23:59");

  // C vào tuần này, chưa nộp -> chưa đến hạn; tuần mới (sau Chủ nhật) chưa nộp -> thiếu
  reports = reports.filter((r) => r.internId !== 12);
  const early = await service.getMyStatus(internC, { today: TODAY });
  assert.deepStrictEqual(
    early.weeks.map((w) => w.status),
    ["UPCOMING"],
  );
  const later = await service.getMyStatus(internC, { today: "2026-10-14" });
  assert.deepStrictEqual(
    later.weeks.map((w) => [w.week_start, w.status]),
    [
      ["2026-10-12", "UPCOMING"],
      ["2026-10-05", "MISSING"],
    ],
  );
  await rejects(
    service.getMyStatus({ role: "Intern", email: "x@test.local" }),
    404,
    "chưa có hồ sơ",
  );
}

async function testMentor() {
  const overview = (user, query, today = TODAY) =>
    service.getMentorOverview(user, query, { today });
  const byId = (o) =>
    Object.fromEntries(o.interns.map((i) => [i.intern_id, i.status]));

  // Mentor 1 có A và C; không thấy B
  const cur = await overview(mentor1, {});
  assert.strictEqual(cur.week_start, "2026-10-05");
  assert.deepStrictEqual(byId(cur), { 10: "SUBMITTED", 12: "UPCOMING" });
  assert.strictEqual(cur.summary.total, 2);
  assert.strictEqual(cur.summary.submitted, 1);
  assert.strictEqual(cur.summary.upcoming, 1);

  // Tuần 28/09: A nộp trễ, C chưa vào kỳ thực tập nên không có trong bảng
  const prev = await overview(mentor1, { week_start: "2026-09-28" });
  assert.deepStrictEqual(byId(prev), { 10: "LATE_SUBMITTED" });

  // Tuần 21/09: A chưa nộp và đã quá hạn
  const missing = await overview(mentor1, { week_start: "2026-09-21" });
  assert.deepStrictEqual(byId(missing), { 10: "MISSING" });
  assert.strictEqual(missing.summary.missing, 1);

  // Mentor 2 chỉ thấy B
  const m2 = await overview(mentor2, {});
  assert.deepStrictEqual(Object.keys(byId(m2)), ["11"]);

  await rejects(
    overview(mentor1, { week_start: "2026-10-12" }),
    400,
    "tuần tương lai",
  );
  await rejects(
    overview(mentor1, { week_start: "2026-10-06" }),
    400,
    "không phải thứ Hai",
  );
  await rejects(overview(internA, {}), 403, "intern không phải mentor");
  await rejects(
    overview({ role: "Mentor", email: "ghost@test.local" }, {}),
    403,
    "chưa có hồ sơ mentor",
  );

  // Danh sách báo cáo (chỉ đọc)
  const list = (user, query) =>
    service.listReportsForMentor(user, query, { today: TODAY });
  const all = await list(mentor1, {});
  assert.ok(
    all.length >= 2 && all.every((r) => [10, 12].includes(r.intern_id)),
  );
  const ofA = await list(mentor1, { intern_id: "10" });
  assert.ok(ofA.every((r) => r.intern_id === 10));
  const week = await list(mentor1, { week_start: "2026-09-28" });
  assert.deepStrictEqual(
    week.map((r) => r.week_start),
    ["2026-09-28"],
  );
  await rejects(
    list(mentor2, { intern_id: "10" }),
    403,
    "intern của mentor khác",
  );
  await rejects(list(mentor1, { intern_id: "999" }), 404, "intern không có");
  await rejects(list(mentor1, { intern_id: "abc" }), 400, "id sai");
}

const diskFile = (name) => path.join(storage.UPLOADS_DIR, name);
const uploadsCount = () =>
  fs.readdirSync(storage.UPLOADS_DIR).filter((f) => f !== ".gitkeep").length;
const pdf = (name = "bao cao.pdf") => ({
  originalname: name,
  buffer: Buffer.from("%PDF-1.4 test"),
});

async function testAttachments() {
  const baseline = uploadsCount();
  const report = reports.find(
    (r) => r.internId === 10 && r.weekStart === "2026-10-05",
  );
  const id = String(report.id);

  const up = await service.uploadMyReportAttachment(internA, id, pdf());
  assert.strictEqual(up.attachment.original_name, "bao_cao.pdf");
  assert.strictEqual(up.attachment.stored_name, undefined);
  assert.strictEqual(up.report.attachments.length, 1);
  assert.ok(fs.existsSync(diskFile(attachments[0].storedName)));

  await rejects(
    service.uploadMyReportAttachment(internB, id, pdf()),
    403,
    "intern khác",
  );
  await rejects(
    service.uploadMyReportAttachment(internA, "999", pdf()),
    404,
    "báo cáo không có",
  );
  await rejects(
    service.uploadMyReportAttachment(internA, "abc", pdf()),
    400,
    "id sai",
  );
  await rejects(
    service.uploadMyReportAttachment(internA, id, undefined),
    400,
    "thiếu file",
  );
  await rejects(
    service.uploadMyReportAttachment(internA, id, {
      originalname: "a.pdf",
      buffer: Buffer.from("MZ.."),
    }),
    400,
    "exe đổi đuôi",
  );
  assert.strictEqual(
    uploadsCount(),
    baseline + 1,
    "Lỗi validate không được để lại file",
  );

  for (let i = 1; i < service.MAX_ATTACHMENTS_PER_REPORT; i++) {
    await service.uploadMyReportAttachment(internA, id, pdf(`f${i}.pdf`));
  }
  await rejects(
    service.uploadMyReportAttachment(internA, id, pdf("extra.pdf")),
    409,
    "quá 5 file",
  );
  assert.strictEqual(
    uploadsCount(),
    baseline + service.MAX_ATTACHMENTS_PER_REPORT,
  );

  failInsert = true;
  const origErr = console.error;
  console.error = () => {};
  await rejects(
    service.uploadMyReportAttachment(internA, id, pdf("x.pdf")),
    500,
    "db lỗi",
  );
  console.error = origErr;
  failInsert = false;
  assert.strictEqual(
    uploadsCount(),
    baseline + service.MAX_ATTACHMENTS_PER_REPORT,
  );

  // Tải xuống: chủ báo cáo và mentor phụ trách
  const first = attachments[0];
  const dl = (user, aid = String(first.id)) =>
    service.getReportAttachmentForDownload(user, id, aid);
  assert.strictEqual((await dl(internA)).mimeType, "application/pdf");
  assert.ok(fs.existsSync((await dl(mentor1)).filePath));
  await rejects(dl(mentor2), 403, "mentor khác");
  await rejects(dl(internB), 403, "intern khác");
  await rejects(dl(internA, "999"), 404, "file không có");

  // Xóa: chỉ chủ báo cáo; file vật lý bị xóa
  const stored = first.storedName;
  await rejects(
    service.deleteMyReportAttachment(internB, id, String(first.id)),
    403,
    "xóa intern khác",
  );
  await rejects(
    service.deleteMyReportAttachment(internA, id, "999"),
    404,
    "xóa không có",
  );
  const del = await service.deleteMyReportAttachment(
    internA,
    id,
    String(first.id),
  );
  assert.strictEqual(
    del.report.attachments.length,
    service.MAX_ATTACHMENTS_PER_REPORT - 1,
  );
  assert.ok(!fs.existsSync(diskFile(stored)), "File vật lý phải bị xóa");

  // Dọn file còn lại
  for (const a of attachments) storage.removeFile(a.storedName);
  assert.strictEqual(uploadsCount(), baseline);
}

(async () => {
  testValidate();
  await testSubmit();
  await testStatus();
  await testMentor();
  await testAttachments();
  console.log("PASS test_weekly_reports_unit");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
