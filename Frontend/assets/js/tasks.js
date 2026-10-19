function taskBadge(map, key) {
  const ui = map[key] || { label: key, cls: "badge-pending" };
  return `<span class="badge ${ui.cls}">${escapeHtml(ui.label)}</span>`;
}

function formatTaskDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "Không có hạn";
}

function taskDueCell(task) {
  const text = escapeHtml(formatTaskDate(task.due_date));
  return task.is_overdue
    ? `<span style="color:#b91c1c;font-weight:600">${text}</span><br /><span class="badge badge-rejected">Quá hạn</span>`
    : text;
}

function formatProgressTime(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

// Thanh tiến độ + ghi chú + thời điểm cập nhật (dùng cho cả mentor và intern).
function taskProgressCell(task) {
  const pct = Math.min(100, Math.max(0, Number(task.progress_percent) || 0));
  const when = formatProgressTime(task.progress_updated_at);
  return `<div class="task-progress">
          <div class="task-progress-bar"><span class="${pct === 100 ? "done" : ""}" style="width:${pct}%"></span></div>
          <div class="task-progress-meta"><b>${pct}%</b><span>${when ? escapeHtml(when) : "Chưa cập nhật"}</span></div>
          ${task.progress_note ? `<div class="task-progress-note">${escapeHtml(task.progress_note)}</div>` : ""}
          ${taskAttachmentList(task)}
        </div>`;
}

// Danh sách tệp đính kèm của một nhiệm vụ (mentor và intern đều tải được).
function taskAttachmentList(task, { removable = false } = {}) {
  const files = Array.isArray(task.attachments) ? task.attachments : [];
  if (!files.length) return "";
  const items = files
    .map((f) => {
      const name = escapeHtml(f.original_name);
      const open = f.can_preview
        ? `<a onclick="downloadTaskAttachment(${Number(task.id)}, ${Number(f.id)}, ${escapeHtml(JSON.stringify(f.original_name))}, true)" title="Xem">${name}</a>`
        : `<a onclick="downloadTaskAttachment(${Number(task.id)}, ${Number(f.id)}, ${escapeHtml(JSON.stringify(f.original_name))}, false)" title="Tải xuống">${name}</a>`;
      const remove = removable
        ? `<button type="button" class="att-remove" title="Xóa file" onclick="removeTaskAttachment(${Number(task.id)}, ${Number(f.id)})"><i class="fa-solid fa-xmark"></i></button>`
        : "";
      return `<li><i class="fa-solid fa-paperclip"></i><span class="att-name">${open}</span><span class="att-size">${escapeHtml(formatFileSize(f.size_bytes))}</span>${remove}</li>`;
    })
    .join("");
  return `<ul class="task-attachments">${items}</ul>`;
}

// Tải/xem tệp đính kèm qua API có phân quyền (fetch kèm token rồi mở blob).
async function downloadTaskAttachment(
  taskId,
  attachmentId,
  filename,
  inline = false,
) {
  try {
    const res = await fetch(
      `${API_BASE}/tasks/${Number(taskId)}/attachments/${Number(attachmentId)}/download${inline ? "?disposition=inline" : ""}`,
      { headers: authHeaders() },
    );
    if (res.status === 401)
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.message || "Tải tệp đính kèm thất bại!", "error");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (inline) {
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return;
    }
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = filename || "attachment";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  } catch (err) {
    showToast("Lỗi khi tải tệp đính kèm!", "error");
  }
}

function taskTodayString() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function setTaskFormMode(editing) {
  document.getElementById("taskFormTitle").innerText = editing
    ? "Chỉnh sửa nhiệm vụ"
    : "Giao nhiệm vụ mới";
  document.getElementById("btnSaveTask").innerHTML = editing
    ? `<i class="fa-solid fa-floppy-disk"></i> Lưu thay đổi`
    : `<i class="fa-solid fa-paper-plane"></i> Giao nhiệm vụ`;
  document.getElementById("btnCancelTask").style.display = editing
    ? ""
    : "none";
  document.getElementById("taskStatusGroup").style.display = editing
    ? ""
    : "none";
  document.getElementById("taskIntern").disabled = editing;
  // Khi sửa, hạn cũ có thể đã qua nên chỉ chặn ngày quá khứ ở form giao mới
  // (server vẫn kiểm tra).
  const due = document.getElementById("taskDueDate");
  if (editing) due.removeAttribute("min");
  else due.min = taskTodayString();
}

function resetTaskForm() {
  document.getElementById("taskForm").reset();
  document.getElementById("taskEditId").value = "";
  setTaskFormMode(false);
}

async function loadTasksTab() {
  if (currentRole !== "Mentor") {
    // Admin có thể cấp quyền ASSIGN_TASKS cho vai trò khác, nhưng chỉ Mentor
    // mới giao được việc.
    document.getElementById("taskForm").style.display = "none";
    document.getElementById("taskTableBody").innerHTML =
      `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:24px">Chỉ vai trò Mentor mới giao và quản lý được nhiệm vụ.</td></tr>`;
    return;
  }
  setTaskFormMode(!!document.getElementById("taskEditId").value);
  await loadTaskInterns();
  await loadTasks();
}

async function loadTaskInterns() {
  const internSelect = document.getElementById("taskIntern");
  const filterSelect = document.getElementById("taskFilterIntern");
  const keepIntern = internSelect.value;
  const keepFilter = filterSelect.value;
  try {
    const res = await fetch(`${API_BASE}/mentors/me/interns`, {
      headers: authHeaders(),
    });
    if (res.status === 401)
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    const data = await res.json();
    if (!res.ok)
      throw new Error(data.error || "Không thể tải thực tập sinh của bạn.");
    taskInterns = Array.isArray(data) ? data : [];
  } catch (err) {
    taskInterns = [];
    showAlert(
      document.getElementById("taskAlert"),
      err.message || "Không thể tải thực tập sinh của bạn.",
      "error",
    );
  }
  const options = taskInterns
    .map(
      (s) =>
        `<option value="${Number(s.id)}">${escapeHtml(s.fullName)}${s.studentCode ? ` (${escapeHtml(s.studentCode)})` : ""}</option>`,
    )
    .join("");
  internSelect.innerHTML = `<option value="">-- Chọn thực tập sinh --</option>${options}`;
  filterSelect.innerHTML = `<option value="">Tất cả thực tập sinh</option>${options}`;
  internSelect.value = keepIntern;
  filterSelect.value = keepFilter;
  if (internSelect.value !== keepIntern) internSelect.value = "";
  if (filterSelect.value !== keepFilter) filterSelect.value = "";
  const hasInterns = taskInterns.length > 0;
  document.getElementById("taskNoInternNote").style.display = hasInterns
    ? "none"
    : "block";
  document.getElementById("taskForm").style.display = hasInterns ? "" : "none";
}

async function loadTasks() {
  const tbody = document.getElementById("taskTableBody");
  const requestId = ++taskLoadSeq;
  const internId = document.getElementById("taskFilterIntern").value;
  const statusFilter = document.getElementById("taskFilterStatus").value;
  const params = new URLSearchParams();
  if (internId) params.set("intern_id", internId);
  if (statusFilter) params.set("status", statusFilter);
  const qs = params.toString();
  try {
    const res = await fetch(`${API_BASE}/tasks${qs ? `?${qs}` : ""}`, {
      headers: authHeaders(),
    });
    if (res.status === 401)
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    const body = await res.json();
    if (requestId !== taskLoadSeq) return;
    if (!res.ok || !body.success)
      throw new Error(
        body.message || body.error || "Không thể tải danh sách nhiệm vụ.",
      );
    taskList = Array.isArray(body.data) ? body.data : [];
    renderTasks(!!(internId || statusFilter));
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#b91c1c;padding:24px">${escapeHtml(err.message || "Lỗi tải danh sách")}</td></tr>`;
  }
}

function renderTasks(filtered) {
  const tbody = document.getElementById("taskTableBody");
  if (!taskList.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px">${filtered ? "Không có nhiệm vụ nào khớp bộ lọc" : "Bạn chưa giao nhiệm vụ nào"}</td></tr>`;
    return;
  }
  tbody.innerHTML = taskList
    .map(
      (t) => `<tr>
            <td><b>${escapeHtml(t.intern_name)}</b>${t.student_code ? `<br /><span style="font-size:13px;color:#64748b">${escapeHtml(t.student_code)}</span>` : ""}</td>
            <td>
              <b>${escapeHtml(t.title)}</b>
              ${t.description ? `<div style="font-size:13px;color:#64748b;white-space:pre-wrap;max-width:360px">${escapeHtml(t.description)}</div>` : ""}
            </td>
            <td>${taskDueCell(t)}</td>
            <td>${taskBadge(TASK_PRIORITY_UI, t.priority)}</td>
            <td>${taskBadge(TASK_STATUS_UI, t.status)}</td>
            <td>${taskProgressCell(t)}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-sm btn-outline-primary" onclick="startEditTask(${Number(t.id)})"><i class="fa-solid fa-pen"></i> Sửa</button>
              <button class="btn btn-sm btn-outline-danger" onclick="deleteTask(${Number(t.id)})"><i class="fa-solid fa-trash"></i> Xóa</button>
            </td>
          </tr>`,
    )
    .join("");
}

async function handleSaveTask(e) {
  e.preventDefault();
  const alertBox = document.getElementById("taskAlert");
  const btn = document.getElementById("btnSaveTask");
  const editId = document.getElementById("taskEditId").value;
  const payload = {
    title: document.getElementById("taskTitle").value.trim(),
    description: document.getElementById("taskDescription").value.trim(),
    due_date: document.getElementById("taskDueDate").value || null,
    priority: document.getElementById("taskPriority").value,
  };
  if (editId) {
    payload.status = document.getElementById("taskStatus").value;
  } else {
    payload.intern_id = Number(document.getElementById("taskIntern").value);
  }

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang xử lý...`;
  try {
    const res = await fetch(
      editId ? `${API_BASE}/tasks/${editId}` : `${API_BASE}/tasks`,
      {
        method: editId ? "PATCH" : "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      },
    );
    if (res.status === 401)
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    const body = await res.json();
    if (!res.ok || !body.success) {
      showAlert(
        alertBox,
        body.message || body.error || "Không thể lưu nhiệm vụ.",
        "error",
      );
      return;
    }
    showAlert(alertBox, body.message, "success");
    resetTaskForm();
    await loadTasks();
  } catch (err) {
    showAlert(alertBox, "Lỗi kết nối server!", "error");
  } finally {
    btn.disabled = false;
    setTaskFormMode(!!document.getElementById("taskEditId").value);
  }
}

function startEditTask(id) {
  const task = taskList.find((t) => Number(t.id) === Number(id));
  if (!task) return;
  document.getElementById("taskEditId").value = String(task.id);
  document.getElementById("taskIntern").value = String(task.intern_id);
  document.getElementById("taskTitle").value = task.title;
  document.getElementById("taskDescription").value = task.description || "";
  document.getElementById("taskDueDate").value = task.due_date || "";
  document.getElementById("taskPriority").value = task.priority;
  document.getElementById("taskStatus").value = task.status;
  setTaskFormMode(true);
  document.querySelector(".content-scroll").scrollTop = 0;
}

async function deleteTask(id) {
  if (!confirm("Bạn có chắc chắn muốn xóa nhiệm vụ này không?")) return;
  try {
    const res = await fetch(`${API_BASE}/tasks/${Number(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (res.status === 401)
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    const body = await res.json();
    if (!res.ok || !body.success) {
      showToast(
        body.message || body.error || "Không thể xóa nhiệm vụ.",
        "error",
      );
      return;
    }
    showToast(body.message, "success");
    if (document.getElementById("taskEditId").value === String(id))
      resetTaskForm();
    await loadTasks();
  } catch (err) {
    showToast("Lỗi kết nối server!", "error");
  }
}

async function loadMyTasks() {
  if (currentRole !== "Intern") return;
  const tbody = document.getElementById("myTaskTableBody");
  try {
    const res = await fetch(`${API_BASE}/me/tasks`, {
      headers: authHeaders(),
    });
    if (res.status === 401)
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    const body = await res.json();
    if (!res.ok || !body.success)
      throw new Error(
        body.message || body.error || "Không thể tải nhiệm vụ của bạn.",
      );
    myTaskList = Array.isArray(body.data) ? body.data : [];
    renderMyTasks();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#b91c1c;padding:24px">${escapeHtml(err.message || "Lỗi tải nhiệm vụ")}</td></tr>`;
  }
}

function renderMyTasks() {
  const tbody = document.getElementById("myTaskTableBody");
  tbody.innerHTML = myTaskList.length
    ? myTaskList
        .map(
          (t) => `<tr>
              <td>
                <b>${escapeHtml(t.title)}</b>
                ${t.description ? `<div style="font-size:13px;color:#64748b;white-space:pre-wrap;max-width:420px">${escapeHtml(t.description)}</div>` : ""}
              </td>
              <td>${taskDueCell(t)}</td>
              <td>${taskBadge(TASK_PRIORITY_UI, t.priority)}</td>
              <td>${taskBadge(TASK_STATUS_UI, t.status)}</td>
              <td>${taskProgressCell(t)}</td>
              <td>${escapeHtml(t.mentor_name || "—")}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-sm btn-outline-primary" onclick="openProgressModal(${Number(t.id)})"><i class="fa-solid fa-chart-line"></i> Cập nhật</button>
              </td>
            </tr>`,
        )
        .join("")
    : `<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px">Bạn chưa được giao nhiệm vụ nào</td></tr>`;
}

function setProgressInputs(status, percent) {
  document.getElementById("progressStatus").value = status;
  document.getElementById("progressPercent").value = percent;
  document.getElementById("progressRange").value = percent;
}

function openProgressModal(id) {
  const t = myTaskList.find((x) => Number(x.id) === Number(id));
  if (!t) return;
  progressTaskId = Number(t.id);
  document.getElementById("progressModalTarget").textContent =
    `Nhiệm vụ: ${t.title}`;
  setProgressInputs(t.status, Number(t.progress_percent) || 0);
  document.getElementById("progressNote").value = t.progress_note || "";
  document.getElementById("progressModalError").textContent = "";
  progressPendingFiles = [];
  document.getElementById("progressFiles").value = "";
  renderProgressFiles();
  document.getElementById("progressSaveBtn").disabled = false;
  document.getElementById("progressCancelBtn").disabled = false;
  document.getElementById("progressModal").classList.add("open");
  document.getElementById("progressPercent").focus();
}

function currentProgressTask() {
  return myTaskList.find((x) => Number(x.id) === Number(progressTaskId));
}

// Hiển thị file đã đính kèm (có nút xóa) và file đang chờ tải lên.
function renderProgressFiles() {
  const task = currentProgressTask();
  document.getElementById("progressExistingFiles").innerHTML = task
    ? taskAttachmentList(task, { removable: true })
    : "";
  const pending = document.getElementById("progressPendingFiles");
  pending.innerHTML = progressPendingFiles
    .map(
      (f, i) =>
        `<li><i class="fa-solid fa-file-arrow-up"></i><span class="att-name">${escapeHtml(f.name)}</span><span class="att-size">${escapeHtml(formatFileSize(f.size))}</span><button type="button" class="att-remove" title="Bỏ file" onclick="removePendingProgressFile(${i})"><i class="fa-solid fa-xmark"></i></button></li>`,
    )
    .join("");
}

function removePendingProgressFile(index) {
  progressPendingFiles.splice(index, 1);
  renderProgressFiles();
}

// Kiểm tra nhanh phía client (server vẫn kiểm tra lại đuôi, dung lượng, nội dung).
function onProgressFilesChange() {
  const input = document.getElementById("progressFiles");
  const errEl = document.getElementById("progressModalError");
  const task = currentProgressTask();
  const existing = task?.attachments?.length || 0;
  const problems = [];
  for (const file of Array.from(input.files)) {
    const dot = file.name.lastIndexOf(".");
    const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
    if (!TASK_ATTACHMENT_EXTS.includes(ext)) {
      problems.push(`"${file.name}": định dạng không được hỗ trợ`);
    } else if (file.size === 0) {
      problems.push(`"${file.name}": file rỗng`);
    } else if (file.size > TASK_ATTACHMENT_MAX_BYTES) {
      problems.push(`"${file.name}": vượt quá 5MB`);
    } else if (
      existing + progressPendingFiles.length >=
      TASK_ATTACHMENT_LIMIT
    ) {
      problems.push(`Chỉ được đính kèm tối đa ${TASK_ATTACHMENT_LIMIT} file`);
      break;
    } else {
      progressPendingFiles.push(file);
    }
  }
  input.value = "";
  errEl.textContent = problems.join("; ");
  renderProgressFiles();
}

// Xóa file đã đính kèm trước đó (thực hiện ngay, không cần bấm Lưu).
async function removeTaskAttachment(taskId, attachmentId) {
  if (!confirm("Bạn có chắc chắn muốn xóa tệp đính kèm này không?")) return;
  const errEl = document.getElementById("progressModalError");
  try {
    const res = await fetch(
      `${API_BASE}/me/tasks/${Number(taskId)}/attachments/${Number(attachmentId)}`,
      { method: "DELETE", headers: authHeaders() },
    );
    if (res.status === 401)
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    const body = await res.json();
    if (!res.ok || !body.success) {
      errEl.textContent =
        body.message || body.error || "Không thể xóa tệp đính kèm.";
      return;
    }
    errEl.textContent = "";
    const idx = myTaskList.findIndex((x) => Number(x.id) === Number(taskId));
    if (idx >= 0 && body.data?.task) myTaskList[idx] = body.data.task;
    renderProgressFiles();
    renderMyTasks();
  } catch (err) {
    errEl.textContent = "Lỗi kết nối server!";
  }
}

// Tải lần lượt từng file; trả về danh sách lỗi (rỗng nếu thành công hết).
async function uploadProgressFiles(taskId, files) {
  const failures = [];
  for (const file of files) {
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(
        `${API_BASE}/me/tasks/${Number(taskId)}/attachments`,
        { method: "POST", headers: authHeaders(), body: formData },
      );
      if (res.status === 401) {
        forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
        return null;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        failures.push({
          file,
          message: body.message || body.error || "Tải lên thất bại",
        });
      }
    } catch (err) {
      failures.push({ file, message: "Lỗi kết nối server" });
    }
  }
  return failures;
}

function closeProgressModal() {
  if (document.getElementById("progressSaveBtn").disabled) return; // đang gửi
  document.getElementById("progressModal").classList.remove("open");
  progressTaskId = null;
}

// Đổi trạng thái thì % tự khớp (DONE=100, TODO=0), giống quy tắc server.
function onProgressStatusChange() {
  const status = document.getElementById("progressStatus").value;
  const current = Number(document.getElementById("progressPercent").value) || 0;
  const percent =
    status === "DONE" ? 100 : status === "TODO" ? 0 : Math.min(current, 99);
  setProgressInputs(status, percent);
}

// Đổi % thì trạng thái tự khớp (100=DONE, >0=Đang làm).
function onProgressPercentInput(value) {
  let percent = Math.round(Number(value));
  if (!Number.isFinite(percent)) percent = 0;
  percent = Math.min(100, Math.max(0, percent));
  const current = document.getElementById("progressStatus").value;
  const status =
    percent === 100
      ? "DONE"
      : percent > 0
        ? "IN_PROGRESS"
        : current === "IN_PROGRESS"
          ? "IN_PROGRESS"
          : "TODO";
  setProgressInputs(status, percent);
}

async function submitProgress() {
  if (!progressTaskId) return;
  const errEl = document.getElementById("progressModalError");
  const saveBtn = document.getElementById("progressSaveBtn");
  const cancelBtn = document.getElementById("progressCancelBtn");
  const raw = document.getElementById("progressPercent").value;
  const percent = Number(raw);
  if (
    raw === "" ||
    !Number.isInteger(percent) ||
    percent < 0 ||
    percent > 100
  ) {
    errEl.textContent = "Phần trăm tiến độ phải là số nguyên từ 0 đến 100!";
    return;
  }
  errEl.textContent = "";
  saveBtn.disabled = true;
  cancelBtn.disabled = true;
  let saved = false;
  try {
    const res = await fetch(`${API_BASE}/me/tasks/${progressTaskId}/progress`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        status: document.getElementById("progressStatus").value,
        progress_percent: percent,
        progress_note: document.getElementById("progressNote").value,
      }),
    });
    if (res.status === 401)
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    const body = await res.json();
    if (!res.ok || !body.success) {
      errEl.textContent =
        body.message || body.error || "Không thể cập nhật tiến độ.";
      return;
    }
    saved = true;

    // Tiến độ đã lưu; tiếp tục tải các file đính kèm (nếu có).
    if (progressPendingFiles.length) {
      const failures = await uploadProgressFiles(
        progressTaskId,
        progressPendingFiles,
      );
      if (failures === null) return; // hết phiên đăng nhập
      if (failures.length) {
        // Giữ modal mở để người dùng thử lại các file bị lỗi.
        progressPendingFiles = failures.map((f) => f.file);
        errEl.textContent =
          "Đã lưu tiến độ nhưng chưa tải được: " +
          failures.map((f) => `"${f.file.name}" (${f.message})`).join("; ");
        saved = false;
        await loadMyTasks();
        renderProgressFiles();
        return;
      }
    }
    showToast(body.message || "Đã cập nhật tiến độ!", "success");
  } catch (err) {
    errEl.textContent = "Lỗi kết nối server!";
  } finally {
    saveBtn.disabled = false;
    cancelBtn.disabled = false;
  }
  if (saved) {
    closeProgressModal();
    await loadMyTasks();
  }
}
