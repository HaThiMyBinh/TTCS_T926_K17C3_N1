function openScheduleManager(internId, internName) {
  scheduleManagerInternId = Number(internId);
  scheduleManagerInternName = internName || "";
  document.getElementById("scheduleManagerInternName").textContent =
    scheduleManagerInternName;
  document.getElementById("scheduleManagerModal").classList.add("open");
  resetScheduleMilestoneForm();
  loadScheduleMilestones();
}

function closeScheduleManager() {
  document.getElementById("scheduleManagerModal").classList.remove("open");
}

function resetScheduleMilestoneForm() {
  document.getElementById("scheduleMilestoneForm").reset();
  document.getElementById("scheduleMilestoneId").value = "";
  document.getElementById("scheduleSaveButton").textContent = "Thêm mốc";
}

async function loadScheduleMilestones() {
  const list = document.getElementById("scheduleMilestonesList");
  const message = document.getElementById("scheduleManagerMessage");
  list.innerHTML = `<p style="color:#94a3b8">Đang tải mốc lịch...</p>`;
  message.textContent = "";
  try {
    const response = await fetch(
      `${API_BASE}/interns/${scheduleManagerInternId}/schedule`,
      { headers: authHeaders() },
    );
    if (response.status === 401)
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    const body = await response.json();
    if (!response.ok || !body.success)
      throw new Error(body.message || "Không tải được lịch.");
    scheduleMilestones = Array.isArray(body.data?.milestones)
      ? body.data.milestones
      : [];
    if (body.data?.schedule_sync_warning)
      message.innerHTML = `<span style="color:#b45309">${escapeHtml(body.data.schedule_sync_warning)}</span>`;
    renderScheduleMilestones();
  } catch (err) {
    list.innerHTML = `<p style="color:#b91c1c">${escapeHtml(err.message || "Không tải được lịch.")}</p>`;
  }
}

function renderScheduleMilestones() {
  const list = document.getElementById("scheduleMilestonesList");
  if (!scheduleMilestones.length) {
    list.innerHTML = `<p style="color:#64748b;padding:10px 0">Chưa có mốc. Có thể tạo mốc bên dưới hoặc dùng nút “Tạo kế hoạch từ mẫu” sau khi có hợp đồng đã xác nhận.</p>`;
    return;
  }
  list.innerHTML = scheduleMilestones
    .map(
      (m) =>
        `<article class="schedule-milestone-row"><div><b>${Number(m.phase_order)}. ${escapeHtml(m.title)}</b><div style="color:#64748b;font-size:13px">${escapeHtml(formatDateOnly(m.start_date) || "Chưa có ngày")} – ${escapeHtml(formatDateOnly(m.end_date) || "Chưa có ngày")} · ${escapeHtml(m.status)}</div></div><div class="action-group"><button type="button" class="btn btn-sm btn-outline-primary" onclick="editScheduleMilestone(${Number(m.id)})"><i class="fa-solid fa-pen"></i> Sửa</button><button type="button" class="btn btn-sm btn-danger" onclick="deleteScheduleMilestone(${Number(m.id)})"><i class="fa-solid fa-trash"></i> Xóa</button></div></article>`,
    )
    .join("");
}

function editScheduleMilestone(milestoneId) {
  const milestone = scheduleMilestones.find(
    (item) => Number(item.id) === Number(milestoneId),
  );
  if (!milestone) return;
  document.getElementById("scheduleMilestoneId").value = milestone.id;
  document.getElementById("schedulePhaseOrder").value = milestone.phase_order;
  document.getElementById("scheduleTitle").value = milestone.title || "";
  document.getElementById("scheduleStartDate").value =
    milestone.start_date || "";
  document.getElementById("scheduleEndDate").value = milestone.end_date || "";
  document.getElementById("scheduleDuration").value =
    milestone.duration_weeks || "";
  document.getElementById("scheduleDescription").value =
    milestone.description || "";
  document.getElementById("scheduleExpectedResults").value =
    milestone.expected_results || "";
  document.getElementById("scheduleStatus").value =
    milestone.status || "NOT_STARTED";
  document.getElementById("scheduleSaveButton").textContent = "Lưu thay đổi";
}

async function saveScheduleMilestone(event) {
  event.preventDefault();
  const id = document.getElementById("scheduleMilestoneId").value;
  const payload = {
    phase_order: Number(document.getElementById("schedulePhaseOrder").value),
    title: document.getElementById("scheduleTitle").value.trim(),
    start_date: document.getElementById("scheduleStartDate").value || null,
    end_date: document.getElementById("scheduleEndDate").value || null,
    duration_weeks:
      document.getElementById("scheduleDuration").value.trim() || null,
    description:
      document.getElementById("scheduleDescription").value.trim() || null,
    expected_results:
      document.getElementById("scheduleExpectedResults").value.trim() || null,
    status: document.getElementById("scheduleStatus").value,
  };
  try {
    const response = await fetch(
      `${API_BASE}/interns/${scheduleManagerInternId}/schedule/milestones${id ? `/${Number(id)}` : ""}`,
      {
        method: id ? "PATCH" : "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      },
    );
    const body = await response.json();
    if (!response.ok || !body.success)
      throw new Error(body.message || "Không lưu được mốc lịch.");
    showToast(id ? "Đã cập nhật mốc lịch." : "Đã tạo mốc lịch.", "success");
    resetScheduleMilestoneForm();
    await loadScheduleMilestones();
  } catch (err) {
    showToast(err.message || "Không lưu được mốc lịch.", "error");
  }
}

async function deleteScheduleMilestone(milestoneId) {
  if (!confirm("Xóa mốc lịch này?")) return;
  try {
    const response = await fetch(
      `${API_BASE}/interns/${scheduleManagerInternId}/schedule/milestones/${Number(milestoneId)}`,
      { method: "DELETE", headers: authHeaders() },
    );
    const body = await response.json();
    if (!response.ok || !body.success)
      throw new Error(body.message || "Không xóa được mốc lịch.");
    if (
      document.getElementById("scheduleMilestoneId").value ===
      String(milestoneId)
    )
      resetScheduleMilestoneForm();
    showToast("Đã xóa mốc lịch.", "success");
    await loadScheduleMilestones();
  } catch (err) {
    showToast(err.message || "Không xóa được mốc lịch.", "error");
  }
}

// =========================================================================
// LỊCH CỦA TÔI (Intern): gộp Lịch làm việc + Lịch thực tập cá nhân + Lịch họp
// =========================================================================
const SCHEDULE_KINDS = [
  { key: "work", label: "Lịch làm việc", color: "#0d9488" },
  { key: "internship", label: "Lịch thực tập cá nhân", color: "#7c3aed" },
  { key: "meeting", label: "Lịch họp", color: "#2563eb" },
];
const SCHEDULE_DAY_MS = 86400000;

async function loadMySchedule() {
  if (currentRole !== "Intern") return;
  const list = document.getElementById("myScheduleList");
  list.innerHTML = `<p style="text-align:center;color:#94a3b8;padding:16px">Đang tải lịch...</p>`;
  try {
    const response = await fetch(`${API_BASE}/me/schedule`, {
      headers: authHeaders(),
    });
    if (response.status === 401)
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    const body = await response.json();
    if (!response.ok || !body.success)
      throw new Error(body.message || "Không tải được lịch thực tập.");
    myScheduleMilestones = Array.isArray(body.data?.milestones)
      ? body.data.milestones
      : [];
    myScheduleMentor = body.data?.mentor || null;
    myScheduleProgram = body.data?.program || null;
    myScheduleWarning = body.data?.schedule_sync_warning || "";
    // Lịch làm việc và lịch họp tải song song; lỗi ở đây không làm hỏng lịch thực tập.
    await Promise.all([loadMyWorkSchedule(), loadMyScheduleMeetings()]);
    const firstDated = myScheduleMilestones.find(
      (m) => m.start_date && parseCalendarDate(m.start_date),
    );
    if (!myScheduleMonth) {
      const base = firstDated
        ? parseCalendarDate(firstDated.start_date)
        : null;
      myScheduleMonth = base
        ? new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1))
        : monthStartOf(getVietnamToday());
    }
    renderMyScheduleCalendar();
  } catch (err) {
    list.innerHTML = `<p style="text-align:center;color:#ef4444;padding:16px">${escapeHtml(err.message || "Lỗi tải lịch.")}</p>`;
  }
}

// Lịch làm việc (ngày làm/nghỉ, giờ, hình thức) và ngày nghỉ chung của intern.
async function loadMyWorkSchedule() {
  myWorkSchedule = null;
  myWorkHolidays = {};
  try {
    const result = await wrRequest("/me/work-schedule");
    if (!result || !result.res.ok || !result.body.success) return;
    myWorkSchedule = result.body.data;
    for (const h of myWorkSchedule.holidays || [])
      myWorkHolidays[h.date] = h.name;
  } catch (err) {
    myWorkSchedule = null;
  }
}

// Lịch họp đã lên lịch của intern (tối đa 10 trang x 50 cuộc họp).
async function loadMyScheduleMeetings() {
  myScheduleMeetings = [];
  try {
    for (let page = 1; page <= 10; page += 1) {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "50",
        status: "SCHEDULED",
      });
      const data = await meetingRequest(`/me/meetings?${params}`);
      myScheduleMeetings.push(...(data?.items || []));
      if (!data?.pagination || page >= data.pagination.totalPages) break;
    }
  } catch (err) {
    myScheduleMeetings = [];
  }
}

// Trạng thái làm việc của một ngày theo lịch đang áp dụng.
// kind: "holiday" | "work" | "off" | null (chưa có lịch)
function workInfoOf(dateStr) {
  if (!myWorkSchedule) return { kind: null };
  const holiday = myWorkHolidays[dateStr];
  if (holiday) return { kind: "holiday", text: `Ngày nghỉ chung: ${holiday}` };
  const date = parseCalendarDate(dateStr);
  const weekday = ((date.getUTCDay() + 6) % 7) + 1; // 1 = Thứ 2 ... 7 = CN
  const schedule = myWorkSchedule.schedule || {};
  const day = (schedule.days || []).find((d) => Number(d.weekday) === weekday);
  if (!day || !day.isWorking) return { kind: "off", text: "Nghỉ theo lịch" };
  const type = day.workType === "ONLINE" ? "Online" : "Offline";
  const hours =
    schedule.mode === "FLEXIBLE"
      ? `Linh hoạt, tối thiểu ${Number(schedule.minDailyMinutes)} phút`
      : `${day.startTime}–${day.endTime}`;
  return { kind: "work", hours, type, text: `Làm việc ${hours} · ${type}` };
}

// Ngày làm việc có hiển thị vạch màu trên lịch (trong thời gian chương trình nếu có).
function isWorkMarkDay(dateStr) {
  if (workInfoOf(dateStr).kind !== "work") return false;
  const p = myScheduleProgram;
  if (p?.start_date && dateStr < p.start_date) return false;
  if (p?.end_date && dateStr > p.end_date) return false;
  return true;
}

function scheduleMilestonesOn(dateStr) {
  return myScheduleMilestones.filter(
    (item) =>
      item.start_date &&
      item.end_date &&
      item.start_date <= dateStr &&
      item.end_date >= dateStr,
  );
}

function scheduleMeetingsOn(dateStr) {
  return myScheduleMeetings
    .filter((m) => String(m.startAt || "").slice(0, 10) === dateStr)
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
}

// Các loại lịch của một ngày (đã áp dụng bộ lọc) theo thứ tự: làm việc, thực tập, họp.
function scheduleDayKinds(dateStr) {
  const kinds = [];
  if (myScheduleFilters.work && isWorkMarkDay(dateStr)) kinds.push("work");
  if (myScheduleFilters.internship && scheduleMilestonesOn(dateStr).length)
    kinds.push("internship");
  if (myScheduleFilters.meeting && scheduleMeetingsOn(dateStr).length)
    kinds.push("meeting");
  return kinds;
}

function scheduleDateToStr(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

// Thứ Hai đầu tuần (UTC) chứa ngày dateStr.
function weekStartOf(dateStr) {
  const date = parseCalendarDate(dateStr) || new Date();
  const offset = (date.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - offset,
    ),
  );
}

function parseCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
    ? date
    : null;
}

// Ngày đầu tháng (UTC) của một chuỗi YYYY-MM-DD.
function monthStartOf(dateStr) {
  const [year, month] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

function setScheduleView(mode) {
  if (mode === myScheduleView) return;
  if (!myScheduleMonth) myScheduleMonth = monthStartOf(getVietnamToday());
  if (mode === "week") {
    const monthPrefix = scheduleDateToStr(myScheduleMonth).slice(0, 7);
    const today = getVietnamToday();
    const anchor =
      myScheduleSelectedDate ||
      (today.startsWith(monthPrefix)
        ? today
        : scheduleDateToStr(myScheduleMonth));
    myScheduleWeekStart = weekStartOf(anchor);
  } else if (myScheduleView === "week" && myScheduleWeekStart) {
    // Từ tuần sang tháng/danh sách: lấy tháng của ngày giữa tuần (Thứ Năm)
    const mid = new Date(myScheduleWeekStart.getTime() + 3 * SCHEDULE_DAY_MS);
    myScheduleMonth = new Date(
      Date.UTC(mid.getUTCFullYear(), mid.getUTCMonth(), 1),
    );
  }
  myScheduleView = mode;
  renderMyScheduleCalendar();
}

function shiftScheduleRange(delta) {
  if (myScheduleView === "week") {
    if (!myScheduleWeekStart)
      myScheduleWeekStart = weekStartOf(getVietnamToday());
    myScheduleWeekStart = new Date(
      myScheduleWeekStart.getTime() + delta * 7 * SCHEDULE_DAY_MS,
    );
    myScheduleSelectedDate = "";
    renderMyScheduleCalendar();
  } else {
    shiftScheduleMonth(delta);
  }
}

function shiftScheduleMonth(delta) {
  if (!myScheduleMonth) myScheduleMonth = monthStartOf(getVietnamToday());
  myScheduleMonth = new Date(
    Date.UTC(
      myScheduleMonth.getUTCFullYear(),
      myScheduleMonth.getUTCMonth() + delta,
      1,
    ),
  );
  myScheduleSelectedDate = "";
  renderMyScheduleCalendar();
}

function goToScheduleToday() {
  const today = getVietnamToday();
  myScheduleMonth = monthStartOf(today);
  myScheduleWeekStart = weekStartOf(today);
  myScheduleSelectedDate = today;
  renderMyScheduleCalendar();
}

function closeScheduleTodayPanel() {
  myScheduleSelectedDate = "";
  renderMyScheduleCalendar();
}

function selectScheduleCalendarDate(dateStr) {
  myScheduleSelectedDate = dateStr;
  renderMyScheduleCalendar();
}

function toggleScheduleFilter(key) {
  if (!Object.hasOwn(myScheduleFilters, key)) return;
  myScheduleFilters[key] = !myScheduleFilters[key];
  renderMyScheduleCalendar();
}

function openMyScheduleMeeting(id) {
  meetingMine = true; // Intern xem chi tiết qua /me/meetings
  openMeeting(id);
}

const SCHEDULE_STATUS_TEXT = {
  IN_PROGRESS: "Đang thực hiện",
  COMPLETED: "Hoàn thành",
  PENDING: "Chưa bắt đầu",
  NOT_STARTED: "Chưa bắt đầu",
};

// Khối 3 chỉ số tổng quan ở đầu trang.
function buildScheduleSummary(todayStr) {
  // 1. Lịch làm việc hôm nay
  const work = workInfoOf(todayStr);
  let workValue = "Chưa có lịch";
  if (work.kind === "work")
    workValue = work.hours.startsWith("Linh hoạt") ? "Linh hoạt" : work.hours;
  else if (work.kind === "off") workValue = "Nghỉ";
  else if (work.kind === "holiday") workValue = "Nghỉ chung";

  // 2. Giai đoạn thực tập
  const dated = myScheduleMilestones.filter(
    (m) => m.start_date && m.end_date,
  );
  let phaseValue = "Chưa có";
  if (dated.length) {
    if (dated.some((m) => m.start_date <= todayStr && m.end_date >= todayStr))
      phaseValue = "Đang thực hiện";
    else if (dated.every((m) => m.end_date < todayStr))
      phaseValue = "Đã kết thúc";
    else phaseValue = "Sắp bắt đầu";
  }

  // 3. Họp sắp tới (theo giờ Việt Nam)
  const nowVn = new Date(Date.now() + 7 * 3600000).toISOString();
  const nowKey = `${nowVn.slice(0, 10)} ${nowVn.slice(11, 16)}`;
  const next = myScheduleMeetings
    .filter((m) => String(m.startAt).slice(0, 16) >= nowKey)
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)))[0];
  let meetValue = "Không có";
  if (next) {
    const day = String(next.startAt).slice(0, 10);
    const time = String(next.startAt).slice(11, 16);
    meetValue = day === todayStr ? time : `${formatDateOnly(day)} ${time}`;
  }
  const item = (label, value) =>
    `<div class="cal-summary-item"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
  return `<div class="cal-summary">${item("Lịch làm việc", workValue)}${item("Giai đoạn thực tập", phaseValue)}${item("Họp sắp tới", meetValue)}</div>`;
}

function buildScheduleFilters() {
  return `<div class="cal-filters"><h4>Hiển thị loại lịch</h4>${SCHEDULE_KINDS.map(
    (k) =>
      `<button type="button" class="cal-filter${myScheduleFilters[k.key] ? " is-on" : ""}" role="checkbox" aria-checked="${myScheduleFilters[k.key]}" onclick="toggleScheduleFilter('${k.key}')"><i class="cal-check fa-solid ${myScheduleFilters[k.key] ? "fa-circle-check" : "fa-circle"}"></i><span class="cal-dot" style="background:${k.color}"></span><span>${escapeHtml(k.label)}</span></button>`,
  ).join("")}</div>`;
}

// Chi tiết một ngày: giờ làm việc, mốc thực tập, cuộc họp (theo bộ lọc).
function buildScheduleDayPanel(dateStr, todayStr) {
  const date = parseCalendarDate(dateStr);
  if (!date) return "";
  const dayNames = [
    "Chủ nhật",
    "Thứ hai",
    "Thứ ba",
    "Thứ tư",
    "Thứ năm",
    "Thứ sáu",
    "Thứ bảy",
  ];
  const label = `${dayNames[date.getUTCDay()]}, ${formatDateOnly(dateStr)}`;
  const sections = [];
  if (myScheduleFilters.work) {
    const work = workInfoOf(dateStr);
    if (work.kind)
      sections.push(
        `<div class="cal-detail is-work"><span class="cal-dot" style="background:#0d9488"></span><div><b>Lịch làm việc</b><div class="cal-detail-sub">${escapeHtml(work.text)}${work.kind === "work" ? "" : " · bạn vẫn có thể chấm công nếu làm việc"}</div></div></div>`,
      );
  }
  if (myScheduleFilters.internship) {
    for (const item of scheduleMilestonesOn(dateStr)) {
      const start = parseCalendarDate(item.start_date);
      const end = parseCalendarDate(item.end_date);
      const total = Math.round((end - start) / SCHEDULE_DAY_MS) + 1;
      const current = Math.round((date - start) / SCHEDULE_DAY_MS) + 1;
      const percent = Math.min(100, Math.round((current / total) * 100));
      sections.push(
        `<div class="cal-detail"><span class="cal-dot" style="background:#7c3aed"></span><div class="cal-detail-main"><b>${Number(item.phase_order)}. ${escapeHtml(item.title)}</b> <span class="badge ${item.status === "COMPLETED" ? "badge-active" : "badge-pending"}">${escapeHtml(SCHEDULE_STATUS_TEXT[item.status] || item.status)}</span><div class="cal-detail-sub">${escapeHtml(formatDateOnly(item.start_date))} – ${escapeHtml(formatDateOnly(item.end_date))} · Ngày ${current}/${total}</div><div class="cal-progress"><span style="width:${percent}%"></span></div>${item.description ? `<p class="cal-detail-desc">${escapeHtml(item.description)}</p>` : ""}${item.expected_results ? `<small class="cal-detail-sub">Kết quả dự kiến: ${escapeHtml(item.expected_results)}</small>` : ""}</div></div>`,
      );
    }
  }
  if (myScheduleFilters.meeting) {
    for (const m of scheduleMeetingsOn(dateStr))
      sections.push(
        `<div class="cal-detail"><span class="cal-dot" style="background:#2563eb"></span><div class="cal-detail-main"><b>${escapeHtml(m.title)}</b><div class="cal-detail-sub">${escapeHtml(String(m.startAt).slice(11, 16))}–${escapeHtml(String(m.endAt).slice(11, 16))} · ${escapeHtml(m.location || "Trực tuyến / chưa có địa điểm")}</div></div><button type="button" class="btn btn-secondary btn-sm" onclick="openMyScheduleMeeting(${Number(m.id)})">Chi tiết</button></div>`,
      );
  }
  const body = sections.length
    ? sections.join("")
    : `<p class="cal-empty">${dateStr === todayStr ? "Hôm nay" : "Ngày này"} không có lịch nào.</p>`;
  return `<section class="cal-day-panel"><div class="cal-day-panel-head"><h4>${dateStr === todayStr ? "Hôm nay có gì?" : "Lịch trong ngày"}</h4><span>${escapeHtml(label)}</span><button type="button" class="cal-close" onclick="closeScheduleTodayPanel()" aria-label="Đóng"><i class="fa-solid fa-xmark"></i></button></div>${body}</section>`;
}

function buildScheduleCell(date, opts) {
  const { isWeek, month, todayStr, index } = opts;
  const dateStr = scheduleDateToStr(date);
  const weekdayNames = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
  if (!isWeek && date.getUTCMonth() !== month)
    return `<div class="cal-cell is-blank" aria-hidden="true"></div>`;
  const classes = ["cal-cell"];
  if (isWeek) classes.push("is-week");
  if (dateStr === todayStr) classes.push("is-today");
  if (dateStr === myScheduleSelectedDate) classes.push("is-selected");
  const kinds = scheduleDayKinds(dateStr);
  const color = (k) => SCHEDULE_KINDS.find((x) => x.key === k).color;
  let inner;
  if (isWeek) {
    const parts = [];
    if (kinds.includes("work")) {
      const w = workInfoOf(dateStr);
      parts.push(
        `<span class="cal-chip" style="--c:${color("work")}">${escapeHtml(w.hours)} · ${escapeHtml(w.type)}</span>`,
      );
    }
    if (kinds.includes("internship"))
      for (const m of scheduleMilestonesOn(dateStr))
        parts.push(
          `<span class="cal-chip" style="--c:${color("internship")}">${escapeHtml(m.title)}</span>`,
        );
    if (kinds.includes("meeting"))
      for (const m of scheduleMeetingsOn(dateStr))
        parts.push(
          `<span class="cal-chip" style="--c:${color("meeting")}">${escapeHtml(String(m.startAt).slice(11, 16))} ${escapeHtml(m.title)}</span>`,
        );
    inner = `<span class="cal-num">${date.getUTCDate()}</span><span class="cal-weekname">${weekdayNames[index]}</span><span class="cal-chips">${parts.join("")}</span>`;
  } else {
    const bars = kinds
      .map(
        (k) => `<span class="cal-bar" style="background:${color(k)}"></span>`,
      )
      .join("");
    inner = `<span class="cal-num">${date.getUTCDate()}</span><span class="cal-bars">${bars}</span>`;
  }
  const names = kinds
    .map((k) => SCHEDULE_KINDS.find((x) => x.key === k).label)
    .join(", ");
  return `<button type="button" class="${classes.join(" ")}" onclick="selectScheduleCalendarDate('${dateStr}')" aria-label="${dateStr}${names ? `: ${escapeHtml(names)}` : ""}">${inner}</button>`;
}

// Chế độ "Danh sách": mọi sự kiện trong tháng đang xem, theo ngày.
function buildScheduleList(year, month, todayStr) {
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const rows = [];
  for (let d = 1; d <= daysInMonth; d += 1) {
    const dateStr = scheduleDateToStr(new Date(Date.UTC(year, month, d)));
    const items = [];
    if (myScheduleFilters.work && isWorkMarkDay(dateStr)) {
      const w = workInfoOf(dateStr);
      items.push(
        `<div class="cal-list-item"><span class="cal-dot" style="background:#0d9488"></span><span>Làm việc ${escapeHtml(w.hours)} · ${escapeHtml(w.type)}</span></div>`,
      );
    }
    if (myScheduleFilters.internship)
      for (const m of scheduleMilestonesOn(dateStr))
        items.push(
          `<div class="cal-list-item"><span class="cal-dot" style="background:#7c3aed"></span><span>${Number(m.phase_order)}. ${escapeHtml(m.title)}</span></div>`,
        );
    if (myScheduleFilters.meeting)
      for (const m of scheduleMeetingsOn(dateStr))
        items.push(
          `<button type="button" class="cal-list-item is-link" onclick="openMyScheduleMeeting(${Number(m.id)})"><span class="cal-dot" style="background:#2563eb"></span><span>${escapeHtml(String(m.startAt).slice(11, 16))} · ${escapeHtml(m.title)}</span></button>`,
        );
    if (!items.length) continue;
    const wd = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][
      new Date(Date.UTC(year, month, d)).getUTCDay()
    ];
    rows.push(
      `<div class="cal-list-row${dateStr === todayStr ? " is-today" : ""}"><div class="cal-list-date"><b>${d}</b><span>${wd}</span></div><div class="cal-list-items">${items.join("")}</div></div>`,
    );
  }
  return rows.length
    ? `<div class="cal-list">${rows.join("")}</div>`
    : `<p class="cal-empty">Không có lịch nào trong tháng này.</p>`;
}

function renderMyScheduleCalendar() {
  const list = document.getElementById("myScheduleList");
  if (!list) return;
  if (!myScheduleMonth) myScheduleMonth = monthStartOf(getVietnamToday());
  const year = myScheduleMonth.getUTCFullYear();
  const month = myScheduleMonth.getUTCMonth();
  const view = ["week", "month", "list"].includes(myScheduleView)
    ? myScheduleView
    : "month";
  const isWeek = view === "week";
  const isList = view === "list";
  if (isWeek && !myScheduleWeekStart)
    myScheduleWeekStart = weekStartOf(
      myScheduleSelectedDate || getVietnamToday(),
    );
  const todayStr = getVietnamToday();
  const pad2 = (n) => String(n).padStart(2, "0");
  let rangeTitle;
  if (isWeek) {
    const weekEnd = new Date(myScheduleWeekStart.getTime() + 6 * SCHEDULE_DAY_MS);
    rangeTitle = `${pad2(myScheduleWeekStart.getUTCDate())}/${pad2(myScheduleWeekStart.getUTCMonth() + 1)} – ${pad2(weekEnd.getUTCDate())}/${pad2(weekEnd.getUTCMonth() + 1)}/${weekEnd.getUTCFullYear()}`;
  } else {
    rangeTitle = new Intl.DateTimeFormat("vi-VN", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(myScheduleMonth);
  }
  const weekdayNames = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
  const offset = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const totalCells = isWeek ? 7 : Math.ceil((offset + daysInMonth) / 7) * 7;
  let cells = "";
  if (!isList)
    for (let index = 0; index < totalCells; index += 1) {
      const date = isWeek
        ? new Date(myScheduleWeekStart.getTime() + index * SCHEDULE_DAY_MS)
        : new Date(Date.UTC(year, month, 1 - offset + index));
      cells += buildScheduleCell(date, {
        isWeek,
        month,
        todayStr,
        index: isWeek ? index : index % 7,
      });
    }
  const tab = (key, text) =>
    `<button type="button" role="tab" aria-selected="${view === key}" class="${view === key ? "active" : ""}" onclick="setScheduleView('${key}')">${text}</button>`;
  const body = isList
    ? buildScheduleList(year, month, todayStr)
    : `<div class="cal-grid${isWeek ? " is-week" : ""}">${weekdayNames.map((d) => `<div class="cal-weekday">${d}</div>`).join("")}${cells}</div>`;
  const dayPanel =
    myScheduleSelectedDate && !isList
      ? buildScheduleDayPanel(myScheduleSelectedDate, todayStr)
      : "";
  list.innerHTML = `<div class="cal-wrap"><div class="cal-title"><i class="fa-regular fa-calendar-days"></i><div><h3>Lịch của tôi</h3><p>Lịch làm việc · Hành trình thực tập · Cuộc họp</p></div></div>${myScheduleWarning ? `<p class="alert-box alert-error" style="display:block">${escapeHtml(myScheduleWarning)}</p>` : ""}${buildScheduleSummary(todayStr)}${buildScheduleFilters()}<div class="cal-tabs" role="tablist">${tab("week", "Tuần")}${tab("month", "Tháng")}${tab("list", "Danh sách")}</div><div class="cal-toolbar"><button class="cal-nav" type="button" onclick="shiftScheduleRange(-1)" aria-label="${isWeek ? "Tuần trước" : "Tháng trước"}"><i class="fa-solid fa-chevron-left"></i></button><h4>${escapeHtml(rangeTitle)}</h4><button class="cal-nav" type="button" onclick="shiftScheduleRange(1)" aria-label="${isWeek ? "Tuần sau" : "Tháng sau"}"><i class="fa-solid fa-chevron-right"></i></button><button class="cal-today" type="button" onclick="goToScheduleToday()">Hôm nay</button></div>${body}${isList ? "" : `<p class="cal-hint">Chọn ngày để xem chi tiết các lịch trong ngày.</p>`}${dayPanel}</div>`;
}
