function syncAttendanceReportDates() {
  const from = document.getElementById("arFrom"),
    to = document.getElementById("arTo");
  to.min = from.value || "";
  from.max = to.value || "";
}
async function updateAttendanceReportScope() {
  const type = document.getElementById("arScope").value;
  document.getElementById("arScopeValueWrap").style.display =
    type === "ALL" ? "none" : "";
  if (type === "ALL") return;
  document.getElementById("arScopeValueLabel").textContent = SCOPE_LABEL[type];
  fillScopeSelect("arScopeValue", type, await loadWorkScopeOptions());
}
function attendanceReportQuery() {
  const error = document.getElementById("attendanceReportError");
  error.textContent = "";
  const from = document.getElementById("arFrom").value,
    to = document.getElementById("arTo").value;
  const type = document.getElementById("arScope").value,
    value = document.getElementById("arScopeValue").value;
  if (!from || !to) {
    error.textContent = "Vui lòng chọn khoảng ngày.";
    return null;
  }
  if (from > to) {
    error.textContent = "Ngày bắt đầu không được sau ngày kết thúc.";
    return null;
  }
  if (daysInclusive(from, to) > 366) {
    error.textContent = "Khoảng ngày tối đa 366 ngày.";
    return null;
  }
  if (type !== "ALL" && !value) {
    error.textContent = "Vui lòng chọn giá trị phạm vi.";
    return null;
  }
  const query = new URLSearchParams({
    from,
    to,
    scope_type: type,
    group_by: document.getElementById("arGroupBy").value,
  });
  if (type !== "ALL") query.set("scope_value", value);
  return query;
}
function rateBadge(rate) {
  if (rate == null) return `<span class="ar-rate ar-rate-none">—</span>`;
  const cls =
    rate >= 90 ? "ar-rate-good" : rate >= 75 ? "ar-rate-mid" : "ar-rate-low";
  return `<span class="ar-rate ${cls}">${rate}%</span>`;
}
function renderAttendanceSummary(s) {
  const stat = (label, value, extra = "") =>
    `<div class="ar-stat ${extra}"><span>${label}</span><strong>${value}</strong></div>`;
  document.getElementById("arSummary").innerHTML =
    `<div class="ar-stats">${stat("Thực tập sinh", s.totalInterns)}${stat("Tỷ lệ chuyên cần chung", rateBadge(s.attendanceRate))}${stat("Ngày vắng không phép", s.absentDays)}${stat("Ngày nghỉ phép", s.leaveDays)}${stat("Lượt đi muộn", s.lateCount)}${stat("Đơn nghỉ chờ duyệt", s.pendingLeaveRequests, 'clickable" onclick="switchTab(\'tab-staff-attendance\')" title="Mở danh sách đơn chờ duyệt')}</div>`;
}
function renderAttendanceGroups(groups) {
  const box = document.getElementById("arGroups");
  if (!groups.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = `<div class="card"><div class="card-header"><h3>Tổng hợp theo nhóm</h3></div><div class="card-body"><div class="table-container"><table><thead><tr><th>Nhóm</th><th class="ar-num">Thực tập sinh</th><th class="ar-num">Phải đi</th><th class="ar-num">Có mặt</th><th class="ar-num">Nghỉ phép</th><th class="ar-num">Vắng</th><th class="ar-num">Muộn</th><th>Tỷ lệ</th></tr></thead><tbody>${groups.map((g) => `<tr><td>${escapeHtml(g.name)}</td><td class="ar-num">${g.totalInterns}</td><td class="ar-num">${g.requiredDays}</td><td class="ar-num">${g.presentDays}</td><td class="ar-num">${g.leaveDays}</td><td class="ar-num">${g.absentDays}</td><td class="ar-num">${g.lateCount}</td><td>${rateBadge(g.attendanceRate)}</td></tr>`).join("")}</tbody></table></div></div></div>`;
}
function attendanceSortValue(row, key) {
  if (key === "name") return row.intern.fullName || "";
  if (key === "schedule")
    return `${row.intern.programName || ""} ${row.scheduleName || ""}`;
  return row[key];
}
function sortAttendanceReport(key) {
  attendanceReportSort = {
    key,
    dir:
      attendanceReportSort.key === key && attendanceReportSort.dir === "asc"
        ? "desc"
        : "asc",
  };
  renderAttendanceTable();
}
function renderAttendanceTable() {
  const box = document.getElementById("attendanceReportList");
  const { key, dir } = attendanceReportSort,
    factor = dir === "asc" ? 1 : -1;
  const rows = [...attendanceReportData.interns].sort((a, b) => {
    const x = attendanceSortValue(a, key),
      y = attendanceSortValue(b, key);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1; // giá trị trống luôn xuống cuối
    return (typeof x === "string" ? x.localeCompare(y, "vi") : x - y) * factor;
  });
  const arrow = (k) => (k === key ? (dir === "asc" ? " ▲" : " ▼") : "");
  const head = AR_COLUMNS.map(
    ([k, label]) =>
      `<th class="ar-sortable${k === "name" ? " ar-col-name" : k === "schedule" ? " ar-col-group" : " ar-num"}" onclick="sortAttendanceReport('${k}')">${label}${arrow(k)}</th>`,
  ).join("");
  const body = rows
    .map((r) => {
      const i = r.intern;
      const identity = [i.studentCode, i.university]
        .filter(Boolean)
        .join(" · ");
      const scheduleText = r.scheduleName
        ? r.scheduleSource && r.scheduleSource !== "Mặc định"
          ? `${r.scheduleName} · theo ${r.scheduleSource}`
          : r.scheduleName
        : "";
      return `<tr><td>${escapeHtml(i.fullName)}${identity ? `<span class="fr-sub">${escapeHtml(identity)}</span>` : ""}</td><td>${escapeHtml(i.programName || "Chưa gán chương trình")}${scheduleText ? `<span class="fr-sub">${escapeHtml(scheduleText)}</span>` : ""}</td><td class="ar-num">${r.requiredDays}</td><td class="ar-num">${r.presentDays}</td><td class="ar-num">${r.leaveDays}</td><td class="ar-num">${r.absentDays}</td><td class="ar-num">${r.pendingLeaveDays}</td><td class="ar-num">${r.lateCount}</td><td class="ar-num">${r.earlyLeaveCount}</td><td class="ar-num">${r.missingCheckoutCount}</td><td class="ar-num">${escapeHtml(formatAttendanceMinutes(r.totalWorkMinutes))}</td><td class="ar-num">${rateBadge(r.attendanceRate)}</td><td><button class="btn btn-sm btn-secondary" onclick="openAttendanceReportDetail(${Number(i.id)})">Chi tiết</button></td></tr>`;
    })
    .join("");
  box.innerHTML = rows.length
    ? `<div class="table-container"><table><thead><tr>${head}<th></th></tr></thead><tbody>${body}</tbody></table></div>`
    : `<p>Không có thực tập sinh nào có ngày làm việc trong khoảng này.</p>`;
}
async function loadAttendanceReport() {
  const today = getVietnamToday();
  const from = document.getElementById("arFrom"),
    to = document.getElementById("arTo");
  if (!to.value) to.value = today;
  if (!from.value) from.value = `${today.slice(0, 8)}01`;
  syncAttendanceReportDates();
  if (!document.getElementById("arScopeValue").options.length)
    await updateAttendanceReportScope();
  const query = attendanceReportQuery();
  if (!query) return;
  const button = document.getElementById("arViewButton");
  button.disabled = true;
  const list = document.getElementById("attendanceReportList");
  list.textContent = "Đang tải...";
  document.getElementById("arDetailCard").style.display = "none";
  try {
    const result = await wrRequest(`/attendance/report?${query}`);
    if (!result) return;
    if (!result.res.ok) {
      list.textContent = "";
      document.getElementById("arSummary").innerHTML = "";
      document.getElementById("arGroups").innerHTML = "";
      setText(
        "attendanceReportError",
        wrApiError(result, "Không tải được báo cáo chuyên cần."),
      );
      return;
    }
    attendanceReportData = result.body.data;
    renderAttendanceSummary(attendanceReportData.summary);
    renderAttendanceGroups(attendanceReportData.groups);
    renderAttendanceTable();
  } finally {
    button.disabled = false;
  }
}
async function openAttendanceReportDetail(internId) {
  const query = attendanceReportQuery();
  if (!query) return;
  const card = document.getElementById("arDetailCard"),
    box = document.getElementById("arDetail");
  card.style.display = "";
  box.textContent = "Đang tải...";
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  const result = await wrRequest(
    `/attendance/report/interns/${internId}/days?from=${query.get("from")}&to=${query.get("to")}`,
  );
  if (!result) return;
  if (!result.res.ok) {
    box.textContent = wrApiError(result, "Không tải được chi tiết.");
    return;
  }
  const d = result.body.data;
  setText("arDetailTitle", `Chi tiết từng ngày: ${d.intern.fullName}`);
  const rows = d.days
    .map((day) => {
      const [label, cls] = DAY_STATUS[day.status] || [day.status, "ar-b-muted"];
      const r = day.record;
      const time = r
        ? `${String(r.checkInAt).slice(11, 16)} – ${r.checkOutAt ? String(r.checkOutAt).slice(11, 16) : "chưa check-out"}`
        : "—";
      const schedule = day.schedule
        ? day.schedule.mode === "FIXED"
          ? `${day.schedule.startTime || "—"}–${day.schedule.endTime || "—"}`
          : "Linh hoạt"
        : "—";
      const muted = ["OUT_OF_CONTRACT", "UPCOMING"].includes(day.status)
        ? ' class="ar-muted-row"'
        : "";
      return `<tr${muted}><td>${escapeHtml(weekdayLabel(day.date))}, ${escapeHtml(formatDateOnly(day.date))}</td><td>${pill(label, cls)}</td><td>${escapeHtml(time)}</td><td>${escapeHtml(day.flags.map((f) => DAY_FLAGS[f] || f).join(", ")) || "—"}</td><td>${escapeHtml(schedule)}</td></tr>`;
    })
    .join("");
  box.innerHTML = `<div class="table-container"><table><thead><tr><th>Ngày</th><th>Trạng thái</th><th>Giờ làm</th><th>Ghi chú</th><th>Giờ theo lịch</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
async function downloadAttendanceReportCsv() {
  return exportReport(
    "attendance",
    "csv",
    document.activeElement?.tagName === "BUTTON"
      ? document.activeElement
      : null,
  );
}
