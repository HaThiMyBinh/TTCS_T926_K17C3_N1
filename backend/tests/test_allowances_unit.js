// Unit test phụ cấp thực tập sinh (HR): không cần MySQL, dùng db giả trong bộ nhớ.
const db = require("../db");
const svc = require("../services/allowances.service");
const { addDays } = require("../services/scheduleRules.service");
const { getVietnamToday } = require("../utils/date");

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(` [PASS] ${name}`);
  } else {
    failed += 1;
    console.error(` [FAIL] ${name}${detail ? `: ${detail}` : ""}`);
  }
}
async function rejects(name, promise, status) {
  try {
    await promise;
  } catch (e) {
    check(name, e.status === status, `nhận ${e.status} (${e.message})`);
    return;
  }
  check(name, false, "phải bị từ chối nhưng đã thành công");
}
function throwsStatus(name, fn, status) {
  try {
    fn();
  } catch (e) {
    check(name, e.status === status, `nhận ${e.status} (${e.message})`);
    return;
  }
  check(name, false, "phải bị từ chối nhưng đã thành công");
}

const today = getVietnamToday();
const D = (n) => addDays(today, n);

// ---------- db giả ----------
const interns = [
  { id: 1, fullName: "An", studentCode: "SV1", university: "ĐH X", email: "an@x.vn" },
  { id: 2, fullName: "Bình (chưa có hợp đồng)", studentCode: "SV2", university: "ĐH Y", email: "binh@x.vn" },
  { id: 3, fullName: "Chi (hợp đồng thiếu ngày)", studentCode: "SV3", university: "ĐH X", email: "Chi@X.vn" },
];
const contracts = [
  { id: 1, internId: 1, startDate: D(-60), endDate: D(120) },
  { id: 3, internId: 3, startDate: null, endDate: null },
];
let rows = [];
let nextId = 1;
const original = { ...db };
Object.assign(db, {
  findInternProfileById: async (id) => interns.find((i) => i.id === id) || null,
  findInternProfileByEmail: async (email) => interns.find((i) => i.email.toLowerCase() === String(email).toLowerCase()) || null,
  listConfirmedContractsForInterns: async (ids) => contracts.filter((c) => ids.includes(c.internId)),
  listAllowancesByIntern: async (internId) => rows.filter((r) => r.internId === internId),
  findAllowanceById: async (id) => rows.find((r) => r.id === id) || null,
  // Giả lập kiểm tra trùng khoảng hiệu lực (bản thật chạy trong SQL, được API test kiểm chứng).
  saveAllowanceAtomic: async ({ id = null, internId, fields, userId }) => {
    if (id !== null && !rows.some((r) => r.id === id && r.internId === internId)) return { outcome: "NOT_FOUND" };
    const to = fields.effectiveTo || "9999-12-31";
    const clash = rows.some(
      (r) =>
        r.internId === internId && r.allowanceType === fields.allowanceType && r.id !== id &&
        r.effectiveFrom <= to && (r.effectiveTo || "9999-12-31") >= fields.effectiveFrom,
    );
    if (clash) return { outcome: "OVERLAP" };
    if (id === null) {
      const row = { id: nextId++, internId, ...fields, createdBy: userId, updatedBy: userId, createdAt: "2026-10-01T03:00:00.000Z" };
      rows.push(row);
      return { outcome: "SAVED", id: row.id };
    }
    Object.assign(rows.find((r) => r.id === id), fields, { updatedBy: userId });
    return { outcome: "SAVED", id };
  },
  deleteAllowance: async (id, internId) => {
    const before = rows.length;
    rows = rows.filter((r) => !(r.id === id && r.internId === internId));
    return rows.length < before;
  },
  listAllowanceOverview: async ({ filters }) =>
    interns
      .filter((i) => !filters.university || i.university === filters.university)
      .map((i) => ({ id: i.id, fullName: i.fullName, totalCount: 0, activeCount: i.id === 1 ? 2 : 0, totalMonthly: i.id === 1 ? 700000 : 0 })),
});

const valid = { allowance_type: "MEAL", amount: 500000, pay_cycle: "MONTHLY", effective_from: D(-10), effective_to: D(30), note: "Ăn uống" };

async function run() {
  console.log("\n== Kiểm tra dữ liệu đầu vào ==");
  const ok = svc.validateAllowanceFields(valid);
  check("Dữ liệu hợp lệ được chuẩn hóa sang camelCase",
    ok.allowanceType === "MEAL" && ok.amount === 500000 && ok.payCycle === "MONTHLY" && ok.effectiveFrom === D(-10) && ok.note === "Ăn uống");
  throwsStatus("Body không phải object → 400", () => svc.validateAllowanceFields(null), 400);
  throwsStatus("Body là mảng → 400", () => svc.validateAllowanceFields([]), 400);
  throwsStatus("Trường lạ intern_id → 400", () => svc.validateAllowanceFields({ ...valid, intern_id: 9 }), 400);
  throwsStatus("Trường lạ created_by → 400", () => svc.validateAllowanceFields({ ...valid, created_by: 9 }), 400);
  for (const key of ["allowance_type", "amount", "pay_cycle", "effective_from"]) {
    const input = { ...valid };
    delete input[key];
    throwsStatus(`Thiếu ${key} → 400`, () => svc.validateAllowanceFields(input), 400);
  }
  throwsStatus("Loại phụ cấp sai → 400", () => svc.validateAllowanceFields({ ...valid, allowance_type: "BONUS" }), 400);
  throwsStatus("Chu kỳ sai → 400", () => svc.validateAllowanceFields({ ...valid, pay_cycle: "YEARLY" }), 400);
  for (const [label, amount] of [["chuỗi", "500000"], ["số thực", 1000.5], ["số âm", -5], ["bằng 0", 0], ["quá lớn", svc.AMOUNT_MAX + 1], ["true", true], ["NaN", NaN]]) {
    throwsStatus(`Số tiền ${label} → 400`, () => svc.validateAllowanceFields({ ...valid, amount }), 400);
  }
  check("Số tiền tối đa vẫn hợp lệ", svc.validateAllowanceFields({ ...valid, amount: svc.AMOUNT_MAX }).amount === svc.AMOUNT_MAX);
  throwsStatus("Ngày sai định dạng → 400", () => svc.validateAllowanceFields({ ...valid, effective_from: "01/10/2026" }), 400);
  throwsStatus("Ngày không tồn tại (31/02) → 400", () => svc.validateAllowanceFields({ ...valid, effective_from: "2026-02-31" }), 400);
  throwsStatus("effective_to sai → 400", () => svc.validateAllowanceFields({ ...valid, effective_to: "abc" }), 400);
  check("effective_to rỗng → null", svc.validateAllowanceFields({ ...valid, effective_to: "" }).effectiveTo === null);
  throwsStatus("Ghi chú không phải chuỗi → 400", () => svc.validateAllowanceFields({ ...valid, note: 123 }), 400);
  throwsStatus("Ghi chú quá 500 ký tự → 400", () => svc.validateAllowanceFields({ ...valid, note: "x".repeat(501) }), 400);
  check("Ghi chú đúng 500 ký tự được chấp nhận", svc.validateAllowanceFields({ ...valid, note: "x".repeat(500) }).note.length === 500);
  check("Ghi chú toàn khoảng trắng → null", svc.validateAllowanceFields({ ...valid, note: "   " }).note === null);
  throwsStatus("PATCH rỗng → 400", () => svc.validateAllowanceFields({}, { partial: true }), 400);
  check("PATCH chỉ kiểm tra trường có mặt", Object.keys(svc.validateAllowanceFields({ amount: 1 }, { partial: true })).join() === "amount");

  console.log("\n== Luật liên quan nhiều trường ==");
  throwsStatus("Ngày kết thúc trước ngày bắt đầu → 400",
    () => svc.validateCombination({ allowanceType: "MEAL", effectiveFrom: "2026-10-10", effectiveTo: "2026-10-09", note: null }), 400);
  check("Một ngày (from = to) hợp lệ",
    !!svc.validateCombination({ allowanceType: "MEAL", effectiveFrom: "2026-10-10", effectiveTo: "2026-10-10", note: null }));
  throwsStatus("Loại Khác không có ghi chú → 400",
    () => svc.validateCombination({ allowanceType: "OTHER", effectiveFrom: "2026-10-10", effectiveTo: null, note: null }), 400);
  check("Loại Khác có ghi chú → hợp lệ",
    !!svc.validateCombination({ allowanceType: "OTHER", effectiveFrom: "2026-10-10", effectiveTo: null, note: "Hỗ trợ thiết bị" }));

  console.log("\n== Trạng thái, tổng hợp, hợp đồng ==");
  check("Trạng thái ACTIVE", svc.allowanceStatus({ effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31" }, "2026-06-01") === "ACTIVE");
  check("Trạng thái ACTIVE khi không có ngày kết thúc", svc.allowanceStatus({ effectiveFrom: "2026-01-01", effectiveTo: null }, "2030-01-01") === "ACTIVE");
  check("Trạng thái ACTIVE đúng ngày đầu và ngày cuối",
    svc.allowanceStatus({ effectiveFrom: "2026-06-01", effectiveTo: "2026-06-30" }, "2026-06-01") === "ACTIVE" &&
    svc.allowanceStatus({ effectiveFrom: "2026-06-01", effectiveTo: "2026-06-30" }, "2026-06-30") === "ACTIVE");
  check("Trạng thái UPCOMING", svc.allowanceStatus({ effectiveFrom: "2026-07-01", effectiveTo: null }, "2026-06-30") === "UPCOMING");
  check("Trạng thái EXPIRED", svc.allowanceStatus({ effectiveFrom: "2026-01-01", effectiveTo: "2026-05-31" }, "2026-06-01") === "EXPIRED");

  const items = [
    { effectiveFrom: "2026-01-01", effectiveTo: null, payCycle: "MONTHLY", amount: 500000 },
    { effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", payCycle: "MONTHLY", amount: 200000 },
    { effectiveFrom: "2026-01-01", effectiveTo: null, payCycle: "DAILY", amount: 30000 },
    { effectiveFrom: "2026-01-01", effectiveTo: null, payCycle: "ONE_TIME", amount: 900000 },
    { effectiveFrom: "2026-01-01", effectiveTo: "2026-02-01", payCycle: "MONTHLY", amount: 999999 }, // hết hạn
    { effectiveFrom: "2027-01-01", effectiveTo: null, payCycle: "MONTHLY", amount: 888888 }, // sắp tới
  ];
  const sum = svc.summarizeAllowances(items, "2026-06-01");
  check("Tổng hợp: chỉ cộng khoản THÁNG đang hiệu lực", sum.totalMonthly === 700000, String(sum.totalMonthly));
  check("Tổng hợp: khoản theo ngày tách riêng", sum.totalDaily === 30000);
  check("Tổng hợp: đếm khoản đang hiệu lực (kể cả một lần)", sum.activeCount === 4 && sum.totalCount === 6, JSON.stringify(sum));
  check("Tổng hợp danh sách rỗng", JSON.stringify(svc.summarizeAllowances([], "2026-06-01")) === JSON.stringify({ totalCount: 0, activeCount: 0, totalMonthly: 0, totalDaily: 0 }));


  const c = [{ startDate: "2026-01-01", endDate: "2026-12-31" }];
  check("Hợp đồng bao phủ khoảng nằm trong", svc.isCoveredByContract(c, "2026-02-01", "2026-03-01"));
  check("Hợp đồng bao phủ khi chỉ có ngày bắt đầu", svc.isCoveredByContract(c, "2026-02-01", null));
  check("Hợp đồng không bao phủ khi bắt đầu trước hợp đồng", !svc.isCoveredByContract(c, "2025-12-31", "2026-03-01"));
  check("Hợp đồng không bao phủ khi kết thúc sau hợp đồng", !svc.isCoveredByContract(c, "2026-02-01", "2027-01-01"));
  check("Hợp đồng không ngày bao phủ mọi khoảng", svc.isCoveredByContract([{ startDate: null, endDate: null }], "2000-01-01", "2099-01-01"));
  check("Khoảng không thể chắp từ hai hợp đồng liền kề",
    !svc.isCoveredByContract([{ startDate: "2026-01-01", endDate: "2026-03-31" }, { startDate: "2026-04-01", endDate: "2026-06-30" }], "2026-03-01", "2026-05-01"));

  console.log("\n== Nghiệp vụ tạo / sửa / xóa ==");
  const hr = { id: 99, role: "HR" };
  await rejects("ID thực tập sinh không hợp lệ → 400", svc.create(hr, "abc", valid), 400);
  await rejects("ID thực tập sinh = 0 → 400", svc.create(hr, "0", valid), 400);
  await rejects("Thực tập sinh không tồn tại → 404", svc.create(hr, "999", valid), 404);
  await rejects("Chưa có hợp đồng xác nhận → 409", svc.create(hr, "2", valid), 409);
  await rejects("Dữ liệu sai → 400 (trước khi kiểm tra hợp đồng)", svc.create(hr, "1", { ...valid, amount: -1 }), 400);
  await rejects("Bắt đầu trước hợp đồng → 409", svc.create(hr, "1", { ...valid, effective_from: D(-90), effective_to: D(-80) }), 409);
  await rejects("Kết thúc sau hợp đồng → 409", svc.create(hr, "1", { ...valid, effective_to: D(200) }), 409);
  check("Các lần thất bại không ghi gì vào DB", rows.length === 0);

  const created = await svc.create(hr, "1", valid);
  check("Tạo thành công, có id và trạng thái ACTIVE", created.id > 0 && created.status === "ACTIVE");
  check("Ghi nhận người tạo", rows[0].createdBy === 99);
  const defaults = await svc.create(hr, "1", { allowance_type: "TRANSPORT", amount: 300000, pay_cycle: "MONTHLY", effective_from: D(-5) });
  check("Không gửi effective_to / note → null", defaults.effectiveTo === null && defaults.note === null);
  await rejects("Trùng khoảng cùng loại (giao nhau) → 409", svc.create(hr, "1", { ...valid, effective_from: D(0), effective_to: D(10) }), 409);
  await rejects("Trùng với khoản không ngày kết thúc → 409", svc.create(hr, "1", { allowance_type: "TRANSPORT", amount: 1, pay_cycle: "DAILY", effective_from: D(50) }), 409);
  const otherType = await svc.create(hr, "1", { ...valid, allowance_type: "PHONE", note: null });
  check("Khác loại thì không bị coi là trùng", otherType.id > 0);
  const after = await svc.create(hr, "1", { ...valid, effective_from: D(31), effective_to: D(60) });
  check("Liền kề khoản cũ (cùng loại) hợp lệ", after.id > 0);
  const openContract = await svc.create(hr, "3", { allowance_type: "HOUSING", amount: 1, pay_cycle: "ONE_TIME", effective_from: "2000-01-01", effective_to: "2099-01-01" });
  check("Hợp đồng không có ngày không giới hạn kỳ phụ cấp", openContract.id > 0);

  const updated = await svc.update(hr, "1", String(created.id), { amount: 650000 });
  check("PATCH một trường giữ nguyên các trường còn lại",
    updated.amount === 650000 && updated.allowanceType === "MEAL" && updated.note === "Ăn uống" && updated.effectiveTo === D(30));
  check("Ghi nhận người sửa", rows.find((r) => r.id === created.id).updatedBy === 99);
  await rejects("PATCH bỏ ngày kết thúc làm trùng khoản cùng loại phía sau → 409",
    svc.update(hr, "1", String(created.id), { effective_to: null }), 409);
  const cleared = await svc.update(hr, "1", String(otherType.id), { effective_to: null });
  check("PATCH effective_to = null để bỏ ngày kết thúc", cleared.effectiveTo === null);
  await rejects("PATCH đổi sang OTHER nhưng không còn ghi chú → 400", svc.update(hr, "1", String(created.id), { allowance_type: "OTHER", note: null }), 400);
  await rejects("PATCH ngày kết thúc trước ngày bắt đầu → 400", svc.update(hr, "1", String(after.id), { effective_to: D(20) }), 400);
  await rejects("PATCH trường lạ → 400", svc.update(hr, "1", String(after.id), { intern_id: 3 }), 400);
  await rejects("PATCH khoản không tồn tại → 404", svc.update(hr, "1", "9999", { amount: 5 }), 404);
  await rejects("PATCH khoản của thực tập sinh khác (IDOR) → 404", svc.update(hr, "3", String(after.id), { amount: 5 }), 404);
  await rejects("PATCH allowanceId sai định dạng → 400", svc.update(hr, "1", "x", { amount: 5 }), 400);
  await rejects("PATCH ra ngoài hợp đồng → 409", svc.update(hr, "1", String(after.id), { effective_to: D(500) }), 409);

  const list = await svc.listForIntern("1");
  check("Danh sách kèm trạng thái từng khoản", list.items.length >= 3 && list.items.every((i) => ["ACTIVE", "UPCOMING", "EXPIRED"].includes(i.status)));
  check("Danh sách kèm thông tin thực tập sinh", list.intern.id === 1 && list.intern.fullName === "An");
  check("Danh sách kèm tổng hợp", typeof list.summary.totalMonthly === "number" && list.summary.activeCount >= 1);
  await rejects("Danh sách của thực tập sinh không tồn tại → 404", svc.listForIntern("999"), 404);

  await rejects("Xóa khoản của thực tập sinh khác (IDOR) → 404", svc.remove("3", String(after.id)), 404);
  check("Khoản bị IDOR vẫn còn", rows.some((r) => r.id === after.id));
  const removed = await svc.remove("1", String(after.id));
  check("Xóa thành công", removed.id === after.id && !rows.some((r) => r.id === after.id));
  await rejects("Xóa lần hai → 404", svc.remove("1", String(after.id)), 404);

  console.log("\n== Tổng quan ==");
  const ov = await svc.overview({});
  check("Tổng quan có items + summary", ov.items.length === 3 && ov.summary.internCount === 3);
  check("Tổng quan cộng đúng tổng tháng và số người có phụ cấp", ov.summary.totalMonthly === 700000 && ov.summary.withAllowance === 1);
  const ovUni = await svc.overview({ university: "ĐH Y" });
  check("Lọc theo trường được chuyển xuống DB", ovUni.items.length === 1 && ovUni.items[0].id === 2);
  await rejects("Tham số q không phải chuỗi → 400", svc.overview({ q: ["a", "b"] }), 400);
  await rejects("Tham số q quá dài → 400", svc.overview({ q: "x".repeat(101) }), 400);

  console.log("\n== Thực tập sinh xem lịch sử phụ cấp của mình ==");
  const mine = await svc.listMine({ email: "an@x.vn" });
  const ownRows = rows.filter((r) => r.internId === 1);
  check("Trả đúng số khoản của chính thực tập sinh", mine.items.length === ownRows.length && mine.items.length >= 3, String(mine.items.length));
  check("Mọi khoản trả về thuộc thực tập sinh đó", mine.items.every((i) => ownRows.some((r) => r.id === i.id)));
  check("Không lẫn khoản của thực tập sinh khác", !mine.items.some((i) => rows.filter((r) => r.internId === 3).some((r) => r.id === i.id)));
  const keys = Object.keys(mine.items[0]).sort().join();
  check("Chỉ lộ các trường cần thiết (không có createdBy/updatedBy/internId)",
    keys === "allowanceType,amount,effectiveFrom,effectiveTo,id,note,payCycle,recordedAt,status", keys);
  check("Có ngày ghi nhận", mine.items.every((i) => i.recordedAt === "2026-10-01T03:00:00.000Z"));
  check("Có tên và MSSV", mine.intern.fullName === "An" && mine.intern.studentCode === "SV1");
  const mineStatus = mine.items.map((i) => i.status);
  check("Mỗi khoản có trạng thái hợp lệ", mineStatus.every((st) => svc.ALLOWANCE_STATUSES.includes(st)));
  const mineSum = mine.summary;
  check("Tổng hợp: số khoản và số theo trạng thái khớp danh sách",
    mineSum.totalCount === mine.items.length &&
    mineSum.activeCount === mineStatus.filter((x) => x === "ACTIVE").length &&
    mineSum.upcomingCount === mineStatus.filter((x) => x === "UPCOMING").length &&
    mineSum.expiredCount === mineStatus.filter((x) => x === "EXPIRED").length, JSON.stringify(mineSum));
  check("Tổng theo tháng bằng tổng các khoản THÁNG đang hiệu lực",
    mineSum.totalMonthly === mine.items.filter((i) => i.status === "ACTIVE" && i.payCycle === "MONTHLY").reduce((t, i) => t + i.amount, 0));

  const onlyActive = await svc.listMine({ email: "an@x.vn" }, { status: "ACTIVE" });
  check("Lọc status=ACTIVE chỉ còn khoản đang hiệu lực", onlyActive.items.length === mineSum.activeCount && onlyActive.items.every((i) => i.status === "ACTIVE"));
  check("Bộ lọc không làm đổi phần tổng hợp", JSON.stringify(onlyActive.summary) === JSON.stringify(mineSum));
  const onlyPhone = await svc.listMine({ email: "an@x.vn" }, { type: "PHONE" });
  check("Lọc type=PHONE chỉ còn khoản điện thoại", onlyPhone.items.length >= 1 && onlyPhone.items.every((i) => i.allowanceType === "PHONE"));
  const both = await svc.listMine({ email: "an@x.vn" }, { status: "EXPIRED", type: "MEAL" });
  check("Lọc hai điều kiện cùng lúc", both.items.every((i) => i.status === "EXPIRED" && i.allowanceType === "MEAL"));
  const caseMail = await svc.listMine({ email: "CHI@x.VN" });
  check("Email không phân biệt hoa thường; chỉ thấy khoản của mình", caseMail.items.length >= 1 && caseMail.items.every((i) => rows.find((r) => r.id === i.id).internId === 3));
  const empty = await svc.listMine({ email: "binh@x.vn" });
  check("Thực tập sinh chưa có phụ cấp → danh sách rỗng, tổng bằng 0",
    empty.items.length === 0 && empty.summary.totalCount === 0 && empty.summary.totalMonthly === 0 && empty.summary.activeCount === 0);
  await rejects("Tài khoản chưa có hồ sơ thực tập sinh → 404", svc.listMine({ email: "nobody@x.vn" }), 404);
  await rejects("Trạng thái lọc sai → 400", svc.listMine({ email: "an@x.vn" }, { status: "PAID" }), 400);
  await rejects("Loại lọc sai → 400", svc.listMine({ email: "an@x.vn" }, { type: "BONUS" }), 400);
  await rejects("Tham số lạ (intern_id) → 400", svc.listMine({ email: "an@x.vn" }, { intern_id: "3" }), 400);
  await rejects("Tham số lọc dạng mảng → 400", svc.listMine({ email: "an@x.vn" }, { status: ["ACTIVE", "EXPIRED"] }), 400);

  Object.assign(db, original);
}

run()
  .catch((err) => {
    failed += 1;
    console.error(" [FAIL] Lỗi không mong đợi:", err);
  })
  .finally(() => {
    console.log(`\n${passed} pass, ${failed} fail\n`);
    if (failed > 0) process.exitCode = 1;
  });
