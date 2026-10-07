// Unit test tệp đính kèm của cập nhật tiến độ: không cần MySQL, dùng db giả trong bộ nhớ.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const lower = (v) => String(v).toLowerCase();
const mentors = [
  { id: 1, email: "m1@test.local" },
  { id: 2, email: "m2@test.local" },
];
const interns = [
  { id: 10, fullName: "A", email: "a@test.local", mentorId: 1 },
  { id: 11, fullName: "B", email: "b@test.local", mentorId: 2 },
];
const task = {
  id: 1,
  internId: 10,
  title: "T",
  status: "TODO",
  progressPercent: 0,
  dueDate: null,
  priority: "MEDIUM",
};
let tasks = [task];
let attachments = [];
let nextId = 1;

const fakeDb = {
  findMentorByEmail: async (e) =>
    mentors.find((m) => lower(m.email) === lower(e)) || null,
  findInternProfileByEmail: async (e) =>
    interns.find((i) => lower(i.email) === lower(e)) || null,
  findInternTaskById: async (id) => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return null;
    const intern = interns.find((i) => i.id === t.internId);
    return { ...t, internName: intern.fullName, internMentorId: intern.mentorId };
  },
  listTaskAttachmentsByTaskIds: async (ids) => {
    const out = {};
    for (const a of attachments) {
      if (ids.map(Number).includes(a.taskId)) (out[a.taskId] ||= []).push(a);
    }
    return out;
  },
  findTaskAttachmentById: async (taskId, id) =>
    attachments.find((a) => a.id === id && a.taskId === taskId) || null,
  insertTaskAttachmentLimited: async (data, max) => {
    if (failInsert) throw new Error("db down");
    if (attachments.filter((a) => a.taskId === data.taskId).length >= max)
      return { outcome: "LIMIT" };
    const row = {
      id: nextId++,
      taskId: data.taskId,
      originalName: data.originalName,
      storedName: data.storedName,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      uploadedAt: "2026-01-01 00:00:00",
    };
    attachments.push(row);
    return { outcome: "SAVED", attachment: row };
  },
  deleteTaskAttachment: async (taskId, id) => {
    const before = attachments.length;
    attachments = attachments.filter((a) => !(a.id === id && a.taskId === taskId));
    return before - attachments.length;
  },
  deleteInternTask: async (id) => {
    tasks = tasks.filter((t) => t.id !== id);
    attachments = attachments.filter((a) => a.taskId !== id);
    return 1;
  },
};
let failInsert = false;

const dbPath = require.resolve("../db");
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: fakeDb,
  children: [],
  paths: [],
};

const service = require("../services/tasks.service");
const storage = require("../services/fileStorage");

const internA = { email: "a@test.local", role: "Intern" };
const internB = { email: "b@test.local", role: "Intern" };
const mentor1 = { email: "m1@test.local", role: "Mentor" };
const mentor2 = { email: "m2@test.local", role: "Mentor" };
const pdf = (name = "bao cao.pdf") => ({
  originalname: name,
  buffer: Buffer.from("%PDF-1.4 test"),
});

async function rejects(promise, status, label) {
  try {
    await promise;
  } catch (err) {
    assert.strictEqual(err.status, status, `${label}: nhận ${err.status} (${err.message})`);
    return;
  }
  assert.fail(`${label}: mong đợi lỗi ${status}`);
}

const diskFile = (storedName) => path.join(storage.UPLOADS_DIR, storedName);
const uploadsCount = () =>
  fs.readdirSync(storage.UPLOADS_DIR).filter((f) => f !== ".gitkeep").length;

(async () => {
  const baseline = uploadsCount();

  // Tải lên thành công, DTO không lộ stored_name
  const up = await service.uploadMyTaskAttachment(internA, "1", pdf());
  assert.strictEqual(up.attachment.original_name, "bao_cao.pdf");
  assert.strictEqual(up.attachment.mime_type, "application/pdf");
  assert.strictEqual(up.attachment.can_preview, true);
  assert.strictEqual(up.attachment.stored_name, undefined);
  assert.strictEqual(up.task.attachments.length, 1);
  assert.ok(fs.existsSync(diskFile(attachments[0].storedName)));

  // Phân quyền tải lên
  await rejects(service.uploadMyTaskAttachment(internB, "1", pdf()), 403, "intern khác");
  await rejects(service.uploadMyTaskAttachment(internA, "99", pdf()), 404, "task không có");
  await rejects(service.uploadMyTaskAttachment(internA, "abc", pdf()), 400, "id sai");
  await rejects(service.uploadMyTaskAttachment(internA, "1", undefined), 400, "thiếu file");
  await rejects(
    service.uploadMyTaskAttachment(internA, "1", { originalname: "a.exe", buffer: Buffer.from("MZ") }),
    400,
    "đuôi exe",
  );
  await rejects(
    service.uploadMyTaskAttachment(internA, "1", { originalname: "a.pdf", buffer: Buffer.from("MZ..") }),
    400,
    "exe đổi đuôi",
  );
  assert.strictEqual(uploadsCount(), baseline + 1, "Lỗi validate không được để lại file");

  // Giới hạn số file; file vượt giới hạn bị xóa khỏi đĩa
  for (let i = 1; i < service.MAX_ATTACHMENTS_PER_TASK; i++) {
    await service.uploadMyTaskAttachment(internA, "1", pdf(`f${i}.pdf`));
  }
  await rejects(service.uploadMyTaskAttachment(internA, "1", pdf("extra.pdf")), 409, "quá 5 file");
  assert.strictEqual(uploadsCount(), baseline + service.MAX_ATTACHMENTS_PER_TASK);

  // Lỗi DB thì file mới bị xóa
  failInsert = true;
  const origErr = console.error;
  console.error = () => {};
  await rejects(service.uploadMyTaskAttachment(internA, "1", pdf("x.pdf")), 500, "db lỗi");
  console.error = origErr;
  failInsert = false;
  assert.strictEqual(uploadsCount(), baseline + service.MAX_ATTACHMENTS_PER_TASK);

  // Tải xuống: chủ task và mentor phụ trách được; người khác bị chặn
  const first = attachments[0];
  const dl = await service.getTaskAttachmentForDownload(internA, "1", String(first.id));
  assert.strictEqual(dl.mimeType, "application/pdf");
  assert.ok(fs.existsSync(dl.filePath));
  await service.getTaskAttachmentForDownload(mentor1, "1", String(first.id));
  await rejects(service.getTaskAttachmentForDownload(mentor2, "1", String(first.id)), 403, "mentor khác");
  await rejects(service.getTaskAttachmentForDownload(internB, "1", String(first.id)), 403, "intern khác");
  await rejects(service.getTaskAttachmentForDownload(internA, "1", "999"), 404, "file không có");

  // Xóa: chỉ chủ task; file vật lý bị xóa
  const stored = first.storedName;
  await rejects(service.deleteMyTaskAttachment(internB, "1", String(first.id)), 403, "xóa intern khác");
  await rejects(service.deleteMyTaskAttachment(internA, "1", "999"), 404, "xóa không có");
  const del = await service.deleteMyTaskAttachment(internA, "1", String(first.id));
  assert.strictEqual(del.task.attachments.length, service.MAX_ATTACHMENTS_PER_TASK - 1);
  assert.ok(!fs.existsSync(diskFile(stored)), "File vật lý phải bị xóa");

  // Mentor xóa nhiệm vụ thì file đính kèm cũng bị xóa
  const left = attachments.map((a) => a.storedName);
  await service.deleteTask(mentor1, "1");
  for (const name of left) assert.ok(!fs.existsSync(diskFile(name)), "File phải bị dọn");
  assert.strictEqual(uploadsCount(), baseline);

  console.log("PASS test_task_attachments_unit");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
