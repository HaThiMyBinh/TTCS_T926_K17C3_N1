function meetingUrl() {
  return meetingMine ? "/me/meetings" : "/meetings";
}
async function meetingRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: authHeaders({
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    }),
    cache: "no-store",
  });
  if (response.status === 401) {
    forceLogout("Phiên đăng nhập đã hết hạn!");
    throw new Error("Phiên đăng nhập đã hết hạn.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      response.status >= 500
        ? "Không thể xử lý lịch họp. Vui lòng thử lại sau."
        : body.message || body.error || "Không có quyền truy cập cuộc họp.",
    );
  return body.data;
}
function setupMeetingPage(mine = false) {
  closeMeetingModal(false);
  meetingMine = mine;
  meetingPage = 1;
  const host = document.getElementById(
    mine ? "meetingMinePage" : "meetingStaffPage",
  );
  host.innerHTML = `<div class="card"><div class="card-body"><div class="meeting-toolbar"><h3>${mine ? "Lịch họp của tôi" : "Lịch họp"}</h3>${mine ? "" : '<button type="button" class="btn btn-primary" data-meeting-action="create">Tạo lịch họp</button>'}</div><form class="meeting-filters" id="meetingFilters"><label>Từ ngày<input type="date" id="meetingFrom" class="form-control"></label><label>Đến ngày<input type="date" id="meetingTo" class="form-control"></label><label>Trạng thái<select id="meetingStatus" class="form-control"><option value="">Tất cả</option><option value="SCHEDULED">Đã lên lịch</option><option value="CANCELLED">Đã hủy</option></select></label><label>Từ khóa<input id="meetingSearch" maxlength="100" class="form-control" placeholder="Tiêu đề cuộc họp"></label><button class="btn btn-primary" type="submit">Xem lịch</button></form><p id="meetingError" class="text-danger" role="alert"></p><div id="meetingList" aria-live="polite"></div><div id="meetingPages" class="meeting-toolbar"></div></div></div>`;
  // Only one pane owns the filter IDs at a time.
  document
    .getElementById(mine ? "meetingStaffPage" : "meetingMinePage")
    .replaceChildren();
  host.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    meetingPage = 1;
    loadMeetings();
  });
  loadMeetings();
}
async function loadMeetings() {
  const request = ++meetingListRequest,
    box = document.getElementById("meetingList"),
    error = document.getElementById("meetingError");
  if (!box) return;
  error.textContent = "";
  box.textContent = "Đang tải lịch họp...";
  const params = new URLSearchParams({
    page: String(meetingPage),
    pageSize: "20",
  });
  for (const [key, id] of [
    ["from", "meetingFrom"],
    ["to", "meetingTo"],
    ["status", "meetingStatus"],
    ["q", "meetingSearch"],
  ]) {
    const value = document.getElementById(id).value.trim();
    if (value) params.set(key, value);
  }
  try {
    const data = await meetingRequest(`${meetingUrl()}?${params}`);
    if (request !== meetingListRequest) return;
    box.innerHTML = data.items.length
      ? `<div class="table-container"><table><thead><tr><th>Cuộc họp</th><th>Giờ Việt Nam</th><th>Người tổ chức</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${data.items.map((m) => `<tr><td><strong>${escapeHtml(m.title)}</strong><span class="fr-sub">${escapeHtml(m.location || "Trực tuyến / chưa có địa điểm")}</span></td><td>${escapeHtml(meetingTime(m.startAt))}<span class="fr-sub">Đến ${escapeHtml(meetingTime(m.endAt))}</span></td><td>${escapeHtml(m.organizerName || "Chưa cập nhật")}</td><td>${m.status === "CANCELLED" ? "Đã hủy" : "Đã lên lịch"}</td><td><button class="btn btn-secondary btn-sm" data-meeting-action="detail" data-id="${Number(m.id)}">Xem chi tiết</button></td></tr>`).join("")}</tbody></table></div>`
      : '<p class="text-muted">Không có cuộc họp phù hợp.</p>';
    const p = data.pagination;
    document.getElementById("meetingPages").innerHTML =
      `<button class="btn btn-secondary btn-sm" data-meeting-action="previous" ${p.page <= 1 ? "disabled" : ""}>Trang trước</button><span>Trang ${Number(p.page)} / ${Number(p.totalPages)} · ${Number(p.total)} cuộc họp</span><button class="btn btn-secondary btn-sm" data-meeting-action="next" ${p.page >= p.totalPages ? "disabled" : ""}>Trang sau</button>`;
  } catch (err) {
    if (request === meetingListRequest) {
      box.textContent = "";
      error.textContent = err.message || "Không tải được lịch họp.";
    }
  }
}
function closeMeetingModal(restore = true) {
  ++meetingModalRequest;
  clearInterval(meetingPoll);
  meetingPoll = null;
  document.getElementById("meetingModal").style.display = "none";
  if (restore && meetingReturnFocus?.isConnected) meetingReturnFocus.focus();
}
function showMeetingModal(title) {
  clearInterval(meetingPoll);
  meetingPoll = null;
  if (document.getElementById("meetingModal").style.display !== "flex")
    meetingReturnFocus = document.activeElement;
  document.getElementById("meetingModalTitle").textContent = title;
  document.getElementById("meetingModalError").textContent = "";
  document.getElementById("meetingModal").style.display = "flex";
  document.querySelector("#meetingModal [data-meeting-action=close]").focus();
}
async function openMeeting(id) {
  const request = ++meetingModalRequest;
  showMeetingModal("Chi tiết cuộc họp");
  document.getElementById("meetingModalBody").textContent = "Đang tải...";
  async function refresh() {
    try {
      const m = await meetingRequest(`${meetingUrl()}/${Number(id)}`);
      if (request !== meetingModalRequest) return;
      const mutable =
        !meetingMine &&
        m.status === "SCHEDULED" &&
        new Date(m.startAt.replace(" ", "T") + "+07:00") > new Date();
      let link = "";
      try {
        const u = new URL(m.meetingLink);
        if (
          ["https:", "http:"].includes(u.protocol) &&
          !u.username &&
          !u.password
        )
          link = `<p><a href="${escapeHtml(u.href)}" target="_blank" rel="noopener noreferrer">Mở liên kết họp</a></p>`;
      } catch {
        /* Meeting may be offline. */
      }
      const logs = m.emailLogs || [];
      document.getElementById("meetingModalBody").innerHTML =
        `<h3>${escapeHtml(m.title)}</h3><p class="meeting-summary">${escapeHtml(meetingTime(m.startAt))} – ${escapeHtml(meetingTime(m.endAt))}\n${m.status === "CANCELLED" ? "Đã hủy" : "Đã lên lịch"}\n${escapeHtml(meetingScopeText(m))}Địa điểm: ${escapeHtml(m.location || "Chưa cập nhật")}\nNgười tổ chức: ${escapeHtml(m.organizerName || "Chưa cập nhật")}</p>${link}<p class="meeting-summary">${escapeHtml(m.description || "")}</p>${mutable ? `<div class="meeting-toolbar"><button class="btn btn-primary" data-meeting-action="edit" data-id="${Number(id)}">Sửa lịch</button><button class="btn btn-secondary" data-meeting-action="cancel" data-id="${Number(id)}">Hủy cuộc họp</button></div>` : ""}${meetingMine ? "" : `<h4>Người tham dự</h4><p>${(m.attendees || []).map((a) => escapeHtml(a.fullName)).join(", ") || "Không có người tham dự."}</p><h4 style="margin-top:16px">Email từng người</h4><div class="table-container"><table><thead><tr><th>Người nhận</th><th>Loại email</th><th>Trạng thái</th><th>Ghi chú</th><th></th></tr></thead><tbody>${logs.length ? logs.map((log) => `<tr><td>${escapeHtml(log.recipientName || "")}<span class="fr-sub">${escapeHtml(log.recipientEmail)}</span></td><td>${escapeHtml(Object.hasOwn(MEETING_EMAIL_LABELS, log.emailType) ? MEETING_EMAIL_LABELS[log.emailType] : log.emailType)}</td><td>${escapeHtml(Object.hasOwn(MEETING_STATUS_LABELS, log.status) ? MEETING_STATUS_LABELS[log.status] : log.status)}</td><td>${escapeHtml(log.errorMessage || "")}</td><td>${["FAILED", "RETRYING"].includes(log.status) ? `<button class="btn btn-primary btn-sm" data-meeting-action="retry" data-id="${Number(id)}" data-log-id="${Number(log.id)}">Gửi lại</button>` : "—"}</td></tr>`).join("") : '<tr><td colspan="5">Chưa có email.</td></tr>'}</tbody></table></div>`}`;
    } catch (err) {
      if (request === meetingModalRequest) {
        document.getElementById("meetingModalError").textContent = err.message;
        clearInterval(meetingPoll);
      }
    }
  }
  await refresh();
  if (request === meetingModalRequest && !meetingMine)
    meetingPoll = setInterval(() => {
      if (
        !document
          .getElementById("meetingModalBody")
          .contains(document.activeElement)
      )
        refresh();
    }, 5000);
}
let meetingCanScope = false,
  meetingGroups = [],
  meetingExclude = new Set(),
  meetingInclude = new Set();
const MEETING_SCOPE_LABEL = {
  PROGRAM: "Cả chương trình",
  GROUP: "Theo nhóm",
};
// Dòng "Phạm vi" trong chi tiết lịch họp (không hiện với lịch chọn tay).
function meetingScopeText(m) {
  if (!m || !MEETING_SCOPE_LABEL[m.scopeType]) return "";
  const target =
    m.scopeType === "GROUP"
      ? `${m.groupName || `Nhóm #${m.groupId}`} (${m.programName || "chương trình"})`
      : m.programName || `Chương trình #${m.programId}`;
  return `Phạm vi: ${MEETING_SCOPE_LABEL[m.scopeType]} – ${target}\n`;
}
function meetingRenderChecks(boxId, list, selected) {
  const box = document.getElementById(boxId);
  box.replaceChildren();
  for (const i of list) {
    const label = document.createElement("label"),
      input = document.createElement("input"),
      text = document.createElement("span");
    input.type = "checkbox";
    input.value = String(i.id);
    input.checked = selected.has(Number(i.id));
    input.addEventListener("change", () => {
      if (input.checked) selected.add(Number(i.id));
      else selected.delete(Number(i.id));
    });
    text.textContent = i.fullName;
    label.append(input, text);
    box.append(label);
  }
  if (!list.length) box.textContent = "Không có thực tập sinh.";
}
// Nạp thành viên theo phạm vi đang chọn và vẽ lại danh sách ngoại lệ.
async function meetingRefreshScope() {
  const scopeSelect = document.getElementById("meetingScope");
  if (!scopeSelect) return;
  const scope = scopeSelect.value,
    programId = document.getElementById("meetingProgram").value;
  const scoped = scope !== "INDIVIDUAL";
  document.getElementById("meetingIndividualBox").style.display = scoped
    ? "none"
    : "";
  document.getElementById("meetingScopeBox").style.display = scoped
    ? ""
    : "none";
  document.getElementById("meetingGroupLabel").style.display =
    scope === "GROUP" ? "" : "none";
  document.getElementById("meetingIncludeWrap").style.display =
    scope === "GROUP" ? "" : "none";
  if (!scoped) return;
  const hint = document.getElementById("meetingScopeHint");
  if (!programId) {
    hint.textContent = "Chọn chương trình ở trên để xác định người tham dự.";
    for (const id of ["meetingExcludeList", "meetingIncludeList"])
      document.getElementById(id).replaceChildren();
    return;
  }
  try {
    const members = (
      await meetingRequest(`/programs/${Number(programId)}/interns`)
    ).map((i) => ({ id: Number(i.id), fullName: i.fullName }));
    let base = members;
    if (scope === "GROUP") {
      const groupSelect = document.getElementById("meetingGroup");
      const keep = groupSelect.value;
      const groups = meetingGroups.filter(
        (g) => String(g.programId) === String(programId),
      );
      groupSelect.innerHTML = groups.length
        ? groups
            .map((g) => `<option value="${Number(g.id)}">${escapeHtml(g.name)}</option>`)
            .join("")
        : '<option value="">— Chương trình chưa có nhóm —</option>';
      if (groups.some((g) => String(g.id) === keep)) groupSelect.value = keep;
      base = groupSelect.value
        ? (await meetingRequest(`/groups/${Number(groupSelect.value)}/members`)).map(
            (i) => ({ id: Number(i.internId), fullName: i.fullName }),
          )
        : [];
      const inBase = new Set(base.map((i) => i.id));
      meetingRenderChecks(
        "meetingIncludeList",
        members.filter((i) => !inBase.has(i.id)),
        meetingInclude,
      );
    }
    hint.textContent =
      scope === "GROUP"
        ? `Thành viên nhóm: ${base.length} người`
        : `Thành viên chương trình: ${base.length} người`;
    meetingRenderChecks("meetingExcludeList", base, meetingExclude);
  } catch (err) {
    document.getElementById("meetingModalError").textContent = err.message;
  }
}
async function editMeeting(id = null, preset = null) {
  const request = ++meetingModalRequest;
  meetingEditId = id;
  meetingSelected = new Map();
  meetingExclude = new Set();
  meetingInclude = new Set();
  showMeetingModal(id ? "Sửa lịch họp" : "Tạo lịch họp");
  document.getElementById("meetingModalBody").textContent = "Đang tải...";
  try {
    const m = id ? await meetingRequest(`/meetings/${Number(id)}`) : null;
    const options = await meetingRequest("/meetings/options");
    if (request !== meetingModalRequest) return;
    meetingCanScope = Array.isArray(options.groups);
    meetingGroups = options.groups || [];
    for (const a of m?.attendees || []) meetingSelected.set(Number(a.id), a);
    for (const a of preset?.interns || []) meetingSelected.set(Number(a.id), a);
    for (const x of m?.excludeIds || []) meetingExclude.add(Number(x));
    for (const x of m?.includeIds || []) meetingInclude.add(Number(x));
    meetingRequestKey =
      globalThis.crypto?.randomUUID?.() ||
      `meeting_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    document.getElementById("meetingModalBody").innerHTML =
      `<form class="meeting-form" id="meetingForm"><label>Tiêu đề<input id="meetingTitle" class="form-control" maxlength="200" required></label><div class="form-grid"><label>Bắt đầu (giờ Việt Nam)<input type="datetime-local" id="meetingStart" class="form-control" required></label><label>Kết thúc (giờ Việt Nam)<input type="datetime-local" id="meetingEnd" class="form-control" required></label></div>${id ? "" : `<div class="form-grid"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="meetingRepeat"> Lặp lại hằng tuần</label><label id="meetingRepeatUntilWrap" style="display:none">Ngày kết thúc<input type="date" id="meetingRepeatUntil" class="form-control"></label></div>`}<label>Địa điểm<input id="meetingLocation" class="form-control" maxlength="255"></label><label>Liên kết họp<input id="meetingLink" class="form-control" type="url" maxlength="1000" placeholder="https://..."></label><label>Chương trình<select id="meetingProgram" class="form-control"><option value="">Không giới hạn theo chương trình</option></select></label><label>Mô tả<textarea id="meetingDescription" class="form-control" maxlength="4000" rows="3"></textarea></label>${meetingCanScope ? `<label>Cách chọn người tham dự<select id="meetingScope" class="form-control"><option value="INDIVIDUAL">Chọn từng người</option><option value="PROGRAM">Cả chương trình</option><option value="GROUP">Theo nhóm trong chương trình</option></select></label><label id="meetingGroupLabel" style="display:none">Nhóm<select id="meetingGroup" class="form-control"></select></label><fieldset id="meetingScopeBox" style="min-width:0;border:0;display:none"><legend>Người tham dự theo phạm vi</legend><p id="meetingScopeHint" class="fr-hint"></p><p><strong>Không mời (ngoại lệ):</strong></p><div id="meetingExcludeList" class="meeting-checks"></div><div id="meetingIncludeWrap" style="display:none"><p><strong>Mời thêm thành viên chương trình ngoài nhóm:</strong></p><div id="meetingIncludeList" class="meeting-checks"></div></div></fieldset>` : ""}<fieldset id="meetingIndividualBox" style="min-width:0;border:0"><legend>Người tham dự</legend><div class="meeting-toolbar"><input id="meetingAttendeeSearch" class="form-control" maxlength="100" placeholder="Tìm theo tên hoặc email"><button type="button" class="btn btn-secondary" data-meeting-action="search">Tìm</button></div><p id="meetingSelectedCount"></p><div id="meetingAttendees" class="meeting-checks"></div></fieldset><button id="meetingSave" class="btn btn-primary" type="submit">Lưu lịch họp</button></form>`;
    for (const [field, key] of [
      ["meetingTitle", "title"],
      ["meetingLocation", "location"],
      ["meetingLink", "meetingLink"],
      ["meetingDescription", "description"],
    ])
      document.getElementById(field).value = m?.[key] || "";
    if (preset?.title) document.getElementById("meetingTitle").value = preset.title;
    document.getElementById("meetingStart").value =
      m?.startAt?.replace(" ", "T").slice(0, 16) || "";
    document.getElementById("meetingEnd").value =
      m?.endAt?.replace(" ", "T").slice(0, 16) || "";
    const program = document.getElementById("meetingProgram");
    for (const p of options.programs)
      program.add(new Option(p.name, String(p.id)));
    if (m?.programId) {
      if (
        !Array.from(program.options).some(
          (o) => o.value === String(m.programId),
        )
      )
        program.add(
          new Option(
            m.programName || `Chương trình #${m.programId}`,
            String(m.programId),
          ),
        );
      program.value = String(m.programId);
    }
    if (!m && preset?.programId && !program.value) {
      const wanted = String(preset.programId);
      if (Array.from(program.options).some((o) => o.value === wanted))
        program.value = wanted;
    }
    renderMeetingAttendees(options.interns);
    if (meetingCanScope) {
      const scope = document.getElementById("meetingScope");
      scope.value = MEETING_SCOPE_LABEL[m?.scopeType] ? m.scopeType : "INDIVIDUAL";
      if (m?.scopeType === "GROUP") {
        const groupSelect = document.getElementById("meetingGroup");
        groupSelect.innerHTML = `<option value="${Number(m.groupId)}">${escapeHtml(m.groupName || "")}</option>`;
      }
      for (const el of [scope, document.getElementById("meetingProgram"), document.getElementById("meetingGroup")])
        el.addEventListener("change", () => {
          if (el.id !== "meetingGroup") meetingInclude.clear();
          meetingExclude.clear();
          meetingRefreshScope();
        });
      await meetingRefreshScope();
    }
    const repeatBox = document.getElementById("meetingRepeat");
    if (repeatBox)
      repeatBox.addEventListener("change", () => {
        const wrap = document.getElementById("meetingRepeatUntilWrap"),
          until = document.getElementById("meetingRepeatUntil");
        wrap.style.display = repeatBox.checked ? "" : "none";
        until.required = repeatBox.checked;
        if (repeatBox.checked && !until.value) {
          const start = document.getElementById("meetingStart").value;
          if (start) until.min = start.slice(0, 10);
        }
      });
    document
      .getElementById("meetingForm")
      .addEventListener("submit", saveMeeting);
    document.getElementById("meetingTitle").focus();
  } catch (err) {
    if (request === meetingModalRequest)
      document.getElementById("meetingModalError").textContent = err.message;
  }
}
function renderMeetingAttendees(interns) {
  const combined = new Map([
    ...meetingSelected,
    ...interns.map((i) => [Number(i.id), i]),
  ]);
  const box = document.getElementById("meetingAttendees");
  box.replaceChildren();
  for (const [id, i] of combined) {
    const label = document.createElement("label"),
      input = document.createElement("input"),
      text = document.createElement("span");
    input.type = "checkbox";
    input.value = String(id);
    input.checked = meetingSelected.has(id);
    text.textContent = `${i.fullName} — ${i.email || "Chưa có email"}`;
    input.addEventListener("change", () => {
      if (input.checked) meetingSelected.set(id, i);
      else meetingSelected.delete(id);
      document.getElementById("meetingSelectedCount").textContent =
        `Đã chọn ${meetingSelected.size} / 200 người`;
    });
    label.append(input, text);
    box.append(label);
  }
  if (!combined.size) box.textContent = "Không có thực tập sinh phù hợp.";
  document.getElementById("meetingSelectedCount").textContent =
    `Đã chọn ${meetingSelected.size} / 200 người`;
}
async function saveMeeting(event) {
  event.preventDefault();
  const button = document.getElementById("meetingSave"),
    error = document.getElementById("meetingModalError");
  button.disabled = true;
  error.textContent = "";
  try {
    const body = {
      title: document.getElementById("meetingTitle").value,
      description: document.getElementById("meetingDescription").value,
      start_at: document.getElementById("meetingStart").value,
      end_at: document.getElementById("meetingEnd").value,
      location: document.getElementById("meetingLocation").value,
      meeting_link: document.getElementById("meetingLink").value,
      program_id: document.getElementById("meetingProgram").value || null,
      ...(!meetingEditId ? { request_key: meetingRequestKey } : {}),
    };
    if (!meetingEditId && document.getElementById("meetingRepeat")?.checked) {
      const until = document.getElementById("meetingRepeatUntil").value;
      if (!until) throw new Error("Vui lòng chọn ngày kết thúc cho lịch lặp lại.");
      if (until < body.start_at.slice(0, 10))
        throw new Error("Ngày kết thúc không được trước ngày họp đầu tiên.");
      body.repeat_weekly = true;
      body.repeat_until = until;
    }
    const scope = document.getElementById("meetingScope")?.value || "INDIVIDUAL";
    if (scope === "INDIVIDUAL") body.attendee_ids = [...meetingSelected.keys()];
    else {
      body.scope_type = scope;
      body.exclude_ids = [...meetingExclude];
      if (scope === "GROUP") {
        body.group_id = Number(document.getElementById("meetingGroup").value) || null;
        body.include_ids = [...meetingInclude];
      }
    }
    const result = await meetingRequest(
      meetingEditId ? `/meetings/${Number(meetingEditId)}` : "/meetings",
      {
        method: meetingEditId ? "PUT" : "POST",
        body: JSON.stringify(body),
      },
    );
    await loadMeetings();
    // Đang tạo lịch từ trang "Nhóm của tôi": làm mới nhóm để thấy lịch mới.
    if (!document.getElementById("meetingList") && typeof loadMyGroups === "function")
      loadMyGroups();
    await openMeeting(result.id);
  } catch (err) {
    error.textContent = err.message || "Không lưu được lịch họp.";
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}
