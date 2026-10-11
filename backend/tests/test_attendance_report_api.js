// Test API (cần MySQL + backend): báo cáo chuyên cần của HR.
// Dữ liệu được tạo riêng cho từng lần chạy (trường duy nhất để cô lập kết quả) và dọn sạch ở cuối.
const mysql = require("mysql2/promise");
const { BASE_URL, loginAs, readDbConfig, cleanupTestData, confirmContractDirect } = require("./test_helpers");

const RUN_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const PREFIX = `arpt_${RUN_ID}`;
const UNIVERSITY = `UNI_${RUN_ID}`;
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
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}
// Ngày theo giờ Việt Nam (khớp getVietnamToday của backend), offset tính theo ngày.
const vnDate = (offset = 0) => new Date(Date.now() + 7 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
// Thứ 2 của tuần trước (cách hôm nay 7-13 ngày) nên cả tuần đều đã qua, không phụ thuộc hôm nay là thứ mấy.
function lastMonday() {
  const weekday = new Date(`${vnDate()}T00:00:00Z`).getUTCDay(); // 0 = Chủ nhật
  return vnDate(-(((weekday + 6) % 7) + 7));
}
const days = (fn) => [1, 2, 3, 4, 5, 6, 7].map((n) => fn(n));

async function main() {
  const conn = await mysql.createConnection(readDbConfig());
  const emails = [];
  const scheduleIds = [];
  const internIds = [];
  let holidayDate = null;
  try {
    const hr = await loginAs("HR");
    const admin = await loginAs("Admin");
    const mentor = await loginAs("Mentor");
    const monday = lastMonday();
    const [tue, wed, thu, fri, sat, sun] = [1, 2, 3, 4, 5, 6].map((n) => addDays(monday, n));

    async function makeIntern(label) {
      const email = `${PREFIX}_${label}@ictu.edu.vn`;
      emails.push(email);
      const made = await call("POST", "/interns", hr, {
        fullName: `Chuyên cần ${label}`, email, studentCode: `AR${label}${Date.now()}`, university: UNIVERSITY, major: "Software",
      });
      const intern = made.body?.intern || made.body?.student;
      if (![200, 201].includes(made.status) || !intern) throw Error(`Tạo intern ${label}: ${JSON.stringify(made.body)}`);
      internIds.push(Number(intern.id));
      const login = await call("POST", "/auth/login", null, { account: email, password: "password123" });
      return { id: Number(intern.id), token: login.body?.token, fullName: `Chuyên cần ${label}` };
    }
    const a = await makeIntern("A");
    const b = await makeIntern("B");
    if (!a.token || !b.token) throw Error("Không đăng nhập được intern test");
    // A: hợp đồng đủ ngày; B: hợp đồng không giới hạn (ngày bắt đầu/kết thúc để trống).
    await confirmContractDirect(conn, a.id, { startDate: vnDate(-60), endDate: vnDate(60) });
    await confirmContractDirect(conn, b.id, { startDate: null, endDate: null });

    // Lịch riêng cho hai người để kết quả không phụ thuộc lịch mặc định của DB.
    const fixedDays = days((n) => ({ weekday: n, is_working: n <= 5, start_time: n <= 5 ? "08:30" : null, end_time: n <= 5 ? "17:30" : null }));
    const fixed = await call("POST", "/work-schedules", hr, { name: `${PREFIX}_fixed`, mode: "FIXED", grace_minutes: 15, days: fixedDays });
    const flexible = await call("POST", "/work-schedules", hr, {
      name: `${PREFIX}_flex`, mode: "FLEXIBLE", min_daily_minutes: 240, days: days((n) => ({ weekday: n, is_working: n <= 5 })),
    });
    if (fixed.status !== 201 || flexible.status !== 201) throw Error(`Tạo lịch: ${JSON.stringify([fixed.body, flexible.body])}`);
    scheduleIds.push(fixed.body.data.id, flexible.body.data.id);
    const from = vnDate(-400);
    for (const [internId, scheduleId] of [[a.id, fixed.body.data.id], [b.id, flexible.body.data.id]]) {
      const res = await call("POST", "/work-schedules/assignments", hr, {
        schedule_id: scheduleId, target_type: "INTERN", target_value: String(internId), effective_from: from,
      });
      if (res.status !== 201) throw Error(`Gán lịch: ${JSON.stringify(res.body)}`);
    }
    // Thứ 4 là ngày nghỉ chung (nếu đã có sẵn thì dùng luôn và không xóa khi dọn dẹp).
    const holiday = await call("POST", "/work-holidays", hr, { holiday_date: wed, name: `Nghỉ test ${RUN_ID}` });
    if (holiday.status === 201) holidayDate = wed;
    else if (holiday.status !== 409) throw Error(`Tạo ngày nghỉ: ${JSON.stringify(holiday.body)}`);

    // Dữ liệu chấm công và nghỉ phép đặt trực tiếp vì API chỉ chấm công cho hôm nay.
    const rec = (internId, date, inAt, outAt) =>
      conn.query("INSERT INTO attendance_records (intern_id, work_date, check_in_at, check_out_at) VALUES (?,?,?,?)",
        [internId, date, `${date} ${inAt}`, outAt ? `${date} ${outAt}` : null]);
    await rec(a.id, monday, "08:20:00", "17:40:00"); // đúng giờ
    await rec(a.id, tue, "08:50:00", "17:30:00"); // đi muộn (> 08:45)
    await rec(a.id, sat, "09:00:00", "12:00:00"); // làm ngoài lịch
    await rec(b.id, monday, "09:00:00", "11:00:00"); // thiếu giờ (120 < 240)
    const leave = (internId, date, status) =>
      conn.query("INSERT INTO leave_requests (intern_id, leave_type, from_date, to_date, reason, status) VALUES (?,?,?,?,?,?)",
        [internId, "SICK", date, date, "Nghỉ test", status]);
    await leave(a.id, thu, "APPROVED");
    await leave(a.id, fri, "PENDING");
    const mentorRow = (await conn.query("SELECT id FROM mentors WHERE LOWER(email)=?", ["mentor@gmail.com"]))[0][0];
    if (mentorRow) await conn.query("UPDATE intern_profiles SET mentor_id=? WHERE id=?", [mentorRow.id, a.id]);

    const scope = `scope_type=UNIVERSITY&scope_value=${encodeURIComponent(UNIVERSITY)}`;
    const base = `/attendance/report?from=${monday}&to=${sun}&${scope}`;

    // ---------- Quyền truy cập ----------
    check("Không token bị chặn (401)", (await call("GET", base)).status === 401);
    check("Mentor không xem được báo cáo (403)", (await call("GET", base, mentor)).status === 403);
    check("Admin không xem được báo cáo (403)", (await call("GET", base, admin)).status === 403);
    check("Thực tập sinh không xem được báo cáo (403)", (await call("GET", base, a.token)).status === 403);
    check("Chi tiết từng ngày chặn người không phải HR", (await call("GET", `/attendance/report/interns/${a.id}/days?from=${monday}&to=${sun}`, mentor)).status === 403);
    check("CSV chặn người không phải HR", (await call("GET", `/attendance/report/export.csv?from=${monday}&to=${sun}`, a.token)).status === 403);

    // ---------- Số liệu ----------
    const report = await call("GET", base, hr);
    check("HR xem báo cáo thành công và không cache", report.status === 200 && /no-store/.test(report.headers.get("cache-control") || ""));
    const data = report.body?.data;
    const rowA = data?.interns?.find((x) => x.intern.id === a.id);
    const rowB = data?.interns?.find((x) => x.intern.id === b.id);
    check("Phạm vi theo trường chỉ có đúng 2 thực tập sinh test", data?.interns?.length === 2 && !!rowA && !!rowB, JSON.stringify(data?.interns?.map((x) => x.intern.id)));
    check("A: phải đi 4, có mặt 2, nghỉ phép 1, chờ duyệt nghỉ 1, vắng 0",
      rowA && [rowA.requiredDays, rowA.presentDays, rowA.leaveDays, rowA.pendingLeaveDays, rowA.absentDays].join() === "4,2,1,1,0", JSON.stringify(rowA));
    check("A: 1 lượt đi muộn, 1 ngày làm ngoài lịch, tỷ lệ 66.7%",
      rowA && rowA.lateCount === 1 && rowA.offScheduleDays === 1 && rowA.attendanceRate === 66.7, JSON.stringify(rowA));
    check("A: tổng giờ làm cộng cả ngày làm ngoài lịch", rowA?.totalWorkMinutes === 560 + 520 + 180, String(rowA?.totalWorkMinutes));
    check("B (hợp đồng không giới hạn, lịch linh hoạt): phải đi 4, có mặt 1, vắng 3, thiếu giờ 1, tỷ lệ 25%",
      rowB && [rowB.requiredDays, rowB.presentDays, rowB.absentDays, rowB.shortHoursCount, rowB.attendanceRate].join() === "4,1,3,1,25", JSON.stringify(rowB));
    check("Báo cáo ghi lịch đang áp dụng cho từng người", rowA?.scheduleName === `${PREFIX}_fixed` && rowB?.scheduleName === `${PREFIX}_flex` && rowA?.scheduleSource === "Cá nhân");
    check("Tổng hợp: 2 người, tỷ lệ chung 42.9%, có đơn nghỉ chờ duyệt",
      data?.summary?.totalInterns === 2 && data.summary.requiredDays === 8 && data.summary.attendanceRate === 42.9 && data.summary.pendingLeaveRequests >= 1, JSON.stringify(data?.summary));
    check("Danh sách không kèm chi tiết từng ngày", rowA && !("days" in rowA));

    // ---------- Lọc và nhóm ----------
    const mentorScope = mentorRow ? `scope_type=MENTOR&scope_value=${mentorRow.id}` : null;
    if (mentorScope) {
      const mine = await call("GET", `/attendance/report?from=${monday}&to=${sun}&${mentorScope}&intern_id=${a.id}`, hr);
      const other = await call("GET", `/attendance/report?from=${monday}&to=${sun}&${mentorScope}&intern_id=${b.id}`, hr);
      check("Lọc theo mentor: chỉ thấy người do mentor phụ trách", mine.body?.data?.interns?.length === 1 && other.body?.data?.interns?.length === 0);
    }
    const one = await call("GET", `${base}&intern_id=${b.id}`, hr);
    check("Lọc theo một thực tập sinh", one.body?.data?.interns?.length === 1 && one.body.data.interns[0].intern.id === b.id);
    const grouped = await call("GET", `${base}&group_by=UNIVERSITY`, hr);
    const group = grouped.body?.data?.groups?.find((g) => g.name === UNIVERSITY);
    check("Nhóm theo trường", group && group.totalInterns === 2 && group.requiredDays === 8, JSON.stringify(grouped.body?.data?.groups));
    check("Không nhóm thì groups rỗng", Array.isArray(data?.groups) && data.groups.length === 0);
    const none = await call("GET", `/attendance/report?from=${monday}&to=${sun}&scope_type=UNIVERSITY&scope_value=${encodeURIComponent(UNIVERSITY + "_khac")}`, hr);
    check("Phạm vi không có ai trả danh sách rỗng", none.status === 200 && none.body?.data?.interns?.length === 0 && none.body.data.summary.attendanceRate === null);

    // ---------- Kiểm tra tham số ----------
    for (const [label, query] of [
      ["intern_id không phải số", `from=${monday}&to=${sun}&intern_id=abc`],
      ["ngày bắt đầu sau ngày kết thúc", `from=${sun}&to=${monday}`],
      ["ngày sai định dạng", "from=2026-13-45"],
      ["khoảng ngày quá 366", `from=${vnDate(-400)}&to=${vnDate()}`],
      ["phạm vi sai", `scope_type=KHAC`],
      ["thiếu giá trị phạm vi", `scope_type=PROGRAM`],
      ["giá trị phạm vi không phải số", `scope_type=MENTOR&scope_value=abc`],
      ["cách nhóm sai", `group_by=KHAC`],
      ["tham số lạ", `foo=bar`],
    ]) check(`Báo cáo từ chối: ${label}`, (await call("GET", `/attendance/report?${query}`, hr)).status === 400);

    // ---------- Chi tiết từng ngày ----------
    const detail = await call("GET", `/attendance/report/interns/${a.id}/days?from=${monday}&to=${sun}`, hr);
    const statuses = detail.body?.data?.days?.map((d) => d.status).join();
    check("Chi tiết A: trạng thái 7 ngày trong tuần",
      statuses === "PRESENT,PRESENT,HOLIDAY,LEAVE,ABSENT_PENDING_LEAVE,DAY_OFF,DAY_OFF", statuses);
    check("Chi tiết A: cờ đi muộn vào thứ 3", JSON.stringify(detail.body?.data?.days?.[1]?.flags) === '["LATE"]');
    check("Chi tiết trả về lịch áp dụng của từng ngày", detail.body?.data?.days?.[0]?.schedule?.sourceLabel === "Cá nhân");
    check("Chi tiết: ID không hợp lệ trả 400", (await call("GET", "/attendance/report/interns/abc/days", hr)).status === 400);
    check("Chi tiết: không tồn tại trả 404", (await call("GET", "/attendance/report/interns/999999999/days", hr)).status === 404);

    // ---------- Xuất CSV ----------
    const csv = await fetch(`${BASE_URL}/attendance/report/export.csv?from=${monday}&to=${sun}&${scope}`, { headers: { Authorization: `Bearer ${hr}` } });
    const bytes = Buffer.from(await csv.arrayBuffer());
    const text = bytes.toString("utf8");
    check("CSV: đúng loại, tên file và không cache",
      csv.status === 200 && /text\/csv/.test(csv.headers.get("content-type") || "") &&
        (csv.headers.get("content-disposition") || "").includes(`bao-cao-chuyen-can_${monday}_${sun}.csv`) &&
        /no-store/.test(csv.headers.get("cache-control") || ""));
    check("CSV: có BOM UTF-8 cho Excel", bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf);
    const lines = text.replace(/^\uFEFF/, "").split("\r\n");
    check("CSV: tiêu đề và đúng 2 dòng dữ liệu", lines.length === 3 && lines[0].startsWith('"Họ tên"'), `${lines.length} dòng`);
    check("CSV: có số liệu của A", lines.some((l) => l.includes(a.fullName) && l.includes('"66.7"')));
    check("CSV: tham số sai trả 400", (await fetch(`${BASE_URL}/attendance/report/export.csv?from=${sun}&to=${monday}`, { headers: { Authorization: `Bearer ${hr}` } })).status === 400);
  } catch (e) {
    failed++;
    console.error("[FAIL] attendance report API setup/flow:", e.message);
  } finally {
    try {
      if (scheduleIds.length) {
        await conn.query("DELETE FROM work_schedule_assignments WHERE schedule_id IN (?)", [scheduleIds]);
        await conn.query("DELETE FROM work_schedules WHERE id IN (?) AND id <> 1", [scheduleIds]);
      }
      if (internIds.length) await conn.query("DELETE FROM work_schedule_assignments WHERE target_type='INTERN' AND target_value IN (?)", [internIds.map(String)]);
      if (holidayDate) await conn.query("DELETE FROM work_holidays WHERE holiday_date=?", [holidayDate]);
      await cleanupTestData(emails);
    } catch (e) {
      failed++;
      console.error("[FAIL] attendance report cleanup:", e.message);
    }
    await conn.end();
    console.log(`Attendance report API: ${passed} PASS / ${failed} FAIL`);
    if (failed) process.exitCode = 1;
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
