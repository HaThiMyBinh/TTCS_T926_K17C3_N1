const assert = require("assert");
const service = require("../services/supportRequests.service");
const { HttpError } = require("../errors");

function throwsStatus(fn, status) { assert.throws(fn, (err) => err instanceof HttpError && err.status === status); }
async function rejectsStatus(fn, status) { await assert.rejects(fn, (err) => err instanceof HttpError && err.status === status); }
function fakeStore(status, { resultFiles = 0, affectedRows = 1 } = {}) {
  return {
    findSupportRequest: async () => ({ id: 9, internId: 7, title: "Xác nhận thực tập", status }),
    countSupportAttachments: async () => resultFiles,
    processSupportRequest: async () => affectedRows,
  };
}

assert.deepStrictEqual(service.validateBody({ request_type: "OTHER", title: "  Yêu cầu hợp lệ ", description: " Mô tả " }), { requestType: "OTHER", title: "Yêu cầu hợp lệ", description: "Mô tả" });
throwsStatus(() => service.validateBody({ request_type: "OTHER", title: "abc", description: "", status: "RESOLVED" }), 400);
throwsStatus(() => service.validateBody({ request_type: "OTHER", title: "abc", description: "" }), 400);
throwsStatus(() => service.validateBody({ request_type: "INVALID", title: "abc", description: "x" }), 400);
assert.deepStrictEqual(service.validateFilters({ status: "PENDING", type: "OTHER" }), { status: "PENDING", type: "OTHER", q: null });
assert.deepStrictEqual(service.validateFilters({ q: "abc", page: "2", pageSize: "50" }, true), { status: null, type: null, q: "abc", page: 2, pageSize: 50 });
throwsStatus(() => service.validateFilters({ unknown: "x" }, true), 400);
throwsStatus(() => service.validateFilters({ status: ["PENDING"] }, true), 400);
throwsStatus(() => service.validateFilters({ q: "x".repeat(101) }, true), 400);
throwsStatus(() => service.validateFilters({ pageSize: "101" }, true), 400);
for (const value of ["0", "-1", "1.1", "abc"]) throwsStatus(() => service.parseId(value), 400);
assert.strictEqual(service.parseId("9"), 9);
throwsStatus(() => service.validateDecision({ decision: "NO" }), 400);
throwsStatus(() => service.validateDecision({ decision: "REJECT" }), 400);
throwsStatus(() => service.validateDecision({ decision: "START", note: "x".repeat(1001) }), 400);

(async () => {
  const user = { id: 4 };
  const notifications = [];
  const notifier = { toInterns: async (ids, payload) => notifications.push({ ids, payload }) };
  const states = ["PENDING", "IN_PROGRESS", "RESOLVED", "REJECTED", "CANCELLED"];
  const expected = { START: ["PENDING"], RESOLVE: ["IN_PROGRESS"], REJECT: ["PENDING", "IN_PROGRESS"] };
  for (const [decision, validStates] of Object.entries(expected)) {
    for (const state of states) {
      const run = () => service.processWithDeps(user, "9", { decision, note: decision === "REJECT" ? "Lý do" : decision === "RESOLVE" ? "Đã xong" : "" }, { db: fakeStore(state), internNotify: notifier });
      if (validStates.includes(state)) await run(); else await rejectsStatus(run, 409);
    }
  }
  await rejectsStatus(() => service.processWithDeps(user, "9", { decision: "RESOLVE", note: "" }, { db: fakeStore("IN_PROGRESS"), internNotify: notifier }), 400);
  await service.processWithDeps(user, "9", { decision: "RESOLVE", note: "" }, { db: fakeStore("IN_PROGRESS", { resultFiles: 1 }), internNotify: notifier });
  await rejectsStatus(() => service.processWithDeps(user, "9", { decision: "START" }, { db: fakeStore("PENDING", { affectedRows: 0 }), internNotify: notifier }), 409);
  assert(notifications.some((entry) => entry.ids[0] === 7 && entry.payload.type === "SUPPORT_REQUEST_UPDATED" && entry.payload.targetTab === "tab-my-support"));
  assert(notifications.some((entry) => entry.payload.message.includes("Có file kết quả đính kèm")));
  await service.processWithDeps(user, "9", { decision: "START" }, { db: fakeStore("PENDING"), internNotify: { toInterns: async () => { throw new Error("notification failed"); } } });
  // Tải file lên phải atomic theo trạng thái: nếu yêu cầu đã đổi trạng thái (insert trả 0) thì 409 và xóa file vừa lưu.
  const db = require("../db"), storage = require("../services/fileStorage");
  const originals = { find: db.findSupportRequest, count: db.countSupportAttachments, insert: db.insertSupportAttachment, save: storage.saveBuffer, remove: storage.removeFile };
  const removed = []; let insertArgs = null;
  try {
    db.findSupportRequest = async () => ({ id: 9, internId: 7, status: "IN_PROGRESS" });
    db.countSupportAttachments = async () => 0;
    storage.saveBuffer = () => "00000000-0000-4000-8000-000000000000";
    storage.removeFile = (name) => { removed.push(name); return true; };
    db.insertSupportAttachment = async (row) => { insertArgs = row; return 0; };
    const file = { buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"), originalname: "ket-qua.pdf" };
    await rejectsStatus(() => service.upload({ id: 4 }, "9", file, "RESULT"), 409);
    assert.strictEqual(insertArgs.requiredStatus, "IN_PROGRESS");
    assert.deepStrictEqual(removed, ["00000000-0000-4000-8000-000000000000"]);
    db.findSupportRequest = async () => ({ id: 9, internId: 7, status: "PENDING" });
    await rejectsStatus(() => service.upload({ id: 4 }, "9", file, "RESULT"), 409);
    db.findSupportRequest = async () => ({ id: 9, internId: 7, status: "RESOLVED" });
    await rejectsStatus(() => service.removeResultAttachment("9", "3"), 409);
  } finally { db.findSupportRequest = originals.find; db.countSupportAttachments = originals.count; db.insertSupportAttachment = originals.insert; storage.saveBuffer = originals.save; storage.removeFile = originals.remove; }
  // Controller tải file phải dùng đúng trường filePath mà service trả về (lỗi cũ: dùng f.path → 500).
  const controller = require("../controllers/supportRequests.controller"), originalDownload = service.download;
  try {
    service.download = async () => ({ filePath: "/tmp/x.pdf", originalName: "x.pdf" });
    let downloaded = null; const headers = {};
    const res = { set(k, v) { headers[k] = v; return this; }, download(path, name) { downloaded = [path, name]; }, status() { return this; }, json() { throw new Error("không được trả lỗi"); } };
    await controller.download({ user: { id: 1, role: "HR" }, params: { id: "1", attachmentId: "2" } }, res);
    assert.deepStrictEqual(downloaded, ["/tmp/x.pdf", "x.pdf"]);
    assert.strictEqual(headers["X-Content-Type-Options"], "nosniff");
  } finally { service.download = originalDownload; }
  console.log("PASS test_support_requests_unit");
})().catch((err) => { console.error(err); process.exit(1); });
