async function programRequest(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) {
    const err = new Error(body.message || "Yêu cầu thất bại!");
    err.code = body.code;
    err.warnings = body.warnings;
    throw err;
  }
  return body.data;
}

// Bỏ chữ "Phòng" ở đầu tên phòng ban (vd: "Phòng Kinh doanh" -> "Kinh doanh").
function programDeptLabel(name) {
  const text = String(name || "")
    .normalize("NFC")
    .trim();
  const stripped = text.replace(/^ph[òo]ng\s+/i, "").trim();
  return stripped || text;
}

// Gộp các phòng ban trùng tên sau khi bỏ chữ "Phòng"; chỉ hiển thị 1 mục cho mỗi tên.
// programDeptPrimary: id bất kỳ -> id đại diện của nhóm (để chọn đúng khi sửa chương trình cũ).
let programDeptGroups = [];
let programDeptPrimary = {};
function programGroupDepartments(list) {
  const byKey = new Map();
  for (const department of list) {
    const label = programDeptLabel(department.name);
    const key = label.toLocaleLowerCase("vi");
    if (!byKey.has(key)) byKey.set(key, { label, ids: [] });
    byKey.get(key).ids.push(Number(department.id));
  }
  programDeptGroups = Array.from(byKey.values());
  programDeptPrimary = {};
  for (const group of programDeptGroups)
    for (const id of group.ids) programDeptPrimary[id] = group.ids[0];
}

async function programLoadDepartments() {
  const selectedFilter = document.getElementById(
    "programFilterDepartment",
  ).value;
  programDepartments = await programRequest("/departments");
  programGroupDepartments(programDepartments);
  const formOptions = programDeptGroups
    .map(
      (g) => `<option value="${g.ids[0]}">${escapeHtml(g.label)}</option>`,
    )
    .join("");
  // Bộ lọc: value là danh sách id các phòng ban cùng tên (vd "2,5")
  // để không sót chương trình.
  const options = programDeptGroups
    .map(
      (g) =>
        `<option value="${g.ids.join(",")}">${escapeHtml(g.label)}</option>`,
    )
    .join("");
  const departmentFilter = document.getElementById("programFilterDepartment");
  departmentFilter.innerHTML = `<option value="">Tất cả phòng ban</option>${options}`;
  departmentFilter.value = selectedFilter;
  document.getElementById("programDepartment").innerHTML = formOptions;
}

async function programLoad() {
  const rows = document.getElementById("programRows");
  if (!rows) return;

  try {
    await programLoadDepartments();
    const params = new URLSearchParams();
    const departmentId = document.getElementById(
      "programFilterDepartment",
    ).value;
    const status = document.getElementById("programFilterStatus").value;
    const timeState = document.getElementById("programFilterTimeState").value;
    const departmentIds = departmentId ? departmentId.split(",") : [];
    if (departmentIds.length === 1)
      params.set("department_id", departmentIds[0]);
    if (status) params.set("status", status);
    if (timeState) params.set("time_state", timeState);

    programItems = await programRequest(
      `/programs${params.size ? `?${params}` : ""}`,
    );
    if (departmentIds.length > 1)
      programItems = programItems.filter((program) =>
        departmentIds.includes(String(program.department_id)),
      );
    const editable = currentRole === "HR";
    document.getElementById("programAddButton").style.display = editable
      ? ""
      : "none";
    rows.innerHTML = programItems.length
      ? programItems
          .map((program) => programRenderRow(program, editable))
          .join("")
      : '<tr><td colspan="6">Chưa có chương trình.</td></tr>';
  } catch (err) {
    rows.innerHTML = `<tr><td colspan="6" class="program-error">${escapeHtml(err.message)}</td></tr>`;
  }
}

function programRenderRow(program, editable) {
  const actions = editable
    ? `<div class="program-actions">
               <button class="btn btn-sm btn-soft" onclick="programMentorOpen(${Number(program.id)})"><i class="fa-solid fa-user-group"></i> Thực tập sinh &amp; mentor</button>
               <button class="btn btn-sm btn-soft" onclick="programGroupOpen(${Number(program.id)})"><i class="fa-solid fa-people-group"></i> Nhóm</button>
               <button class="btn btn-sm btn-soft-gray" onclick="programEdit(${Number(program.id)})">Sửa</button>
               <button class="btn btn-sm btn-soft-danger" onclick="programDelete(${Number(program.id)})">Xóa</button>
             </div>`
    : "";
  const capacity = program.capacity == null ? "—" : Number(program.capacity);

  const timeStateLabels = {
    UPCOMING: "Sắp diễn ra",
    RUNNING: "Đang diễn ra",
    ENDED: "Đã kết thúc",
    UNSCHEDULED: "Chưa đặt lịch",
  };
  const period =
    program.time_state === "UNSCHEDULED"
      ? "Chưa đặt lịch"
      : `${escapeHtml(programFormatDate(program.start_date))} – ${escapeHtml(programFormatDate(program.end_date))} · ${escapeHtml(program.duration_days)} ngày`;

  return `<tr>
          <td>${escapeHtml(program.name)}</td>
          <td>${escapeHtml(programDeptLabel(program.department_name))}</td>
          <td><span class="program-period">${period}</span><span class="program-time-badge">${escapeHtml(timeStateLabels[program.time_state] || program.time_state)}</span></td>
          <td>${capacity}</td>
          <td><span class="program-status">${escapeHtml(program.status)}</span></td>
          <td>${actions}</td>
        </tr>`;
}
async function programMentorOpen(programId) {
  pmProgramId = programId;
  const program = programItems.find((p) => Number(p.id) === Number(programId));
  document.getElementById("pmTitle").innerText =
    `Thực tập sinh & mentor – ${program ? program.name : ""}`;
  setText("pmError", "");
  document.getElementById("pmSearch").value = "";
  document.getElementById("pmAddBox").open = false;
  document.getElementById("programMentorModal").style.display = "flex";
  try {
    const mentorRes = await fetch(`${API_BASE}/mentors`, {
      headers: authHeaders(),
    }).then((r) => r.json().catch(() => []));
    const allMentors = Array.isArray(mentorRes) ? mentorRes : [];
    // Hiện TẤT CẢ mentor; mentor cùng phòng ban với chương trình xếp lên đầu.
    // Mentor khác phòng ban vẫn chọn được (backend chỉ cảnh báo mềm, cần xác nhận).
    const normDept = (v) => String(v || "").trim().toLowerCase();
    const programDept = normDept(program?.department_name);
    const sameDept = (m) => normDept(m.department) === programDept;
    const mentors = [...allMentors].sort(
      (a, b) => Number(sameDept(b)) - Number(sameDept(a)),
    );
    document.getElementById("pmMentor").innerHTML =
      '<option value="">-- Chọn mentor --</option>' +
      mentors
        .map(
          (m) =>
            `<option value="${Number(m.id)}">${escapeHtml(m.fullName)}${m.department ? ` (${escapeHtml(m.department)})` : ""}${sameDept(m) ? "" : " ⚠ khác phòng ban"} · ${Number(m.activeInterns || 0)} TTS</option>`,
        )
        .join("");
    document.getElementById("pmMentor").value = "";
    if (!mentors.length)
      setText(
        "pmError",
        "Chưa có mentor nào trong hệ thống. Hãy thêm mentor trước khi phân công.",
      );
  } catch (err) {
    setText("pmError", err.message);
  }
  await programMentorReload();
}
async function programMentorReload() {
  document.getElementById("pmAll").checked = false;
  try {
    [pmInterns, pmAvailable] = await Promise.all([
      programRequest(`/programs/${pmProgramId}/interns`),
      programRequest(`/programs/${pmProgramId}/available-interns`),
    ]);
  } catch (err) {
    pmInterns = [];
    pmAvailable = [];
    setText("pmError", err.message);
  }
  document.getElementById("pmRows").innerHTML = pmInterns.length
    ? pmInterns
        .map(
          (i) =>
            `<tr><td><input type="checkbox" class="pm-check" value="${Number(i.id)}" onchange="programMentorUpdateButton()" aria-label="Chọn ${escapeHtml(i.fullName)}" /></td><td>${escapeHtml(i.fullName)}<span class="fr-sub">${escapeHtml(i.studentCode || "")}</span></td><td>${escapeHtml(i.university || "")}</td><td>${i.mentorName ? escapeHtml(i.mentorName) : "<em>Chưa phân công</em>"}</td><td class="pm-result"></td><td><div class="pm-actions"><button ${["COMPLETED", "NOT_COMPLETED"].includes(i.completionStatus) ? "disabled" : ""} class="btn btn-sm btn-danger" onclick="programMentorRemove(${Number(i.id)})">Gỡ khỏi CT</button></div></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="6">Chương trình chưa có thực tập sinh. Mở mục "Thêm thực tập sinh vào chương trình" ở trên để thêm.</td></tr>';
  programMentorRenderResults();
  programMentorRenderAvailable();
  programMentorUpdateButton();
}
function programMentorRenderAvailable() {
  const q = document
    .getElementById("pmSearch")
    .value.trim()
    .toLocaleLowerCase("vi");
  const rows = pmAvailable.filter(
    (i) =>
      !q ||
      [i.fullName, i.studentCode, i.university].some((v) =>
        String(v || "")
          .toLocaleLowerCase("vi")
          .includes(q),
      ),
  );
  document.getElementById("pmAvailable").innerHTML = rows.length
    ? rows
        .map(
          (i) =>
            `<tr><td style="width:36px"><input type="checkbox" class="pm-add-check" value="${Number(i.id)}" aria-label="Chọn ${escapeHtml(i.fullName)}" /></td><td>${escapeHtml(i.fullName)}<span class="fr-sub">${escapeHtml(i.studentCode || "")}</span></td><td>${escapeHtml(i.university || "")}</td></tr>`,
        )
        .join("")
    : "<tr><td>Không còn thực tập sinh nào để thêm.</td></tr>";
}
async function programMentorAdd() {
  const ids = [
    ...document.querySelectorAll("#pmAvailable .pm-add-check:checked"),
  ].map((c) => Number(c.value));
  if (!ids.length)
    return setText("pmError", "Vui lòng chọn thực tập sinh cần thêm.");
  setText("pmError", "");
  try {
    const r = await programRequest(`/programs/${pmProgramId}/interns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intern_ids: ids }),
    });
    showToast(`Đã thêm ${r.added} thực tập sinh vào chương trình.`);
    await programMentorReload();
  } catch (err) {
    setText("pmError", err.message);
  }
}
function programMentorRenderResults() {
  const rows = document.querySelectorAll("#pmRows tr");
  pmInterns.forEach((intern, index) => {
    const cell = rows[index]?.querySelector(".pm-result");
    if (!cell) return;
    const finalized = ["COMPLETED", "NOT_COMPLETED"].includes(
      intern.completionStatus,
    );
    const status = intern.completionStatus || "IN_PROGRESS";
    const canEdit =
      !finalized && getRolePermissions(currentRole).includes("VIEW_REPORTS");
    // Khi sửa được thì ô chọn đã hiện trạng thái, không lặp thêm nhãn.
    if (!canEdit)
      cell.append(crElement("strong", programResultLabels[status] || status));
    if (intern.completedAt)
      cell.append(
        crElement(
          "p",
          `Xác nhận: ${String(intern.completedAt).replace("T", " ")}`,
        ),
      );
    if (intern.completedBy)
      cell.append(crElement("p", `HR xác nhận (mã): ${intern.completedBy}`));
    if (
      finalized ||
      !getRolePermissions(currentRole).includes("VIEW_REPORTS")
    ) {
      if (intern.completionNote)
        cell.append(crElement("p", intern.completionNote));
      return;
    }
    const select = document.createElement("select");
    select.className = "form-control";
    select.setAttribute("aria-label", `Kết quả của ${intern.fullName}`);
    for (const [value, label] of Object.entries(programResultLabels))
      select.add(new Option(label, value));
    select.value = status;
    const note = document.createElement("input");
    note.className = "form-control";
    note.maxLength = 500;
    note.value = intern.completionNote || "";
    note.placeholder = "Ghi chú (bắt buộc nếu không hoàn thành)";
    note.setAttribute("aria-label", `Ghi chú kết quả của ${intern.fullName}`);
    const save = crElement(
      "button",
      "Lưu kết quả",
      "btn btn-sm btn-primary pm-save-result",
    );
    save.type = "button";
    const currentProgram = pmProgramId;
    save.addEventListener("click", async () => {
      if (
        ["COMPLETED", "NOT_COMPLETED"].includes(select.value) &&
        !confirm(
          `Chốt kết quả “${programResultLabels[select.value]}” cho ${intern.fullName}? Kết quả sẽ được giữ và không thể ghi đè.`,
        )
      )
        return;
      save.disabled = true;
      setText("pmError", "");
      try {
        await programRequest(
          `/programs/${currentProgram}/interns/${intern.id}/completion`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              completion_status: select.value,
              note: note.value,
            }),
          },
        );
        if (pmProgramId === currentProgram) await programMentorReload();
        showToast("Đã lưu kết quả riêng của chương trình.", "success");
      } catch (err) {
        setText("pmError", err.message);
        save.disabled = false;
      }
    });
    const editor = document.createElement("div");
    editor.className = "pm-result-edit";
    editor.append(select, note, save);
    cell.append(editor);
  });
}

async function programMentorRemove(internId) {
  if (
    !confirm(
      "Gỡ thực tập sinh này khỏi chương trình? (mentor của họ không bị thay đổi)",
    )
  )
    return;
  setText("pmError", "");
  try {
    await programRequest(`/programs/${pmProgramId}/interns/${internId}`, {
      method: "DELETE",
    });
    await programMentorReload();
  } catch (err) {
    setText("pmError", err.message);
  }
}
function programMentorClose() {
  document.getElementById("programMentorModal").style.display = "none";
}
function programMentorSelected() {
  return [...document.querySelectorAll("#pmRows .pm-check:checked")].map((c) =>
    Number(c.value),
  );
}
function programMentorToggleAll(checked) {
  document.querySelectorAll("#pmRows .pm-check").forEach((c) => {
    c.checked = checked;
  });
  programMentorUpdateButton();
}
function programMentorUpdateButton() {
  const n = programMentorSelected().length,
    hasMentor = !!document.getElementById("pmMentor").value;
  const btn = document.getElementById("pmSubmit");
  btn.disabled = n === 0 || !hasMentor;
  btn.innerText = !hasMentor
    ? "Chọn mentor"
    : n
      ? `Phân công mentor cho ${n} thực tập sinh`
      : "Chọn thực tập sinh";
}
async function programMentorSubmit() {
  const ids = programMentorSelected(),
    mentorValue = document.getElementById("pmMentor").value;
  if (!ids.length)
    return setText("pmError", "Vui lòng chọn ít nhất một thực tập sinh.");
  if (!mentorValue)
    return setText("pmError", "Vui lòng chọn mentor hướng dẫn.");
  const btn = document.getElementById("pmSubmit");
  btn.disabled = true;
  setText("pmError", "");
  try {
    const send = (confirmed) =>
      programRequest(`/programs/${pmProgramId}/mentor`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mentor_id: Number(mentorValue),
          intern_ids: ids,
          ...(confirmed ? { confirm_warnings: true } : {}),
        }),
      });
    let result;
    try {
      result = await send(false);
    } catch (err) {
      if (
        err.code !== "NEEDS_CONFIRMATION" ||
        !confirmAssignmentWarnings(err.warnings)
      )
        throw err;
      result = await send(true);
    }
    showToast(
      result.updated
        ? `Đã cập nhật mentor cho ${result.updated} thực tập sinh${result.unchanged ? ` (${result.unchanged} người không đổi)` : ""}.`
        : "Không có thay đổi nào.",
      result.updated ? "success" : "info",
    );
    await programMentorReload();
  } catch (err) {
    setText("pmError", err.message);
    btn.disabled = false;
  }
}

function programOpenModal(item = null) {
  document.getElementById("programError").innerText = "";
  document.getElementById("programModalTitle").innerText = item
    ? "Sửa chương trình"
    : "Thêm chương trình";
  document.getElementById("programId").value = item?.id || "";
  document.getElementById("programName").value = item?.name || "";
  document.getElementById("programDescription").value = item?.description || "";
  document.getElementById("programStartDate").value = item?.start_date || "";
  document.getElementById("programEndDate").value = item?.end_date || "";
  document.getElementById("programCapacity").value = item?.capacity ?? "";
  document.getElementById("programStatus").value = item?.status || "DRAFT";
  document.getElementById("programDepartment").value =
    programDeptPrimary[item?.department_id] ||
    programDeptGroups[0]?.ids[0] ||
    "";
  programUpdateDateConstraints();
  document.getElementById("programModal").style.display = "flex";
}

function programFormatDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return "—";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function programDateOrdinal(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    return null;
  return Math.floor(parsed.getTime() / 86400000);
}

function programUpdateDateConstraints() {
  const startDate = document.getElementById("programStartDate").value;
  document.getElementById("programEndDate").min = startDate;
}

function programValidateDateForm() {
  const startDate = document.getElementById("programStartDate").value;
  const endDate = document.getElementById("programEndDate").value;
  const status = document.getElementById("programStatus").value;
  const error = document.getElementById("programError");
  const start = startDate ? programDateOrdinal(startDate) : null;
  const end = endDate ? programDateOrdinal(endDate) : null;
  error.innerText = "";

  if ((status === "OPEN" || status === "ONGOING") && (!startDate || !endDate)) {
    error.innerText =
      "Chương trình OPEN hoặc ONGOING phải có đủ ngày bắt đầu và kết thúc!";
    return false;
  }
  if ((startDate && start == null) || (endDate && end == null)) {
    error.innerText = "Ngày phải đúng định dạng YYYY-MM-DD và là ngày có thật!";
    return false;
  }
  if (start != null && end != null && end < start) {
    error.innerText = "Ngày kết thúc không được trước ngày bắt đầu!";
    return false;
  }
  if (
    start != null &&
    end != null &&
    end - start + 1 > programMaxDurationDays
  ) {
    error.innerText = `Thời lượng chương trình không được vượt quá ${programMaxDurationDays} ngày!`;
    return false;
  }
  return true;
}

function programEdit(id) {
  const item = programItems.find(
    (program) => Number(program.id) === Number(id),
  );
  if (item) programOpenModal(item);
}

function programCloseModal() {
  document.getElementById("programModal").style.display = "none";
}

async function programSave(event) {
  event.preventDefault();
  programUpdateDateConstraints();
  if (!programValidateDateForm()) return;
  const id = document.getElementById("programId").value;
  const payload = {
    name: document.getElementById("programName").value,
    department_id: document.getElementById("programDepartment").value,
    description: document.getElementById("programDescription").value,
    start_date: document.getElementById("programStartDate").value || null,
    end_date: document.getElementById("programEndDate").value || null,
    capacity: document.getElementById("programCapacity").value || null,
    status: document.getElementById("programStatus").value,
  };

  try {
    await programRequest(`/programs${id ? `/${id}` : ""}`, {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    programCloseModal();
    await programLoad();
  } catch (err) {
    document.getElementById("programError").innerText = err.message;
  }
}

async function programQuickDepartment() {
  const name = prompt("Tên phòng ban mới:");
  if (!name) return;

  try {
    const department = await programRequest("/departments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await programLoadDepartments();
    document.getElementById("programDepartment").value =
      programDeptPrimary[department.id] || department.id;
  } catch (err) {
    document.getElementById("programError").innerText = err.message;
  }
}

async function programDelete(id) {
  const item = programItems.find(
    (program) => Number(program.id) === Number(id),
  );
  if (!item || !confirm("Bạn có chắc muốn xóa chương trình thực tập này?"))
    return;

  try {
    await programRequest(`/programs/${id}`, { method: "DELETE" });
    await programLoad();
    showToast("Đã xóa chương trình thực tập.", "success");
  } catch (err) {
    showToast(err.message || "Không xóa được chương trình thực tập.", "error");
  }
}
