function wsCount(value) {
  return String(Number(value || 0)).padStart(2, "0");
}

function switchWorkScheduleSection(section = "templates") {
  const overview = document.getElementById("wsOverview");
  const subpages = {
    form: document.getElementById("wsForm"),
    apply: document.getElementById("wsApplyView"),
    holiday: document.getElementById("wsHolidayView"),
  };
  Object.values(subpages).forEach((el) => {
    if (el) el.style.display = "none";
  });
  const isSubpage = Boolean(subpages[section]);
  if (overview) overview.style.display = isSubpage ? "none" : "";
  if (isSubpage) {
    subpages[section].style.display = "block";
    const sc = document.querySelector(".content-scroll");
    if (sc) sc.scrollTop = 0;
    return;
  }
  document.querySelectorAll("#wsOverview .ws-section").forEach((el) => {
    el.classList.toggle("is-visible", el.id === `wsSection${section[0].toUpperCase()}${section.slice(1)}`);
  });
  document.querySelectorAll("#wsOverview .ws-tab").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.wsSection === section);
  });
}

function selectWorkScheduleTarget(type) {
  const typeSelect = document.getElementById("wsAsType");
  if (!typeSelect) return;
  typeSelect.value = type;
  updateAssignmentScope();
}

function showWorkScheduleApply() {
  switchWorkScheduleSection("apply");
  if (!document.getElementById("wsAsFrom").value)
    document.getElementById("wsAsFrom").value = getVietnamToday();
  updateAssignmentPreview();
}

function showWorkHolidayForm() {
  switchWorkScheduleSection("holiday");
  setText("wsHolError", "");
  if (!document.getElementById("wsHolDate").value)
    document.getElementById("wsHolDate").value = getVietnamToday();
  const note = document.getElementById("wsHolNote");
  if (note) note.value = "";
}

function updateAssignmentPreview() {
  const target = document.getElementById("wsAsValue");
  const schedule = wsSchedules.find(
    (s) => String(s.id) === String(document.getElementById("wsAsSchedule")?.value),
  );
  const el = document.getElementById("wsApplyPreview");
  if (!el) return;
  if (!schedule) {
    el.textContent = "Chọn mẫu lịch để xem trước.";
    return;
  }
  const from = document.getElementById("wsAsFrom").value;
  const to = document.getElementById("wsAsTo").value;
  const targetName = target?.selectedOptions?.[0]?.textContent || "Nhóm thực tập";
  el.innerHTML = `<strong>${escapeHtml(schedule.name)}</strong><span>${escapeHtml(schedule.summary || "Lịch làm việc theo mẫu")}</span><span>Đối tượng: ${escapeHtml(targetName)}</span><span>Hiệu lực: ${escapeHtml(from ? formatDateOnly(from) : "Chưa chọn")} đến ${escapeHtml(to ? formatDateOnly(to) : "không giới hạn")}</span>`;
}

function wsCanEdit() {
  return currentRole === "HR";
}
function wsRenderDayRows(days) {
  document.getElementById("wsDays").innerHTML = WEEKDAY_LABELS.map(
    (label, i) => {
      const d = days[i];
      return `<tr><td>${label}</td><td><input type="checkbox" id="wsOn${i + 1}" ${d.isWorking ? "checked" : ""} onchange="updateWorkScheduleMode()" aria-label="Làm việc ${label}"></td><td><select id="wsType${i + 1}" aria-label="Hình thức ${label}"><option value="OFFLINE" ${d.workType !== "ONLINE" ? "selected" : ""}>Offline</option><option value="ONLINE" ${d.workType === "ONLINE" ? "selected" : ""}>Online</option></select></td><td class="ws-time-col"><input type="time" id="wsStart${i + 1}" value="${d.startTime || ""}" aria-label="Bắt đầu ${label}"></td><td class="ws-time-col"><input type="time" id="wsEnd${i + 1}" value="${d.endTime || ""}" aria-label="Kết thúc ${label}"></td></tr>`;
    },
  ).join("");
}
function updateWorkScheduleMode() {
  const fixed = document.getElementById("wsMode").value === "FIXED";
  document.getElementById("wsGraceWrap").style.display = fixed ? "" : "none";
  document.getElementById("wsMinWrap").style.display = fixed ? "none" : "";
  document
    .querySelectorAll("#wsForm .ws-time-col")
    .forEach((el) => el.classList.toggle("ws-hide", !fixed));
  for (let n = 1; n <= 7; n++) {
    const on = document.getElementById(`wsOn${n}`).checked;
    document.getElementById(`wsStart${n}`).disabled = !on;
    document.getElementById(`wsEnd${n}`).disabled = !on;
    document.getElementById(`wsType${n}`).disabled = !on;
  }
}
function selectWorkScheduleKind(kind) {
  const pills = document.querySelector(".ws-day-pills");
  if (pills) pills.classList.toggle("is-one-day", kind === "ONE_DAY");
}
function toggleWorkScheduleDay(day, button) {
  const checkbox = document.getElementById(`wsOn${day}`);
  if (!checkbox) return;
  checkbox.checked = !checkbox.checked;
  button.classList.toggle("is-selected", checkbox.checked);
  updateWorkScheduleMode();
}
function syncWorkSchedulePills() {
  document.querySelectorAll(".ws-day-pill[data-day]").forEach((button) => {
    const checkbox = document.getElementById(`wsOn${button.dataset.day}`);
    if (checkbox) button.classList.toggle("is-selected", checkbox.checked);
  });
}
function syncPrimaryHoursToRows() {
  const start = document.getElementById("wsPrimaryStart")?.value || "08:30";
  const end = document.getElementById("wsPrimaryEnd")?.value || "17:30";
  for (let n = 1; n <= 7; n++) {
    const startInput = document.getElementById(`wsStart${n}`),
      endInput = document.getElementById(`wsEnd${n}`);
    if (startInput && endInput) {
      startInput.value = start;
      endInput.value = end;
    }
  }
}
async function selectCreateScheduleTarget(type) {
  const targetType = document.getElementById("wsCreateTargetType"),
    valueWrap = document.getElementById("wsCreateValueWrap");
  if (!targetType || !valueWrap) return;
  targetType.value = type;
  valueWrap.style.display = type === "DEFAULT" ? "none" : "";
  if (type !== "DEFAULT") {
    setText("wsCreateValueLabel", type === "GROUP" ? "Nhóm thực tập" : "Intern cụ thể");
    fillScopeSelect("wsCreateValue", type, await loadWorkScopeOptions());
  }
}
function copyFirstDayHours() {
  const start = document.getElementById("wsStart1").value,
    end = document.getElementById("wsEnd1").value;
  document.getElementById("wsPrimaryStart").value = start;
  document.getElementById("wsPrimaryEnd").value = end;
  for (let n = 2; n <= 7; n++) {
    document.getElementById(`wsStart${n}`).value = start;
    document.getElementById(`wsEnd${n}`).value = end;
  }
}
function showWorkScheduleForm(id = null) {
  const schedule = id ? wsSchedules.find((s) => s.id === id) : null;
  wsEditingId = id;
  setText("wsFormError", "");
  setText(
    "wsFormTitle",
    schedule ? `Sửa lịch làm việc: ${schedule.name}` : "Tạo lịch làm việc",
  );
  setText("wsSaveButton", schedule ? "Lưu thay đổi" : "Tạo lịch làm việc");
  document.getElementById("wsName").value = schedule ? schedule.name : "";
  document.getElementById("wsDesc").value = schedule
    ? schedule.description
    : "";
  document.getElementById("wsMode").value = schedule ? schedule.mode : "FIXED";
  document.getElementById("wsGrace").value = schedule
    ? schedule.graceMinutes
    : 15;
  document.getElementById("wsMinDaily").value =
    schedule && schedule.minDailyMinutes ? schedule.minDailyMinutes : 240;
  const byDay = (n) =>
    (schedule ? schedule.days.find((d) => d.weekday === n) : null) || {
      isWorking: n <= 5,
      startTime: "08:30",
      endTime: "17:30",
    };
  wsRenderDayRows(
    [1, 2, 3, 4, 5, 6, 7].map((n) => {
      const d = byDay(n);
      return {
        isWorking: d.isWorking,
        startTime: d.startTime || (d.isWorking ? "08:30" : ""),
        endTime: d.endTime || (d.isWorking ? "17:30" : ""),
        workType: d.workType || "OFFLINE",
      };
    }),
  );
  const firstWorking = Array.from(document.querySelectorAll("#wsDays tr")).find(
    (row) => row.querySelector("input[type=checkbox]")?.checked,
  );
  document.getElementById("wsPrimaryStart").value =
    firstWorking?.querySelector('input[type="time"]')?.value || "08:30";
  document.getElementById("wsPrimaryEnd").value =
    firstWorking?.querySelectorAll('input[type="time"]')[1]?.value || "17:30";
  document.getElementById("wsCreateFrom").value = getVietnamToday();
  document.getElementById("wsCreateTo").value = "";
  document.querySelector('input[name="wsScheduleKind"][value="WEEKLY"]').checked = true;
  document.querySelector('input[name="wsCreateTarget"][value="DEFAULT"]').checked = true;
  void selectCreateScheduleTarget("DEFAULT");
  syncWorkSchedulePills();
  const warning = document.getElementById("wsEditWarning");
  warning.style.display = schedule && schedule.assignmentCount ? "" : "none";
  warning.textContent =
    "Lịch này đang được áp dụng cho nhóm. Thay đổi sẽ ảnh hưởng cả báo cáo các ngày đã qua; nên tạo mẫu lịch mới và áp dụng từ ngày hiệu lực để giữ nguyên số liệu cũ.";
  updateWorkScheduleMode();
  switchWorkScheduleSection("form");
  document
    .getElementById("wsForm")
    .scrollIntoView({ behavior: "smooth", block: "start" });
}
function workSchedulePayload() {
  syncPrimaryHoursToRows();
  const fixed = document.getElementById("wsMode").value === "FIXED";
  const days = [1, 2, 3, 4, 5, 6, 7].map((n) => {
    const on = document.getElementById(`wsOn${n}`).checked;
    return {
      weekday: n,
      is_working: on,
      work_type: document.getElementById(`wsType${n}`).value,
      start_time:
        fixed && on ? document.getElementById(`wsStart${n}`).value : null,
      end_time: fixed && on ? document.getElementById(`wsEnd${n}`).value : null,
    };
  });
  const payload = {
    name: document.getElementById("wsName").value.trim(),
    description: document.getElementById("wsDesc").value.trim(),
    mode: fixed ? "FIXED" : "FLEXIBLE",
    days,
  };
  if (fixed)
    payload.grace_minutes = Number(document.getElementById("wsGrace").value);
  else
    payload.min_daily_minutes = Number(
      document.getElementById("wsMinDaily").value,
    );
  return payload;
}
function validateWorkSchedulePayload(p) {
  if (!p.name) return "Vui lòng nhập tên lịch.";
  if (!p.days.some((d) => d.is_working))
    return "Lịch phải có ít nhất một ngày làm việc.";
  if (p.mode === "FIXED") {
    if (
      !Number.isInteger(p.grace_minutes) ||
      p.grace_minutes < 0 ||
      p.grace_minutes > 120
    )
      return "Dung sai phải từ 0 đến 120 phút.";
    for (const d of p.days.filter((x) => x.is_working)) {
      if (!d.start_time || !d.end_time)
        return `Vui lòng nhập giờ bắt đầu và kết thúc cho ${WEEKDAY_LABELS[d.weekday - 1]}.`;
      if (d.end_time <= d.start_time)
        return `Giờ kết thúc phải sau giờ bắt đầu (${WEEKDAY_LABELS[d.weekday - 1]}).`;
    }
  } else if (
    !Number.isInteger(p.min_daily_minutes) ||
    p.min_daily_minutes < 30 ||
    p.min_daily_minutes > 720
  )
    return "Số phút tối thiểu phải từ 30 đến 720.";
  return "";
}
async function saveWorkSchedule() {
  const payload = workSchedulePayload(),
    problem = validateWorkSchedulePayload(payload);
  if (problem) {
    setText("wsFormError", problem);
    return;
  }
  const button = document.getElementById("wsSaveButton");
  const creating = !wsEditingId;
  button.disabled = true;
  setText("wsFormError", "");
  try {
    const result = await wrRequest(
      wsEditingId ? `/work-schedules/${wsEditingId}` : "/work-schedules",
      postJson(payload, wsEditingId ? "PUT" : "POST"),
    );
    if (!result) return;
    if (!result.res.ok) {
      setText("wsFormError", wrApiError(result, "Không lưu được lịch."));
      return;
    }
    let applied = false;
    if (creating) {
      const scheduleId = Number(result.body?.data?.id || result.body?.data?.scheduleId || 0),
        targetType = document.getElementById("wsCreateTargetType")?.value || "DEFAULT",
        effectiveFrom = document.getElementById("wsCreateFrom")?.value || getVietnamToday(),
        effectiveTo = document.getElementById("wsCreateTo")?.value || "";
      if (scheduleId) {
        const assignment = { schedule_id: scheduleId, target_type: targetType, effective_from: effectiveFrom };
        if (targetType !== "DEFAULT") assignment.target_value = document.getElementById("wsCreateValue").value;
        if (effectiveTo) assignment.effective_to = effectiveTo;
        if (targetType === "DEFAULT" || assignment.target_value) {
          const assigned = await wrRequest("/work-schedules/assignments", postJson(assignment));
          if (!assigned?.res.ok) {
            showToast(wrApiError(assigned, "Đã tạo lịch nhưng chưa áp dụng được cho phạm vi đã chọn."), "error");
          } else {
            applied = true;
          }
        }
      }
    }
    showToast(applied ? "Đã tạo và áp dụng lịch làm việc." : "Đã tạo lịch làm việc.");
    switchWorkScheduleSection(applied ? "active" : "templates");
    await loadWorkSchedulesTab();
  } finally {
    button.disabled = false;
  }
}
async function deleteWorkSchedule(id) {
  const schedule = wsSchedules.find((s) => s.id === id);
  if (!confirm(`Xóa mẫu lịch "${schedule ? schedule.name : id}"? Các lần áp dụng đã kết thúc của mẫu này cũng sẽ bị xóa.`)) return;
  const result = await wrRequest(`/work-schedules/${id}`, {
    method: "DELETE",
  });
  if (!result) return;
  if (!result.res.ok) {
    showToast(wrApiError(result, "Không xóa được lịch."), "error");
    return;
  }
  showToast("Đã xóa mẫu lịch làm việc.");
  await loadWorkSchedulesTab();
}
function renderWorkScheduleList() {
  const edit = wsCanEdit();
  document.getElementById("wsList").innerHTML = wsSchedules.length
    ? `<div class="ws-card-stack">${wsSchedules.map((s) => `<article class="ws-schedule-card"><div class="ws-card-heading"><div><h3>${escapeHtml(s.name)}</h3><p>${escapeHtml(s.summary || "Chưa thiết lập khung giờ")}</p></div><span class="ws-badge ${s.id === 1 ? "is-green" : "is-gray"}">${s.id === 1 ? "Mặc định" : s.mode === "FIXED" ? "Giờ cố định" : "Giờ linh hoạt"}</span></div><div class="ws-card-meta">${s.mode === "FIXED" ? `Dung sai: ${Number(s.graceMinutes || 0)} phút` : `Tối thiểu: ${Number(s.minDailyMinutes || 0)} phút/ngày`} · ${Number(s.assignmentCount || 0)} lần áp dụng</div>${s.description && !(s.id === 1 && s.description === "Lịch làm việc mặc định toàn hệ thống") ? `<p class="ws-card-description">${escapeHtml(s.description)}</p>` : ""}${edit ? `<div class="ws-card-actions"><button type="button" class="ws-btn ws-btn-sm" onclick="showWorkScheduleForm(${Number(s.id)})"><i class="fa-regular fa-pen-to-square"></i> Sửa</button>${s.id === 1 ? "" : `<button type="button" class="ws-btn ws-btn-sm ws-btn-danger" onclick="deleteWorkSchedule(${Number(s.id)})"><i class="fa-regular fa-trash-can"></i> Xóa</button>`}</div>` : ""}</article>`).join("")}</div>`
    : `<div class="ws-empty-card"><div><h3>Chưa có mẫu lịch</h3><p>Tạo mẫu lịch đầu tiên để bắt đầu quản lý lịch làm việc.</p></div></div>`;
}
function assignmentStatus(a, today) {
  if (a.effectiveFrom > today) return pill("Sắp áp dụng", "ar-b-pending");
  if (a.effectiveTo && a.effectiveTo < today)
    return pill("Đã kết thúc", "ar-b-muted");
  return pill("Đang áp dụng", "ar-b-present");
}
function renderAssignments(rows) {
  const today = getVietnamToday(),
    edit = wsCanEdit();
  document.getElementById("wsAssignments").innerHTML =
    rows.length
      ? `<div class="ws-card-stack">${rows.map((a) => { const target = a.targetType === "INTERN" ? `Cá nhân (ID ${a.targetValue})` : a.targetLabel; return `<article class="ws-schedule-card"><div class="ws-card-heading"><div><h3>${escapeHtml(a.scheduleName)}</h3><p>${escapeHtml(target || "Phạm vi mặc định")}</p></div>${assignmentStatus(a, today)}</div><div class="ws-card-meta">${escapeHtml(a.effectiveFrom === "1970-01-01" ? "Từ trước đến nay" : formatDateOnly(a.effectiveFrom))} – ${a.effectiveTo ? escapeHtml(formatDateOnly(a.effectiveTo)) : "không giới hạn"} · ${escapeHtml(a.scheduleSummary || "")}</div>${edit && (a.targetType !== "DEFAULT" || (a.effectiveTo && a.effectiveTo < today)) ? `<div class="ws-card-actions"><button type="button" class="ws-btn ws-btn-sm ws-btn-danger" onclick="removeAssignment(${Number(a.id)})"><i class="fa-regular fa-trash-can"></i> Xóa áp dụng</button></div>` : ""}</article>`; }).join("")}</div>`
      : `<div class="ws-empty-card"><div><h3>Chưa có lịch đang áp dụng</h3><p>Áp dụng một mẫu lịch cho nhóm thực tập để hiển thị tại đây.</p></div></div>`;
}
function renderResolvedSchedules(rows) {
  document.getElementById("wsResolved").innerHTML = rows.length
    ? `<div class="ws-card-stack">${rows.map((r) => {
        const code = r.intern.studentCode ? `<span class="ws-intern-code">${escapeHtml(r.intern.studentCode)}</span>` : "";
        const univ = r.intern.university ? `<span class="ws-intern-univ">${escapeHtml(r.intern.university)}</span>` : "";
        const schedSummary = r.schedule
          ? `${r.schedule.name} · ${r.schedule.summary || ""}${r.source ? ` · Theo ${r.source.label}` : ""}`
          : "Chưa có lịch làm việc được phân công";
        return `<article class="ws-schedule-card ws-intern-schedule-card">
          <div class="ws-card-heading">
            <div class="ws-intern-col">
              <div class="ws-intern-title-line">
                <h3 class="ws-intern-name">${escapeHtml(r.intern.fullName)}</h3>
                ${code}
                ${univ}
              </div>
              <div class="ws-card-meta ws-intern-sched-meta">
                <i class="fa-regular fa-calendar-days"></i>
                <span>${escapeHtml(schedSummary)}</span>
              </div>
            </div>
            <div class="ws-intern-status">
              ${r.schedule ? `<span class="ws-badge is-green">Đang áp dụng</span>` : `<span class="ws-badge is-gray">Chưa có lịch</span>`}
            </div>
          </div>
        </article>`;
      }).join("")}</div>`
    : `<div class="ws-empty-card"><div><h3>Chưa có thực tập sinh nào</h3><p>Chưa có thực tập sinh nào đang hoặc sắp thực tập (cần hợp đồng đã xác nhận).</p></div></div>`;
}
function renderHolidays(rows) {
  const edit = wsCanEdit();
  const html = rows.length
    ? `<div class="ws-holiday-stack">${rows.map((h) => `<article class="ws-holiday-row"><span class="ws-holiday-icon"><i class="fa-regular fa-calendar"></i></span><div><strong>${escapeHtml(h.name)}</strong><span>${escapeHtml(formatDateOnly(h.holidayDate))}</span></div>${edit ? `<button type="button" class="ws-btn ws-btn-sm ws-btn-danger" onclick="removeWorkHoliday(${Number(h.id)})"><i class="fa-regular fa-trash-can"></i> Xóa</button>` : ""}</article>`).join("")}</div>`
    : `<div class="ws-empty-card"><div><h3>Chưa có ngày nghỉ nào được thiết lập.</h3><p>Ngày nghỉ chung không bị tính là vắng mặt trong báo cáo chuyên cần.</p></div></div>`;
  ["wsHolidays", "wsHolidayViewList"].forEach((id) => { const el = document.getElementById(id); if (el) el.innerHTML = html; });
}
async function loadWorkSchedulesTab() {
  document
    .querySelectorAll("#tab-work-schedules .ws-hr-only")
    .forEach((el) => el.classList.toggle("ws-hide", !wsCanEdit()));
  setText("wsError", "");
  const [schedules, assignments, resolved, holidays, options] =
    await Promise.all([
      wrRequest("/work-schedules"),
      wrRequest("/work-schedules/assignments"),
      wrRequest("/work-schedules/resolved"),
      wrRequest("/work-holidays"),
      loadWorkScopeOptions(true),
    ]);
  const failed = [schedules, assignments, resolved, holidays].find(
    (r) => r && !r.res.ok,
  );
  if (failed) {
    setText(
      "wsError",
      wrApiError(failed, "Không tải được dữ liệu lịch làm việc."),
    );
  }
  if (!schedules || !assignments || !resolved || !holidays) return;
  if (schedules.res.ok) {
    wsSchedules = schedules.body.data;
    renderWorkScheduleList();
    setText("wsStatTemplates", wsCount(wsSchedules.length));
  }
  if (assignments.res.ok) {
    renderAssignments(assignments.body.data);
    setText("wsStatAssignments", wsCount(assignments.body.data.length));
  }
  if (resolved.res.ok) renderResolvedSchedules(resolved.body.data);
  if (holidays.res.ok) {
    renderHolidays(holidays.body.data);
    setText("wsStatHolidays", wsCount(holidays.body.data.length));
  }
  const select = document.getElementById("wsAsSchedule"),
    keep = select.value;
  select.innerHTML = wsSchedules
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
    .join("");
  if (keep) select.value = keep;
  if (!document.getElementById("wsAsFrom").value)
    document.getElementById("wsAsFrom").value = getVietnamToday();
  void options;
  await updateAssignmentScope();
  updateAssignmentPreview();
}
async function updateAssignmentScope() {
  const type = document.getElementById("wsAsType").value;
  document.getElementById("wsAsValueWrap").style.display =
    type === "DEFAULT" ? "none" : "";
  if (type !== "DEFAULT") {
    setText(
      "wsAsValueLabel",
      type === "GROUP" ? "Nhóm thực tập" : type === "INTERN" ? "Thực tập sinh" : SCOPE_LABEL[type],
    );
    fillScopeSelect("wsAsValue", type, await loadWorkScopeOptions());
  }
  updateAssignmentPreview();
}
async function submitAssignment() {
  const type = document.getElementById("wsAsType").value,
    value = document.getElementById("wsAsValue").value;
  const scheduleId = document.getElementById("wsAsSchedule").value,
    from = document.getElementById("wsAsFrom").value,
    to = document.getElementById("wsAsTo").value;
  setText("wsAsError", "");
  if (!scheduleId) return setText("wsAsError", "Vui lòng chọn lịch làm việc.");
  if (type !== "DEFAULT" && !value)
    return setText("wsAsError", "Vui lòng chọn phạm vi áp dụng.");
  if (!from) return setText("wsAsError", "Vui lòng chọn ngày hiệu lực.");
  if (to && to < from)
    return setText(
      "wsAsError",
      "Ngày kết thúc không được trước ngày hiệu lực.",
    );
  const body = {
    schedule_id: Number(scheduleId),
    target_type: type,
    effective_from: from,
  };
  if (type !== "DEFAULT") body.target_value = value;
  if (to) body.effective_to = to;
  const result = await wrRequest("/work-schedules/assignments", postJson(body));
  if (!result) return;
  if (!result.res.ok)
    return setText("wsAsError", wrApiError(result, "Không áp dụng được lịch."));
  document.getElementById("wsAsTo").value = "";
  showToast("Đã áp dụng mẫu lịch cho phạm vi đã chọn.");
  switchWorkScheduleSection("active");
  await loadWorkSchedulesTab();
}
async function removeAssignment(id) {
  if (
    !confirm(
      "Xóa lần áp dụng lịch này? Nếu đang còn hiệu lực, nhóm sẽ quay về lịch của phạm vi rộng hơn; nếu đã kết thúc, báo cáo các ngày đã qua có thể thay đổi.",
    )
  )
    return;
  const result = await wrRequest(`/work-schedules/assignments/${id}`, {
    method: "DELETE",
  });
  if (!result) return;
  if (!result.res.ok)
    return showToast(wrApiError(result, "Không xóa được lần áp dụng."), "error");
  showToast("Đã xóa lần áp dụng lịch.");
  await loadWorkSchedulesTab();
}
async function addWorkHoliday() {
  const date = document.getElementById("wsHolDate").value,
    name = document.getElementById("wsHolName").value.trim();
  setText("wsHolError", "");
  if (!date || !name)
    return setText("wsHolError", "Vui lòng nhập ngày và tên ngày nghỉ.");
  const result = await wrRequest(
    "/work-holidays",
    postJson({ holiday_date: date, name }),
  );
  if (!result) return;
  if (!result.res.ok)
    return setText(
      "wsHolError",
      wrApiError(result, "Không thêm được ngày nghỉ."),
    );
  document.getElementById("wsHolName").value = "";
  const note = document.getElementById("wsHolNote");
  if (note) note.value = "";
  showToast("Đã thêm ngày nghỉ chung.");
  switchWorkScheduleSection("holidays");
  await loadWorkSchedulesTab();
}
async function removeWorkHoliday(id) {
  const result = await wrRequest(`/work-holidays/${id}`, {
    method: "DELETE",
  });
  if (!result) return;
  if (!result.res.ok)
    return showToast(wrApiError(result, "Không xóa được ngày nghỉ."), "error");
  showToast("Đã xóa ngày nghỉ.");
  await loadWorkSchedulesTab();
}
