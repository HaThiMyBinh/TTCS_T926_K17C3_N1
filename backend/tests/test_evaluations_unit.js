// Unit test đánh giá tổng kết thực tập sinh của mentor: không cần MySQL, dùng db giả trong bộ nhớ.
const assert = require("assert");

const lower = (v) => String(v).toLowerCase();
const mentors = [
  { id: 1, fullName: "Mentor Một", email: "m1@test.local" },
  { id: 2, fullName: "Mentor Hai", email: "m2@test.local" },
];
const interns = [
  { id: 10, fullName: "A", studentCode: "SV10", mentorId: 1 },
  { id: 11, fullName: "B", studentCode: "SV11", mentorId: 2 },
  { id: 12, fullName: "C (chưa có mentor)", studentCode: "SV12", mentorId: null },
  { id: 13, fullName: "D", studentCode: "SV13", mentorId: 1 },
];

let evaluations = [];
let nextId = 1;
let clock = 0;
const tick = () => new Date(Date.UTC(2026, 9, 7, 3, 0, 0) + clock++ * 1000);

// Giống EVALUATION_SELECT trong db.js.
const joinEval = (e) => {
  const intern = interns.find((i) => i.id === e.internId);
  const m = mentors.find((x) => x.id === e.mentorId);
  return {
    ...e,
    internName: intern.fullName,
    studentCode: intern.studentCode,
    internMentorId: intern.mentorId,
    mentorName: m ? m.fullName : null,
  };
};

// Thực tập sinh nằm trong tập này thì coi như CHƯA có hợp đồng được xác nhận.
const noContract = new Set();

const fakeDb = {
  hasConfirmedContract: async (id) => !noContract.has(id),
  findMentorByEmail: async (e) =>
    mentors.find((m) => lower(m.email) === lower(e)) || null,
  findInternProfileById: async (id) => interns.find((i) => i.id === id) || null,
  findInternEvaluation: async (internId) => {
    const e = evaluations.find((x) => x.internId === internId);
    return e ? joinEval(e) : null;
  },
  upsertInternEvaluation: async ({ internId, mentorId, ...rest }) => {
    const existing = evaluations.find((x) => x.internId === internId);
    if (existing) {
      Object.assign(existing, { mentorId, ...rest, updatedAt: tick() });
    } else {
      const now = tick();
      evaluations.push({
        id: nextId++,
        internId,
        mentorId,
        ...rest,
        createdAt: now,
        updatedAt: now,
      });
    }
    return joinEval(evaluations.find((x) => x.internId === internId));
  },
  deleteInternEvaluation: async (internId) => {
    const before = evaluations.length;
    evaluations = evaluations.filter((x) => x.internId !== internId);
    return before - evaluations.length;
  },
  listEvaluationsForMentor: async (mentorId) =>
    interns
      .filter((i) => i.mentorId === mentorId)
      .map((i) => {
        const e = evaluations.find((x) => x.internId === i.id);
        return {
          internId: i.id,
          internName: i.fullName,
          studentCode: i.studentCode,
          evaluationId: e ? e.id : null,
          skillScore: e ? e.skillScore : null,
          attitudeScore: e ? e.attitudeScore : null,
          updatedAt: e ? e.updatedAt : null,
        };
      }),
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

const service = require("../services/evaluations.service");

const mentor1 = { email: "m1@test.local", role: "Mentor" };
const mentor2 = { email: "m2@test.local", role: "Mentor" };
const mentorNoProfile = { email: "ghost@test.local", role: "Mentor" };
const internUser = { email: "a@test.local", role: "Intern" };

const is400 = (e) => e.status === 400;
const valid = {
  skill_score: 4,
  skill_comment: "Code sạch",
  attitude_score: 5,
  attitude_comment: "Chủ động",
  overall_comment: "Hoàn thành tốt kỳ thực tập",
};

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
  const v = (input) => service.validateEvaluationInput(input);
  const bad = (input) => assert.throws(() => v(input), is400);

  assert.deepStrictEqual(
    v({
      skill_score: 4,
      skill_comment: "  Tốt  ",
      attitude_score: 5,
      overall_comment: "  Ổn  ",
    }),
    {
      skillScore: 4,
      skillComment: "Tốt",
      attitudeScore: 5,
      attitudeComment: null,
      overallComment: "Ổn",
    },
  );
  // Biên điểm 1 và 5 hợp lệ
  assert.strictEqual(v({ ...valid, skill_score: 1 }).skillScore, 1);
  assert.strictEqual(v({ ...valid, attitude_score: 5 }).attitudeScore, 5);
  // Nhận xét tùy chọn: rỗng / null -> null
  assert.strictEqual(v({ ...valid, skill_comment: "   " }).skillComment, null);
  assert.strictEqual(v({ ...valid, attitude_comment: null }).attitudeComment, null);
  // Biên độ dài 2000 (đã trim) hợp lệ, 2001 thì không
  assert.strictEqual(
    v({ ...valid, overall_comment: `  ${"x".repeat(2000)}  ` }).overallComment
      .length,
    2000,
  );
  bad({ ...valid, overall_comment: "x".repeat(2001) });
  bad({ ...valid, skill_comment: "x".repeat(2001) });
  bad({ ...valid, attitude_comment: "x".repeat(2001) });

  // Điểm sai
  bad({ ...valid, skill_score: 0 });
  bad({ ...valid, skill_score: 6 });
  bad({ ...valid, skill_score: -1 });
  bad({ ...valid, skill_score: 4.5 });
  bad({ ...valid, skill_score: "4" });
  bad({ ...valid, skill_score: true });
  bad({ ...valid, skill_score: null });
  bad({ ...valid, attitude_score: 0 });
  bad({ ...valid, attitude_score: 6 });
  bad({ ...valid, attitude_score: "5" });
  bad({ ...valid, attitude_score: NaN });
  const { skill_score, ...noSkill } = valid;
  bad(noSkill);
  const { attitude_score, ...noAttitude } = valid;
  bad(noAttitude);

  // Nhận xét tổng kết bắt buộc
  bad({ ...valid, overall_comment: "" });
  bad({ ...valid, overall_comment: "  \n " });
  bad({ ...valid, overall_comment: null });
  bad({ ...valid, overall_comment: 123 });
  const { overall_comment, ...noOverall } = valid;
  bad(noOverall);
  bad({ ...valid, skill_comment: 123 });

  // Body sai kiểu / trường lạ
  bad(null);
  bad(undefined);
  bad("text");
  bad([]);
  bad({ ...valid, overall_score: 5 }); // điểm tổng do server tính
  bad({ ...valid, mentor_id: 2 });
  bad({ ...valid, intern_id: 11 });

  // Lưu thuần văn bản, không biến đổi (escape khi hiển thị)
  assert.strictEqual(
    v({ ...valid, overall_comment: "<script>alert(1)</script>" }).overallComment,
    "<script>alert(1)</script>",
  );
}

function testOverallScore() {
  const c = service.computeOverallScore;
  assert.strictEqual(c(4, 5), 4.5);
  assert.strictEqual(c(5, 5), 5);
  assert.strictEqual(c(1, 1), 1);
  assert.strictEqual(c(3, 4), 3.5);
  assert.strictEqual(c(1, 2), 1.5);
  assert.strictEqual(c("4", "3"), 3.5);
}

async function testSaveAndUpdate() {
  const created = await service.saveEvaluation(mentor1, "10", valid);
  assert.strictEqual(created.intern_id, 10);
  assert.strictEqual(created.skill_score, 4);
  assert.strictEqual(created.attitude_score, 5);
  assert.strictEqual(created.overall_score, 4.5);
  assert.strictEqual(created.mentor_name, "Mentor Một");
  assert.strictEqual(created.overall_comment, "Hoàn thành tốt kỳ thực tập");
  assert.strictEqual(created.skill_comment, "Code sạch");

  // Lấy lại
  const got = await service.getEvaluation(mentor1, 10);
  assert.strictEqual(got.overall_score, 4.5);

  // Gửi lại = cập nhật, vẫn chỉ 1 bản ghi
  const updated = await service.saveEvaluation(mentor1, 10, {
    skill_score: 2,
    attitude_score: 3,
    overall_comment: "Cần cố gắng thêm",
  });
  assert.strictEqual(updated.overall_score, 2.5);
  assert.strictEqual(updated.skill_comment, ""); // bỏ nhận xét -> rỗng
  assert.strictEqual(evaluations.filter((e) => e.internId === 10).length, 1);

  // Chưa có đánh giá -> null (không lỗi)
  assert.strictEqual(await service.getEvaluation(mentor1, 13), null);
}

async function testNeedsConfirmedContract() {
  noContract.add(13);
  try {
    await rejects(
      service.saveEvaluation(mentor1, 13, valid),
      409,
      "đánh giá khi chưa có hợp đồng xác nhận",
    );
    assert.strictEqual(evaluations.filter((e) => e.internId === 13).length, 0);
    // Xem / xóa không bị chặn bởi điều kiện hợp đồng
    assert.strictEqual(await service.getEvaluation(mentor1, 13), null);
  } finally {
    noContract.delete(13);
  }
}

async function testPermissions() {
  // Mentor khác -> 403, dữ liệu không đổi
  const before = JSON.stringify(evaluations);
  await rejects(service.saveEvaluation(mentor2, 10, valid), 403, "mentor khác ghi");
  await rejects(service.getEvaluation(mentor2, 10), 403, "mentor khác đọc");
  await rejects(service.deleteEvaluation(mentor2, 10), 403, "mentor khác xóa");
  assert.strictEqual(JSON.stringify(evaluations), before);

  // Thực tập sinh chưa có mentor -> 403 cho mọi mentor
  await rejects(service.saveEvaluation(mentor1, 12, valid), 403, "intern chưa có mentor");

  // Không tồn tại -> 404
  await rejects(service.saveEvaluation(mentor1, 999999, valid), 404, "intern không tồn tại");
  await rejects(service.getEvaluation(mentor1, 999999), 404, "đọc intern không tồn tại");
  await rejects(service.deleteEvaluation(mentor1, 999999), 404, "xóa intern không tồn tại");

  // Id không hợp lệ -> 400
  for (const id of ["abc", "0", "-1", "1.5", "", null, undefined, "1e3"]) {
    await rejects(service.getEvaluation(mentor1, id), 400, `id ${id}`);
  }

  // Không phải mentor / mentor không có hồ sơ -> 403
  await rejects(service.saveEvaluation(internUser, 10, valid), 403, "Intern");
  await rejects(service.saveEvaluation(mentorNoProfile, 10, valid), 403, "mentor không hồ sơ");
  await rejects(service.getMentorOverview(mentorNoProfile), 403, "overview mentor không hồ sơ");

  // Dữ liệu sai vẫn bị 400 sau khi qua kiểm tra quyền
  await rejects(
    service.saveEvaluation(mentor1, 10, { ...valid, skill_score: 9 }),
    400,
    "điểm sai",
  );
}

async function testOverview() {
  let ov = await service.getMentorOverview(mentor1);
  assert.deepStrictEqual(ov.summary, { total: 2, evaluated: 1, pending: 1 });
  const a = ov.interns.find((i) => i.intern_id === 10);
  const d = ov.interns.find((i) => i.intern_id === 13);
  assert.strictEqual(a.has_evaluation, true);
  assert.strictEqual(a.overall_score, 2.5);
  assert.strictEqual(d.has_evaluation, false);
  assert.strictEqual(d.overall_score, null);
  // Không lộ thực tập sinh của mentor khác
  assert.ok(!ov.interns.some((i) => i.intern_id === 11));

  ov = await service.getMentorOverview(mentor2);
  assert.deepStrictEqual(ov.summary, { total: 1, evaluated: 0, pending: 1 });
}

async function testDelete() {
  const res = await service.deleteEvaluation(mentor1, "10");
  assert.strictEqual(res, null);
  assert.strictEqual(evaluations.filter((e) => e.internId === 10).length, 0);
  // Xóa lần hai -> 404
  await rejects(service.deleteEvaluation(mentor1, 10), 404, "xóa lần hai");
  // Chưa từng đánh giá -> 404
  await rejects(service.deleteEvaluation(mentor1, 13), 404, "xóa khi chưa có");
  const ov = await service.getMentorOverview(mentor1);
  assert.strictEqual(ov.summary.evaluated, 0);
}

(async () => {
  testValidate();
  testOverallScore();
  await testSaveAndUpdate();
  await testNeedsConfirmedContract();
  await testPermissions();
  await testOverview();
  await testDelete();
  console.log("PASS test_evaluations_unit");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
