// Integration API test: HR nhập phụ cấp thực tập sinh (CRUD, phân quyền, validate, trùng khoảng, tổng quan).
// Cần MySQL + backend, chạy qua `npm test` hoặc `npm run test:allowances-api`.
const mysql = require("mysql2/promise");
const {
  BASE_URL,
  loginAs,
  readDbConfig,
  cleanupTestData,
  confirmContractDirect,
} = require("./test_helpers");
const { addDays } = require("../services/scheduleRules.service");
const { getVietnamToday } = require("../utils/date");

const RUN_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const PREFIX = `allowx_test_${RUN_ID}`;
const today = getVietnamToday();
const D = (n) => addDays(today, n);
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

async function call(method, url, token, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${url}`, { method, headers, body: payload });
  const contentType = res.headers.get("content-type") || "";
  const json = contentType.includes("application/json") ? await res.json().catch(() => null) : null;
  return { status: res.status, body: json, headers: res.headers };
}

async function expectStatus(name, code, method, url, token, body) {
  const res = await call(method, url, token, body);
  check(name, res.status === code, `nhận ${res.status} ${JSON.stringify(res.body)?.slice(0, 160)}`);
  return res;
}

async function loginAccount(email) {
  const res = await call("POST", "/auth/login", null, { account: email, password: "password123" });
  if (res.status !== 200 || !res.body?.token) throw new Error(`Đăng nhập ${email} thất bại: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

async function createIntern(hrToken, label) {
  const email = `${PREFIX}_${label}@ictu.edu.vn`;
  const res = await call("POST", "/interns", hrToken, {
    fullName: `Intern Allowance ${label}`,
    email,
    studentCode: `AL${label}${Date.now().toString().slice(-5)}`,
    university: label === "b" ? "Allowance University B" : "Allowance University A",
    major: "Kỹ thuật phần mềm",
  });
  if (res.status !== 201) {
    throw new Error(`Tạo intern ${label} thất bại: ${JSON.stringify(res.body)}`);
  }
  return { id: Number((res.body.intern || res.body.student).id), email };
}

const valid = {
  allowance_type: "MEAL",
  amount: 500000,
  pay_cycle: "MONTHLY",
  effective_from: D(-10),
  effective_to: D(30),
  note: "Phụ cấp ăn uống",
};

// A: hợp đồng D(-60)..D(120); B: hợp đồng không ngày; C: chưa có hợp đồng.
async function setup(conn, emails) {
  const ctx = {
    adminToken: await loginAs("Admin"),
    hrToken: await loginAs("HR"),
    mentorToken: await loginAs("Mentor"),
    internToken: await loginAs("Intern"),
  };
  ctx.a = await createIntern(ctx.hrToken, "a");
  ctx.b = await createIntern(ctx.hrToken, "b");
  ctx.c = await createIntern(ctx.hrToken, "c");
  emails.push(ctx.a.email, ctx.b.email, ctx.c.email);
  await confirmContractDirect(conn, ctx.a.id, { startDate: D(-60), endDate: D(120) });
  await confirmContractDirect(conn, ctx.b.id);
  const [hr] = await conn.query("SELECT id FROM users WHERE LOWER(email) = 'hr@company.com'");
  ctx.hrUserId = Number(hr[0].id);
  return ctx;
}

async function testPermissions(ctx) {
  console.log("\n== Phân quyền ==");
  const base = `/interns/${ctx.a.id}/allowances`;
  const endpoints = [
    ["GET", "/allowances/overview"],
    ["GET", base],
    ["POST", base, valid],
    ["PATCH", `${base}/1`, { amount: 1 }],
    ["DELETE", `${base}/1`],
  ];
  for (const [method, url, body] of endpoints) {
    await expectStatus(`${method} ${url.replace(/\d+/g, "N")} không token → 401`, 401, method, url, null, body);
    await expectStatus(`${method} ${url.replace(/\d+/g, "N")} Admin → 403`, 403, method, url, ctx.adminToken, body);
    await expectStatus(`${method} ${url.replace(/\d+/g, "N")} Mentor → 403`, 403, method, url, ctx.mentorToken, body);
    await expectStatus(`${method} ${url.replace(/\d+/g, "N")} Intern → 403`, 403, method, url, ctx.internToken, body);
  }
  const res = await call("GET", base, ctx.hrToken);
  check("Phản hồi có Cache-Control: private, no-store", /no-store/.test(res.headers.get("cache-control") || ""));
  const ov = await call("GET", "/allowances/overview", ctx.hrToken);
  check("Tổng quan cũng có Cache-Control no-store", /no-store/.test(ov.headers.get("cache-control") || ""));
}

async function testValidation(ctx) {
  console.log("\n== Validate dữ liệu (400) ==");
  const url = `/interns/${ctx.a.id}/allowances`;
  const bad = [
    ["Số tiền là chuỗi", { ...valid, amount: "500000" }],
    ["Số tiền là số thực", { ...valid, amount: 1000.5 }],
    ["Số tiền âm", { ...valid, amount: -1 }],
    ["Số tiền bằng 0", { ...valid, amount: 0 }],
    ["Số tiền quá lớn", { ...valid, amount: 1000000000 }],
    ["Loại phụ cấp sai", { ...valid, allowance_type: "BONUS" }],
    ["Chu kỳ sai", { ...valid, pay_cycle: "YEARLY" }],
    ["Thiếu số tiền", (({ amount, ...rest }) => rest)(valid)],
    ["Thiếu ngày bắt đầu", (({ effective_from, ...rest }) => rest)(valid)],
    ["Ngày sai định dạng", { ...valid, effective_from: "10/10/2026" }],
    ["Ngày không tồn tại", { ...valid, effective_from: "2026-02-30" }],
    ["Ngày kết thúc trước ngày bắt đầu", { ...valid, effective_from: D(5), effective_to: D(4) }],
    ["Loại Khác không có ghi chú", { ...valid, allowance_type: "OTHER", note: null }],
    ["Ghi chú quá 500 ký tự", { ...valid, note: "x".repeat(501) }],
    ["Trường lạ intern_id", { ...valid, intern_id: ctx.b.id }],
    ["Trường lạ created_by", { ...valid, created_by: 1 }],
  ];
  for (const [name, body] of bad) await expectStatus(`${name} → 400`, 400, "POST", url, ctx.hrToken, body);
  await expectStatus("Body là mảng → 400", 400, "POST", url, ctx.hrToken, []);
  await expectStatus("ID thực tập sinh không phải số → 400", 400, "POST", "/interns/abc/allowances", ctx.hrToken, valid);
  await expectStatus("ID thực tập sinh = 0 → 400", 400, "GET", "/interns/0/allowances", ctx.hrToken);
  await expectStatus("ID khoản phụ cấp sai → 400", 400, "PATCH", `${url}/xyz`, ctx.hrToken, { amount: 1 });
  await expectStatus("Thực tập sinh không tồn tại (POST) → 404", 404, "POST", "/interns/99999999/allowances", ctx.hrToken, valid);
  await expectStatus("Thực tập sinh không tồn tại (GET) → 404", 404, "GET", "/interns/99999999/allowances", ctx.hrToken);
  const list = await call("GET", url, ctx.hrToken);
  check("Các yêu cầu sai không tạo ra bản ghi nào", list.body?.data?.items?.length === 0);
}

async function testContractRules(ctx) {
  console.log("\n== Luật hợp đồng (409) ==");
  await expectStatus("Chưa có hợp đồng xác nhận → 409", 409, "POST", `/interns/${ctx.c.id}/allowances`, ctx.hrToken, valid);
  await expectStatus("Bắt đầu trước hợp đồng → 409", 409, "POST", `/interns/${ctx.a.id}/allowances`, ctx.hrToken,
    { ...valid, effective_from: D(-90), effective_to: D(-70) });
  await expectStatus("Kết thúc sau hợp đồng → 409", 409, "POST", `/interns/${ctx.a.id}/allowances`, ctx.hrToken,
    { ...valid, effective_to: D(200) });
  await expectStatus("Bắt đầu sau khi hợp đồng đã hết → 409", 409, "POST", `/interns/${ctx.a.id}/allowances`, ctx.hrToken,
    { ...valid, effective_from: D(150), effective_to: null });
  const ok = await expectStatus("Hợp đồng không ngày → mọi khoảng đều hợp lệ (201)", 201, "POST",
    `/interns/${ctx.b.id}/allowances`, ctx.hrToken,
    { ...valid, allowance_type: "HOUSING", effective_from: "2020-01-01", effective_to: "2099-12-31" });
  check("Phản hồi tạo có id", Number(ok.body?.data?.id) > 0);
}

async function testCrud(ctx, conn) {
  console.log("\n== Thêm / xem / sửa / xóa ==");
  const url = `/interns/${ctx.a.id}/allowances`;
  const created = await expectStatus("Tạo phụ cấp ăn uống → 201", 201, "POST", url, ctx.hrToken, valid);
  const item = created.body?.data;
  check("Dữ liệu trả về đúng", item?.allowanceType === "MEAL" && item?.amount === 500000 && item?.payCycle === "MONTHLY"
    && item?.effectiveFrom === valid.effective_from && item?.effectiveTo === valid.effective_to && item?.note === valid.note,
    JSON.stringify(item));
  check("Khoản mới có trạng thái ACTIVE", item?.status === "ACTIVE");
  ctx.mealId = item.id;

  const [rows] = await conn.query("SELECT created_by, updated_by, amount FROM intern_allowances WHERE id = ?", [item.id]);
  check("Lưu người tạo / người sửa là HR đang đăng nhập", Number(rows[0].created_by) === ctx.hrUserId && Number(rows[0].updated_by) === ctx.hrUserId);
  check("Số tiền lưu là số nguyên", Number(rows[0].amount) === 500000);

  const transport = await expectStatus("Tạo phụ cấp đi lại không ngày kết thúc → 201", 201, "POST", url, ctx.hrToken,
    { allowance_type: "TRANSPORT", amount: 30000, pay_cycle: "DAILY", effective_from: D(-5) });
  check("Không gửi ghi chú → null, không ngày kết thúc → null", transport.body?.data?.note === null && transport.body?.data?.effectiveTo === null);
  ctx.transportId = transport.body.data.id;
  const future = await expectStatus("Tạo khoản sắp hiệu lực → 201", 201, "POST", url, ctx.hrToken,
    { allowance_type: "PHONE", amount: 100000, pay_cycle: "ONE_TIME", effective_from: D(10), effective_to: D(10) });
  check("Khoản bắt đầu trong tương lai có trạng thái UPCOMING", future.body?.data?.status === "UPCOMING");
  ctx.phoneId = future.body.data.id;
  const other = await expectStatus("Loại Khác có ghi chú → 201", 201, "POST", url, ctx.hrToken,
    { allowance_type: "OTHER", amount: 250000, pay_cycle: "MONTHLY", effective_from: D(-5), effective_to: D(5), note: "  Hỗ trợ thiết bị  " });
  check("Ghi chú được cắt khoảng trắng", other.body?.data?.note === "Hỗ trợ thiết bị");
  ctx.otherId = other.body.data.id;

  const list = await expectStatus("Xem danh sách → 200", 200, "GET", url, ctx.hrToken);
  const data = list.body?.data;
  check("Danh sách đủ 4 khoản và đúng thực tập sinh", data?.items?.length === 4 && data?.intern?.id === ctx.a.id);
  check("Tổng theo tháng = ăn uống + khoản Khác (đều hiệu lực)", data?.summary?.totalMonthly === 750000, JSON.stringify(data?.summary));
  check("Tổng theo ngày = 30.000", data?.summary?.totalDaily === 30000);
  check("Đếm 3 khoản đang hiệu lực / 4 khoản", data?.summary?.activeCount === 3 && data?.summary?.totalCount === 4);

  const patched = await expectStatus("Sửa số tiền (PATCH) → 200", 200, "PATCH", `${url}/${ctx.mealId}`, ctx.hrToken, { amount: 600000 });
  check("PATCH giữ nguyên các trường khác", patched.body?.data?.amount === 600000 && patched.body?.data?.note === valid.note
    && patched.body?.data?.effectiveTo === valid.effective_to && patched.body?.data?.allowanceType === "MEAL");
  await expectStatus("PATCH body rỗng → 400", 400, "PATCH", `${url}/${ctx.mealId}`, ctx.hrToken, {});
  await expectStatus("PATCH trường lạ → 400", 400, "PATCH", `${url}/${ctx.mealId}`, ctx.hrToken, { intern_id: ctx.b.id });
  await expectStatus("PATCH đổi sang Khác nhưng xóa ghi chú → 400", 400, "PATCH", `${url}/${ctx.mealId}`, ctx.hrToken, { allowance_type: "OTHER", note: null });
  await expectStatus("PATCH ngày kết thúc trước ngày bắt đầu → 400", 400, "PATCH", `${url}/${ctx.mealId}`, ctx.hrToken, { effective_to: D(-20) });
  await expectStatus("PATCH ra ngoài hợp đồng → 409", 409, "PATCH", `${url}/${ctx.mealId}`, ctx.hrToken, { effective_to: D(500) });
  await expectStatus("PATCH khoản không tồn tại → 404", 404, "PATCH", `${url}/99999999`, ctx.hrToken, { amount: 5 });
  const [after] = await conn.query("SELECT amount, updated_by FROM intern_allowances WHERE id = ?", [ctx.mealId]);
  check("Các PATCH bị từ chối không làm đổi dữ liệu", Number(after[0].amount) === 600000);
}

async function testOverlap(ctx, conn) {
  console.log("\n== Chống trùng khoảng hiệu lực (409) ==");
  const url = `/interns/${ctx.a.id}/allowances`;
  await expectStatus("Cùng loại, khoảng giao nhau → 409", 409, "POST", url, ctx.hrToken, { ...valid, effective_from: D(0), effective_to: D(10) });
  await expectStatus("Cùng loại, trùng khoản không ngày kết thúc → 409", 409, "POST", url, ctx.hrToken,
    { allowance_type: "TRANSPORT", amount: 1, pay_cycle: "DAILY", effective_from: D(50), effective_to: D(60) });
  await expectStatus("Cùng loại, chạm đúng ngày biên → 409", 409, "POST", url, ctx.hrToken, { ...valid, effective_from: D(30), effective_to: D(40) });
  await expectStatus("Khác loại cùng khoảng ngày → 201", 201, "POST", url, ctx.hrToken,
    { allowance_type: "HOUSING", amount: 1000000, pay_cycle: "MONTHLY", effective_from: D(-10), effective_to: D(30) });
  const next = await expectStatus("Cùng loại, liền kề ngay sau khoản cũ → 201", 201, "POST", url, ctx.hrToken,
    { ...valid, effective_from: D(31), effective_to: D(60) });
  await expectStatus("PATCH làm trùng khoản liền kề → 409", 409, "PATCH", `${url}/${next.body.data.id}`, ctx.hrToken, { effective_from: D(30) });
  await expectStatus("PATCH chính nó trong khoảng của nó (không tự trùng) → 200", 200, "PATCH", `${url}/${next.body.data.id}`, ctx.hrToken, { amount: 700000 });
  await expectStatus("Thực tập sinh khác có thể có cùng loại, cùng khoảng → 201", 201, "POST", `/interns/${ctx.b.id}/allowances`, ctx.hrToken,
    { ...valid, effective_from: "2021-01-01", effective_to: "2021-12-31" });

  // Chạy song song: đúng 1 yêu cầu được tạo, các yêu cầu còn lại bị 409 (khóa dòng trong transaction).
  const racing = { allowance_type: "PHONE", amount: 123000, pay_cycle: "MONTHLY", effective_from: D(40), effective_to: D(50) };
  const results = await Promise.all(Array.from({ length: 6 }, () => call("POST", url, ctx.hrToken, racing)));
  const created = results.filter((r) => r.status === 201).length;
  const conflicts = results.filter((r) => r.status === 409).length;
  check("6 yêu cầu song song cùng khoảng: đúng 1 thành công, 5 bị 409", created === 1 && conflicts === 5,
    results.map((r) => r.status).join(","));
  const [count] = await conn.query(
    "SELECT COUNT(*) AS n FROM intern_allowances WHERE intern_id = ? AND allowance_type = 'PHONE' AND effective_from = ?", [ctx.a.id, D(40)]);
  check("DB chỉ có 1 bản ghi cho khoảng đó", Number(count[0].n) === 1);
}

async function testIdorAndDelete(ctx, conn) {
  console.log("\n== IDOR và xóa ==");
  const urlA = `/interns/${ctx.a.id}/allowances`;
  const urlB = `/interns/${ctx.b.id}/allowances`;
  await expectStatus("PATCH khoản của A qua đường dẫn của B → 404", 404, "PATCH", `${urlB}/${ctx.mealId}`, ctx.hrToken, { amount: 1 });
  await expectStatus("DELETE khoản của A qua đường dẫn của B → 404", 404, "DELETE", `${urlB}/${ctx.mealId}`, ctx.hrToken);
  const [still] = await conn.query("SELECT amount FROM intern_allowances WHERE id = ?", [ctx.mealId]);
  check("Khoản của A không bị đổi / xóa bởi đường dẫn của B", still.length === 1 && Number(still[0].amount) === 600000);
  await expectStatus("DELETE khoản → 200", 200, "DELETE", `${urlA}/${ctx.transportId}`, ctx.hrToken);
  await expectStatus("DELETE lần hai → 404", 404, "DELETE", `${urlA}/${ctx.transportId}`, ctx.hrToken);
  await expectStatus("DELETE id sai định dạng → 400", 400, "DELETE", `${urlA}/abc`, ctx.hrToken);
  const [gone] = await conn.query("SELECT id FROM intern_allowances WHERE id = ?", [ctx.transportId]);
  check("Khoản đã xóa không còn trong DB", gone.length === 0);
  const [others] = await conn.query("SELECT COUNT(*) AS n FROM intern_allowances WHERE intern_id = ?", [ctx.a.id]);
  check("Xóa một khoản không ảnh hưởng các khoản khác", Number(others[0].n) >= 4);
}

async function testOverview(ctx) {
  console.log("\n== Tổng quan ==");
  const res = await expectStatus("GET /allowances/overview?q=prefix → 200", 200, "GET", `/allowances/overview?q=${PREFIX}`, ctx.hrToken);
  const items = res.body?.data?.items || [];
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  check("Lọc theo q chỉ trả về 3 thực tập sinh của test", items.length === 3, String(items.length));
  check("Thực tập sinh A: có khoản đang hiệu lực và tổng tháng", byId[ctx.a.id]?.activeCount >= 3 && byId[ctx.a.id]?.totalMonthly >= 1750000,
    JSON.stringify(byId[ctx.a.id]));
  check("Thực tập sinh B có 2 khoản", byId[ctx.b.id]?.totalCount === 2);
  check("Thực tập sinh C chưa có khoản nào và chưa có hợp đồng xác nhận",
    byId[ctx.c.id]?.totalCount === 0 && byId[ctx.c.id]?.hasConfirmedContract === false);
  check("Thực tập sinh A có hợp đồng xác nhận", byId[ctx.a.id]?.hasConfirmedContract === true);
  const total = items.reduce((s, i) => s + i.totalMonthly, 0);
  check("summary.totalMonthly bằng tổng các dòng", res.body?.data?.summary?.totalMonthly === total);
  check("summary.internCount đúng", res.body?.data?.summary?.internCount === 3);
  const uni = await call("GET", `/allowances/overview?q=${PREFIX}&university=${encodeURIComponent("Allowance University B")}`, ctx.hrToken);
  check("Lọc theo trường trả về đúng 1 người", uni.status === 200 && uni.body?.data?.items?.length === 1 && uni.body.data.items[0].id === ctx.b.id);
  const none = await call("GET", "/allowances/overview?q=khong_ton_tai_xyz_123", ctx.hrToken);
  check("Không có kết quả → danh sách rỗng", none.status === 200 && none.body?.data?.items?.length === 0);
  await expectStatus("Tham số q lặp lại → 400", 400, "GET", "/allowances/overview?q=a&q=b", ctx.hrToken);
  await expectStatus("Tham số q quá dài → 400", 400, "GET", `/allowances/overview?q=${"x".repeat(101)}`, ctx.hrToken);
}

async function testMyAllowances(ctx, conn) {
  console.log("\n== Thực tập sinh xem phụ cấp của mình (GET /me/allowances) ==");
  await expectStatus("Không token → 401", 401, "GET", "/me/allowances", null);
  await expectStatus("HR → 403", 403, "GET", "/me/allowances", ctx.hrToken);
  await expectStatus("Admin → 403", 403, "GET", "/me/allowances", ctx.adminToken);
  await expectStatus("Mentor → 403", 403, "GET", "/me/allowances", ctx.mentorToken);

  const tokenA = await loginAccount(ctx.a.email);
  const tokenC = await loginAccount(ctx.c.email);
  const res = await expectStatus("Intern A xem phụ cấp của mình → 200", 200, "GET", "/me/allowances", tokenA);
  check("Có Cache-Control: private, no-store", /no-store/.test(res.headers.get("cache-control") || ""));
  const data = res.body?.data;
  const [dbRows] = await conn.query("SELECT id FROM intern_allowances WHERE intern_id = ?", [ctx.a.id]);
  const dbIds = dbRows.map((r) => Number(r.id)).sort((x, y) => x - y);
  const gotIds = (data?.items || []).map((i) => i.id).sort((x, y) => x - y);
  check("Danh sách khớp đúng các khoản của A trong DB", gotIds.length > 0 && JSON.stringify(gotIds) === JSON.stringify(dbIds), `${gotIds} vs ${dbIds}`);
  const [others] = await conn.query("SELECT id FROM intern_allowances WHERE intern_id <> ?", [ctx.a.id]);
  const otherIds = new Set(others.map((r) => Number(r.id)));
  check("Không lẫn khoản của thực tập sinh khác", !gotIds.some((id) => otherIds.has(id)));
  const keys = Object.keys(data.items[0]).sort().join();
  check("Không lộ createdBy / updatedBy / internId", keys === "allowanceType,amount,effectiveFrom,effectiveTo,id,note,payCycle,recordedAt,status", keys);
  check("Có ngày ghi nhận và trạng thái", data.items.every((i) => i.recordedAt && ["ACTIVE", "UPCOMING", "EXPIRED"].includes(i.status)));
  check("Danh sách sắp xếp mới nhất trước (theo ngày bắt đầu)",
    data.items.every((it, idx) => idx === 0 || data.items[idx - 1].effectiveFrom >= it.effectiveFrom));
  check("Số tiền là số nguyên", data.items.every((i) => Number.isInteger(i.amount)));
  check("Có tên và MSSV", typeof data.intern.fullName === "string" && !!data.intern.studentCode);

  const hrView = await call("GET", `/interns/${ctx.a.id}/allowances`, ctx.hrToken);
  const hs = hrView.body.data.summary;
  check("Tổng hợp của thực tập sinh khớp với HR đang thấy",
    data.summary.totalMonthly === hs.totalMonthly && data.summary.totalDaily === hs.totalDaily &&
    data.summary.activeCount === hs.activeCount && data.summary.totalCount === hs.totalCount, JSON.stringify([data.summary, hs]));
  check("Tổng hợp có số khoản sắp hiệu lực / hết hạn",
    data.summary.upcomingCount >= 1 && data.summary.activeCount + data.summary.upcomingCount + data.summary.expiredCount === data.summary.totalCount);

  const active = await call("GET", "/me/allowances?status=ACTIVE", tokenA);
  check("Lọc status=ACTIVE", active.status === 200 && active.body.data.items.length === data.summary.activeCount && active.body.data.items.every((i) => i.status === "ACTIVE"));
  check("Bộ lọc không làm đổi phần tổng hợp", JSON.stringify(active.body.data.summary) === JSON.stringify(data.summary));
  const upcoming = await call("GET", "/me/allowances?status=UPCOMING", tokenA);
  check("Lọc status=UPCOMING", upcoming.status === 200 && upcoming.body.data.items.length === data.summary.upcomingCount && upcoming.body.data.items.every((i) => i.status === "UPCOMING"));
  const byType = await call("GET", "/me/allowances?type=OTHER", tokenA);
  check("Lọc type=OTHER", byType.status === 200 && byType.body.data.items.length >= 1 && byType.body.data.items.every((i) => i.allowanceType === "OTHER"));
  const combo = await call("GET", "/me/allowances?status=ACTIVE&type=MEAL", tokenA);
  check("Lọc kết hợp trạng thái + loại", combo.status === 200 && combo.body.data.items.every((i) => i.status === "ACTIVE" && i.allowanceType === "MEAL"));
  await expectStatus("status sai → 400", 400, "GET", "/me/allowances?status=PAID", tokenA);
  await expectStatus("type sai → 400", 400, "GET", "/me/allowances?type=BONUS", tokenA);
  await expectStatus("Tham số lạ intern_id → 400", 400, "GET", `/me/allowances?intern_id=${ctx.b.id}`, tokenA);
  await expectStatus("Tham số lọc lặp lại → 400", 400, "GET", "/me/allowances?status=ACTIVE&status=EXPIRED", tokenA);

  const mineC = await expectStatus("Intern C (chưa có phụ cấp) → 200", 200, "GET", "/me/allowances", tokenC);
  check("Intern C thấy danh sách rỗng, không thấy khoản của A",
    mineC.body.data.items.length === 0 && mineC.body.data.summary.totalCount === 0 && mineC.body.data.summary.totalMonthly === 0);

  // Thực tập sinh chỉ được đọc: các route ghi của HR vẫn từ chối.
  await expectStatus("Intern gọi POST của HR → 403", 403, "POST", `/interns/${ctx.a.id}/allowances`, tokenA, valid);
  await expectStatus("Intern gọi DELETE của HR → 403", 403, "DELETE", `/interns/${ctx.a.id}/allowances/${gotIds[0]}`, tokenA);
  await expectStatus("Không có route ghi /me/allowances (POST) → 404", 404, "POST", "/me/allowances", tokenA, valid);

  // HR thay đổi → thực tập sinh thấy ngay.
  const before = data.summary.totalMonthly;
  const created = await call("POST", `/interns/${ctx.a.id}/allowances`, ctx.hrToken,
    { allowance_type: "PHONE", amount: 77000, pay_cycle: "MONTHLY", effective_from: D(-20), effective_to: D(-15) });
  check("HR thêm khoản (đã hết hạn) thành công", created.status === 201, JSON.stringify(created.body));
  const after = await call("GET", "/me/allowances?status=EXPIRED", tokenA);
  check("Khoản mới thấy ngay với trạng thái Hết hạn và không làm đổi tổng tháng hiện tại",
    after.body.data.items.some((i) => i.id === created.body.data.id) && after.body.data.summary.totalMonthly === before);
  await call("DELETE", `/interns/${ctx.a.id}/allowances/${created.body.data.id}`, ctx.hrToken);
  const gone = await call("GET", "/me/allowances", tokenA);
  check("HR xóa khoản → thực tập sinh không còn thấy", !gone.body.data.items.some((i) => i.id === created.body.data.id));
}

async function testDbConstraintsAndCascade(ctx, conn) {
  console.log("\n== Ràng buộc DB và xóa theo hồ sơ ==");
  const insert = (amount, from, to) =>
    conn.query(
      `INSERT INTO intern_allowances (intern_id, allowance_type, amount, pay_cycle, effective_from, effective_to)
       VALUES (?, 'MEAL', ?, 'MONTHLY', ?, ?)`, [ctx.c.id, amount, from, to]);
  let rejected = false;
  try { await insert(0, "2026-01-01", null); } catch { rejected = true; }
  check("DB từ chối số tiền = 0 (CHECK)", rejected);
  rejected = false;
  try { await insert(1000, "2026-02-01", "2026-01-01"); } catch { rejected = true; }
  check("DB từ chối ngày kết thúc trước ngày bắt đầu (CHECK)", rejected);
  rejected = false;
  try {
    await conn.query(
      `INSERT INTO intern_allowances (intern_id, allowance_type, amount, pay_cycle, effective_from) VALUES (?, 'MEAL', 1000, 'MONTHLY', '2026-01-01')`,
      [99999999]);
  } catch { rejected = true; }
  check("DB từ chối phụ cấp của thực tập sinh không tồn tại (FK)", rejected);

  const [before] = await conn.query("SELECT COUNT(*) AS n FROM intern_allowances WHERE intern_id = ?", [ctx.b.id]);
  check("Trước khi xóa hồ sơ B có phụ cấp", Number(before[0].n) > 0);
  await conn.query("DELETE FROM intern_profiles WHERE id = ?", [ctx.b.id]);
  const [afterDel] = await conn.query("SELECT COUNT(*) AS n FROM intern_allowances WHERE intern_id = ?", [ctx.b.id]);
  check("Xóa hồ sơ thực tập sinh → phụ cấp bị xóa theo (CASCADE)", Number(afterDel[0].n) === 0);
}

async function run() {
  const emails = [];
  const conn = await mysql.createConnection(readDbConfig());
  try {
    const ctx = await setup(conn, emails);
    await testPermissions(ctx);
    await testValidation(ctx);
    await testContractRules(ctx);
    await testCrud(ctx, conn);
    await testOverlap(ctx, conn);
    await testIdorAndDelete(ctx, conn);
    await testOverview(ctx);
    await testMyAllowances(ctx, conn);
    await testDbConstraintsAndCascade(ctx, conn);
  } catch (err) {
    failed += 1;
    console.error(" [FAIL] Lỗi không mong đợi:", err);
  } finally {
    await conn.end();
    await cleanupTestData(emails);
  }

  console.log(`\n${passed} pass, ${failed} fail\n`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
