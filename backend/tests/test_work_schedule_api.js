// Test API (cần MySQL + backend): lịch làm việc, ngày nghỉ chung và nghỉ phép.
// Dữ liệu tạo riêng cho từng lần chạy và được dọn sạch ở cuối.
const mysql = require("mysql2/promise");
const { BASE_URL, loginAs, readDbConfig, cleanupTestData, confirmContractDirect } = require("./test_helpers");

const RUN_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const PREFIX = `wsch_${RUN_ID}`;
const UNIVERSITY = `UNI_${RUN_ID}`;
const HOLIDAY_DATE = "2098-05-05"; // ngày xa trong tương lai, không ảnh hưởng dữ liệu thật
let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`[PASS] ${name}`);
  } else {
    failed++;
    console.error(`[FAIL] ${name}${detail ? ": " + detail : ""}`);
  }
}
async function call(method, url, token, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE_URL + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const vnDate = (offset = 0) => new Date(Date.now() + 7 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const weekDays = (fn) => [1, 2, 3, 4, 5, 6, 7].map((n) => fn(n));
const fixedBody = (name, over = {}) => ({
  name, mode: "FIXED", grace_minutes: 15,
  days: weekDays((n) => ({ weekday: n, is_working: n <= 5, start_time: n <= 5 ? "08:30" : null, end_time: n <= 5 ? "17:30" : null })),
  ...over,
});
const flexBody = (name, over = {}) => ({
  name, mode: "FLEXIBLE", min_daily_minutes: 240, days: weekDays((n) => ({ weekday: n, is_working: n <= 5 })), ...over,
});

async function main() {
  const conn = await mysql.createConnection(readDbConfig());
  const emails = [];
  const scheduleIds = [];
  const internIds = [];
  try {
    const hr = await loginAs("HR");
    const admin = await loginAs("Admin");
    const mentor = await loginAs("Mentor");

    async function makeIntern(label) {
      const email = `${PREFIX}_${label}@ictu.edu.vn`;
      emails.push(email);
      const made = await call("POST", "/interns", hr, {
        fullName: `Lịch ${label}`, email, studentCode: `WS${label}${Date.now()}`, university: UNIVERSITY, major: "Software",
      });
      const intern = made.body?.intern || made.body?.student;
      if (![200, 201].includes(made.status) || !intern) throw Error(`Tạo intern ${label}: ${JSON.stringify(made.body)}`);
      internIds.push(Number(intern.id));
      await confirmContractDirect(conn, Number(intern.id), { startDate: vnDate(-30), endDate: vnDate(60) });
      const login = await call("POST", "/auth/login", null, { account: email, password: "password123" });
      return { id: Number(intern.id), token: login.body?.token, fullName: `Lịch ${label}` };
    }
    const a = await makeIntern("A");
    const b = await makeIntern("B");
    if (!a.token || !b.token) throw Error("Không đăng nhập được intern test");

    // ======================= Quyền truy cập lịch làm việc =======================
    check("Lịch: không token bị chặn (401)", (await call("GET", "/work-schedules")).status === 401);
    check("Lịch: Mentor không xem được (403)", (await call("GET", "/work-schedules", mentor)).status === 403);
    check("Lịch: thực tập sinh không xem được (403)", (await call("GET", "/work-schedules", a.token)).status === 403);
    const list = await call("GET", "/work-schedules", hr);
    const defaultSchedule = list.body?.data?.find((s) => s.id === 1);
    check("HR xem danh sách, có lịch mặc định kèm tóm tắt", list.status === 200 && !!defaultSchedule && typeof defaultSchedule.summary === "string" && defaultSchedule.days.length === 7);
    check("Admin xem được danh sách", (await call("GET", "/work-schedules", admin)).status === 200);
    check("Admin không được tạo lịch (403)", (await call("POST", "/work-schedules", admin, fixedBody(`${PREFIX}_admin`))).status === 403);

    // ======================= Tạo, sửa, xóa mẫu lịch =======================
    const fixedName = `${PREFIX}_fixed`;
    const created = await call("POST", "/work-schedules", hr, fixedBody(fixedName));
    check("Tạo lịch giờ cố định (201) kèm tóm tắt", created.status === 201 && created.body?.data?.summary === "T2–T6 08:30–17:30", JSON.stringify(created.body));
    const fixedId = created.body?.data?.id;
    if (fixedId) scheduleIds.push(fixedId);
    check("Tên lịch trùng bị từ chối (409)", (await call("POST", "/work-schedules", hr, fixedBody(fixedName))).status === 409);
    for (const [label, body] of [
      ["giờ kết thúc không sau giờ bắt đầu", fixedBody(`${PREFIX}_x1`, { days: weekDays((n) => ({ weekday: n, is_working: true, start_time: "09:00", end_time: "08:00" })) })],
      ["thiếu 1 ngày trong tuần", fixedBody(`${PREFIX}_x2`, { days: fixedBody("x").days.slice(0, 6) })],
      ["không có ngày làm việc nào", fixedBody(`${PREFIX}_x3`, { days: weekDays((n) => ({ weekday: n, is_working: false })) })],
      ["dung sai quá 120 phút", fixedBody(`${PREFIX}_x4`, { grace_minutes: 121 })],
      ["trường dữ liệu lạ", fixedBody(`${PREFIX}_x5`, { extra: 1 })],
      ["lịch linh hoạt thiếu số phút tối thiểu", flexBody(`${PREFIX}_x6`, { min_daily_minutes: undefined })],
      ["chế độ không hợp lệ", fixedBody(`${PREFIX}_x7`, { mode: "KHAC" })],
    ]) check(`Tạo lịch từ chối: ${label}`, (await call("POST", "/work-schedules", hr, body)).status === 400);
    const flex = await call("POST", "/work-schedules", hr, flexBody(`${PREFIX}_flex`));
    check("Tạo lịch giờ linh hoạt (201)", flex.status === 201 && /linh hoạt/.test(flex.body?.data?.summary || ""), JSON.stringify(flex.body));
    const flexId = flex.body?.data?.id;
    if (flexId) scheduleIds.push(flexId);
    check("Xem một lịch (200)", (await call("GET", `/work-schedules/${fixedId}`, hr)).body?.data?.name === fixedName);
    check("Xem lịch không tồn tại (404)", (await call("GET", "/work-schedules/999999999", hr)).status === 404);
    check("Xem lịch ID sai (400)", (await call("GET", "/work-schedules/abc", hr)).status === 400);
    const renamed = await call("PUT", `/work-schedules/${fixedId}`, hr, { name: `${fixedName}_v2` });
    check("Đổi tên lịch (chỉ gửi một trường)", renamed.status === 200 && renamed.body?.data?.name === `${fixedName}_v2` && renamed.body.data.mode === "FIXED");
    check("Sửa ngày với giờ sai bị từ chối", (await call("PUT", `/work-schedules/${fixedId}`, hr, { days: fixedBody("x").days.map((d) => ({ ...d, end_time: "07:00" })) })).status === 400);
    check("Đổi lịch linh hoạt sang cố định mà không nhập giờ bị từ chối", (await call("PUT", `/work-schedules/${flexId}`, hr, { mode: "FIXED" })).status === 400);
    const retimed = await call("PUT", `/work-schedules/${flexId}`, hr, { min_daily_minutes: 300 });
    check("Sửa số phút tối thiểu của lịch linh hoạt", retimed.status === 200 && retimed.body?.data?.minDailyMinutes === 300);
    check("Sửa lịch không tồn tại (404)", (await call("PUT", "/work-schedules/999999999", hr, { name: "x" })).status === 404);

    // ======================= Áp dụng lịch cho nhóm =======================
    const assign = (over) => call("POST", "/work-schedules/assignments", hr, { schedule_id: fixedId, target_type: "INTERN", target_value: String(a.id), effective_from: vnDate(-10), ...over });
    check("Áp dụng cho thực tập sinh không tồn tại (404)", (await assign({ target_value: "999999999" })).status === 404);
    check("Áp dụng cho lịch không tồn tại (404)", (await assign({ schedule_id: 999999999 })).status === 404);
    for (const [label, over] of [
      ["loại phạm vi sai", { target_type: "KHAC" }], ["giá trị phạm vi không phải số", { target_value: "abc" }],
      ["thiếu ngày hiệu lực", { effective_from: undefined }], ["ngày hiệu lực sai", { effective_from: "2026-13-01" }],
      ["ngày kết thúc trước ngày hiệu lực", { effective_to: vnDate(-20) }], ["trường lạ", { extra: 1 }],
    ]) check(`Áp dụng từ chối: ${label}`, (await assign(over)).status === 400);
    check("Admin không được áp dụng lịch (403)", (await call("POST", "/work-schedules/assignments", admin, { schedule_id: fixedId, target_type: "INTERN", target_value: String(a.id), effective_from: vnDate(-10) })).status === 403);
    const first = await assign({});
    check("Áp dụng lịch cố định cho A (201)", first.status === 201 && first.body?.data?.id > 0, JSON.stringify(first.body));
    check("Áp dụng trùng ngày hiệu lực bị từ chối (409)", (await assign({})).status === 409);
    const second = await assign({ schedule_id: flexId, effective_from: vnDate(-2) });
    check("Áp dụng lịch mới cho A từ ngày sau (201)", second.status === 201);
    const assignments = await call("GET", "/work-schedules/assignments", hr);
    const defaultRows = assignments.body?.data?.filter((x) => x.targetType === "DEFAULT" && x.effectiveFrom === "1970-01-01") || [];
    check("Lịch mặc định chỉ có đúng một dòng áp dụng (không bị nhân bản sau mỗi lần khởi động)", defaultRows.length === 1, `${defaultRows.length} dòng`);
    const closed = assignments.body?.data?.find((x) => x.id === first.body?.data?.id);
    check("Lần áp dụng cũ tự kết thúc vào ngày hôm trước", closed?.effectiveTo === vnDate(-3), JSON.stringify(closed));
    check("Danh sách áp dụng có nhãn dễ đọc và tóm tắt lịch", assignments.body?.data?.some((x) => x.id === second.body?.data?.id && x.targetLabel === "Cá nhân" && /linh hoạt/.test(x.scheduleSummary)));
    const resolved = await call("GET", "/work-schedules/resolved", hr);
    const rowA = resolved.body?.data?.find((x) => x.intern.id === a.id);
    check("Lịch đang áp dụng của A là lịch linh hoạt theo phạm vi cá nhân", rowA?.schedule?.name === `${PREFIX}_flex` && rowA.source?.label === "Cá nhân", JSON.stringify(rowA));
    const rowB = resolved.body?.data?.find((x) => x.intern.id === b.id);
    check("B không có lịch riêng nên dùng lịch của phạm vi rộng hơn", !!rowB && rowB.source?.type !== "INTERN", JSON.stringify(rowB));
    const preview = await call("GET", `/work-schedules/preview?target_type=INTERN&target_value=${a.id}`, hr);
    check("Xem trước phạm vi cá nhân: đúng 1 người", preview.status === 200 && preview.body?.data?.count === 1 && preview.body.data.interns[0].id === a.id);
    const previewUni = await call("GET", `/work-schedules/preview?target_type=UNIVERSITY&target_value=${encodeURIComponent(UNIVERSITY)}`, hr);
    check("Xem trước theo trường: 2 người, 1 người bị lịch cá nhân ghi đè", previewUni.body?.data?.count === 2 && previewUni.body.data.overriddenCount === 1, JSON.stringify(previewUni.body));
    check("Xem trước tham số sai (400)", (await call("GET", "/work-schedules/preview?target_type=KHAC", hr)).status === 400);
    const options = await call("GET", "/work-schedules/options", hr);
    check("Danh sách phạm vi chứa trường và thực tập sinh test", options.body?.data?.universities?.includes(UNIVERSITY) && options.body.data.interns.some((x) => x.id === a.id));
    check("Danh sách phạm vi chặn thực tập sinh (403)", (await call("GET", "/work-schedules/options", a.token)).status === 403);

    // ======================= Xóa =======================
    check("Không xóa được lịch đang được áp dụng (409)", (await call("DELETE", `/work-schedules/${flexId}`, hr)).status === 409);
    check("Không xóa được lịch mặc định (409)", (await call("DELETE", "/work-schedules/1", hr)).status === 409);
    const defaultAssignment = assignments.body?.data?.find((x) => x.targetType === "DEFAULT");
    if (defaultAssignment) check("Không xóa được lần áp dụng mặc định (404)", (await call("DELETE", `/work-schedules/assignments/${defaultAssignment.id}`, hr)).status === 404);
    check("Xóa một lần áp dụng (200)", (await call("DELETE", `/work-schedules/assignments/${first.body?.data?.id}`, hr)).status === 200);
    check("Xóa lại lần áp dụng đã xóa (404)", (await call("DELETE", `/work-schedules/assignments/${first.body?.data?.id}`, hr)).status === 404);
    const spare = await call("POST", "/work-schedules", hr, fixedBody(`${PREFIX}_spare`));
    check("Xóa lịch chưa dùng (200)", (await call("DELETE", `/work-schedules/${spare.body?.data?.id}`, hr)).status === 200);
    check("Xóa lại lịch đã xóa (409)", (await call("DELETE", `/work-schedules/${spare.body?.data?.id}`, hr)).status === 409);
    check("Lịch cố định đã hết áp dụng thì xóa được (200)", (await call("DELETE", `/work-schedules/${fixedId}`, hr)).status === 200);

    // ======================= Ngày nghỉ chung =======================
    await conn.query("DELETE FROM work_holidays WHERE holiday_date=?", [HOLIDAY_DATE]);
    check("Ngày nghỉ: ngày sai bị từ chối", (await call("POST", "/work-holidays", hr, { holiday_date: "2098-13-45", name: "x" })).status === 400);
    check("Ngày nghỉ: thiếu tên bị từ chối", (await call("POST", "/work-holidays", hr, { holiday_date: HOLIDAY_DATE, name: " " })).status === 400);
    check("Admin không được thêm ngày nghỉ (403)", (await call("POST", "/work-holidays", admin, { holiday_date: HOLIDAY_DATE, name: "x" })).status === 403);
    const holiday = await call("POST", "/work-holidays", hr, { holiday_date: HOLIDAY_DATE, name: `Nghỉ test ${RUN_ID}` });
    check("Thêm ngày nghỉ chung (201)", holiday.status === 201 && holiday.body?.data?.id > 0, JSON.stringify(holiday.body));
    check("Thêm trùng ngày nghỉ bị từ chối (409)", (await call("POST", "/work-holidays", hr, { holiday_date: HOLIDAY_DATE, name: "Trùng" })).status === 409);
    check("Danh sách ngày nghỉ có ngày vừa thêm", (await call("GET", "/work-holidays", admin)).body?.data?.some((h) => h.holidayDate === HOLIDAY_DATE));
    check("Xóa ngày nghỉ (200)", (await call("DELETE", `/work-holidays/${holiday.body?.data?.id}`, hr)).status === 200);
    check("Xóa lại ngày nghỉ (404)", (await call("DELETE", `/work-holidays/${holiday.body?.data?.id}`, hr)).status === 404);

    // ======================= Lịch của thực tập sinh =======================
    const mine = await call("GET", "/me/work-schedule", a.token);
    check("Thực tập sinh xem lịch của mình kèm nguồn và quy tắc hôm nay",
      mine.status === 200 && mine.body?.data?.schedule?.name === `${PREFIX}_flex` && mine.body.data.source?.label === "Cá nhân" && typeof mine.body.data.today?.rule?.isWorkingDay === "boolean", JSON.stringify(mine.body));
    check("HR không dùng được /me/work-schedule (403)", (await call("GET", "/me/work-schedule", hr)).status === 403);
    const today = await call("GET", "/me/attendance/today", a.token);
    check("Trạng thái chấm công hôm nay có thêm lịch làm việc, giữ nguyên trường cũ",
      today.status === 200 && !!today.body?.data?.schedule?.schedule?.name && "canCheckIn" in today.body.data && "status" in today.body.data);

    // ======================= Nghỉ phép =======================
    const leave = (token, over) => call("POST", "/me/leaves", token, { leave_type: "SICK", from_date: vnDate(3), to_date: vnDate(4), reason: "Ốm", ...over });
    check("Nghỉ phép: không token bị chặn (401)", (await call("GET", "/me/leaves")).status === 401);
    check("Nghỉ phép: HR không xin nghỉ được (403)", (await leave(hr)).status === 403);
    check("Nghỉ phép: Mentor không xem được danh sách đơn của HR (403)", (await call("GET", "/leaves", mentor)).status === 403);
    check("Nghỉ phép: thực tập sinh không xem danh sách của HR (403)", (await call("GET", "/leaves", a.token)).status === 403);
    for (const [label, over] of [
      ["ngày bắt đầu sau ngày kết thúc", { from_date: vnDate(5), to_date: vnDate(4) }], ["thiếu lý do", { reason: "  " }],
      ["loại nghỉ sai", { leave_type: "KHAC" }], ["trường lạ", { extra: 1 }], ["quá 30 ngày", { to_date: vnDate(40) }],
      ["nộp bù quá 7 ngày", { from_date: vnDate(-9), to_date: vnDate(-9) }], ["ngày sai định dạng", { from_date: "2026-13-01" }],
    ]) check(`Nghỉ phép từ chối: ${label}`, (await leave(a.token, over)).status === 400);
    check("Nghỉ phép: ngoài thời gian hợp đồng (409)", (await leave(a.token, { from_date: vnDate(59), to_date: vnDate(62) })).status === 409);
    const l1 = await leave(a.token, {});
    check("Nghỉ phép: gửi đơn hợp lệ (201)", l1.status === 201 && l1.body?.data?.id > 0, JSON.stringify(l1.body));
    const leaveId = l1.body?.data?.id;
    check("Nghỉ phép: chồng với đơn đang chờ bị từ chối (409)", (await leave(a.token, { from_date: vnDate(4), to_date: vnDate(5) })).status === 409);
    const mineLeaves = await call("GET", "/me/leaves", a.token);
    check("Nghỉ phép: A thấy đơn của mình, trạng thái chờ duyệt", mineLeaves.body?.data?.some((l) => l.id === leaveId && l.status === "PENDING"));
    check("Nghỉ phép: B không thấy đơn của A", !(await call("GET", "/me/leaves", b.token)).body?.data?.some((l) => l.id === leaveId));
    check("Nghỉ phép: B không hủy được đơn của A (409)", (await call("POST", `/me/leaves/${leaveId}/cancel`, b.token)).status === 409);

    const hrPending = await call("GET", "/leaves/pending", hr);
    check("HR thấy đơn chờ duyệt kèm tên thực tập sinh", hrPending.body?.data?.some((l) => l.id === leaveId && l.fullName === a.fullName), JSON.stringify(hrPending.body?.data?.slice(0, 2)));
    check("Mentor chưa phụ trách A nên không thấy đơn", !(await call("GET", "/leaves/pending", mentor)).body?.data?.some((l) => l.id === leaveId));
    check("Mentor chưa phụ trách A không duyệt được (403)", (await call("POST", `/leaves/${leaveId}/review`, mentor, { decision: "APPROVED" })).status === 403);
    check("Thực tập sinh không duyệt được đơn (403)", (await call("POST", `/leaves/${leaveId}/review`, a.token, { decision: "APPROVED" })).status === 403);
    check("Duyệt với quyết định sai (400)", (await call("POST", `/leaves/${leaveId}/review`, hr, { decision: "MAYBE" })).status === 400);
    check("Từ chối phải có lý do (400)", (await call("POST", `/leaves/${leaveId}/review`, hr, { decision: "REJECTED" })).status === 400);
    check("Duyệt đơn không tồn tại (404)", (await call("POST", "/leaves/999999999/review", hr, { decision: "APPROVED" })).status === 404);

    const mentorRow = (await conn.query("SELECT id FROM mentors WHERE LOWER(email)=?", ["mentor@gmail.com"]))[0][0];
    if (mentorRow) {
      await conn.query("UPDATE intern_profiles SET mentor_id=? WHERE id=?", [mentorRow.id, a.id]);
      check("Mentor phụ trách A thấy đơn chờ duyệt", (await call("GET", "/leaves/pending", mentor)).body?.data?.some((l) => l.id === leaveId));
      check("Mentor phụ trách duyệt đơn (200)", (await call("POST", `/leaves/${leaveId}/review`, mentor, { decision: "APPROVED" })).status === 200);
    } else {
      check("HR duyệt đơn (200)", (await call("POST", `/leaves/${leaveId}/review`, hr, { decision: "APPROVED" })).status === 200);
    }
    check("Duyệt lần hai bị từ chối (409)", (await call("POST", `/leaves/${leaveId}/review`, hr, { decision: "APPROVED" })).status === 409);
    const approved = await call("GET", `/leaves?status=APPROVED&intern_id=${a.id}`, hr);
    check("HR lọc đơn đã duyệt theo thực tập sinh", approved.status === 200 && approved.body?.data?.some((l) => l.id === leaveId && l.studentCode));
    for (const [label, query] of [["trạng thái sai", "status=KHAC"], ["intern_id sai", "intern_id=0"], ["ngày sai", "from=xx"], ["tham số lạ", "foo=1"]])
      check(`Danh sách đơn từ chối: ${label}`, (await call("GET", `/leaves?${query}`, hr)).status === 400);

    const cancelled = await call("POST", `/me/leaves/${leaveId}/cancel`, a.token);
    check("A hủy đơn đã duyệt khi chưa tới ngày nghỉ (200)", cancelled.status === 200);
    check("Hủy lại đơn đã hủy bị từ chối (409)", (await call("POST", `/me/leaves/${leaveId}/cancel`, a.token)).status === 409);
    check("Đơn đã hủy hiển thị trạng thái CANCELLED", (await call("GET", `/leaves?status=CANCELLED&intern_id=${a.id}`, hr)).body?.data?.some((l) => l.id === leaveId));
    const l2 = await leave(a.token, {});
    check("Sau khi hủy có thể nộp lại đúng khoảng ngày đó (201)", l2.status === 201);
    check("HR từ chối đơn kèm lý do (200)", (await call("POST", `/leaves/${l2.body?.data?.id}/review`, hr, { decision: "REJECTED", note: "Trùng lịch bảo vệ" })).status === 200);
    check("Đơn bị từ chối không chặn nộp lại (201)", (await leave(a.token, {})).status === 201);
    const rejected = (await call("GET", "/me/leaves", a.token)).body?.data?.find((l) => l.id === l2.body?.data?.id);
    check("Thực tập sinh thấy lý do từ chối", rejected?.status === "REJECTED" && rejected.reviewNote === "Trùng lịch bảo vệ");

    const checkIn = await call("POST", "/me/attendance/check-in", b.token, {});
    if ([200, 201].includes(checkIn.status)) {
      check("Không xin nghỉ cho ngày đã chấm công (409)", (await leave(b.token, { from_date: vnDate(), to_date: vnDate() })).status === 409);
    } else {
      check("Check-in hôm nay để kiểm tra xung đột nghỉ phép", false, JSON.stringify(checkIn.body));
    }
  } catch (e) {
    failed++;
    console.error("[FAIL] work schedule API setup/flow:", e.message);
  } finally {
    try {
      if (scheduleIds.length) {
        await conn.query("DELETE FROM work_schedule_assignments WHERE schedule_id IN (?)", [scheduleIds]);
        await conn.query("DELETE FROM work_schedules WHERE id IN (?) AND id <> 1", [scheduleIds]);
      }
      if (internIds.length) await conn.query("DELETE FROM work_schedule_assignments WHERE target_type='INTERN' AND target_value IN (?)", [internIds.map(String)]);
      await conn.query("DELETE FROM work_holidays WHERE holiday_date=?", [HOLIDAY_DATE]);
      await cleanupTestData(emails);
    } catch (e) {
      failed++;
      console.error("[FAIL] work schedule cleanup:", e.message);
    }
    await conn.end();
    console.log(`Work schedule API: ${passed} PASS / ${failed} FAIL`);
    if (failed) process.exitCode = 1;
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
