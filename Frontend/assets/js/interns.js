// Quản lý Tài liệu (chỉ HR): tài liệu của từng thực tập sinh, xem/tải file, duyệt hoặc từ chối hồ sơ.
// Thực tập sinh khớp hồ sơ ứng tuyển theo email (server trả sẵn s.application + s.documents).
function renderDocManagement() {
  const card = document.getElementById("docMgmtCard");
  const isHR = currentRole === "HR";
  card.style.display = isHR ? "" : "none";
  if (!isHR) return;

  const dash = `<span style="color:#94a3b8;">—</span>`;
  const tbody = document.getElementById("docMgmtBody");
  if (!studentsList.length) {
    tbody.innerHTML = `<tr><td colspan="4"
            style="text-align:center;color:#94a3b8;padding:24px;">Chưa có thực tập sinh nào</td></tr>`;
    return;
  }
  tbody.innerHTML = studentsList
    .map((s) => {
      const who = `<b>${escapeHtml(s.fullName)}</b>
              <span class="review-note">${escapeHtml(s.email)}</span>`;
      const a = s.application;
      if (!a) {
        return `<tr><td>${who}</td>
                <td><span class="doc-empty">Chưa nộp tài liệu</span></td>
                <td>${dash}</td><td align="center">${dash}</td></tr>`;
      }
      const view = {
        id: a.id,
        status: a.status,
        documents: s.documents || [],
      };
      const decision =
        a.status === "PENDING"
          ? renderReviewActions(view)
          : `<span class="review-note">Đã xử lý</span>`;
      return `<tr>
              <td>${who}</td>
              <td class="doc-mgmt-docs">${renderDocsPanel(view)}</td>
              <td>${renderStatusCell(a.status, a.rejection_reason)}</td>
              <td align="center">${decision}</td>
            </tr>`;
    })
    .join("");
}

function renderStudents() {
  const tbody = document.getElementById("studentTableBody");
  const filterWrap = document.getElementById("studentUnassignedFilterWrap");
  const canFilterStudents = ["HR", "Admin"].includes(currentRole);
  const toolbar = document.getElementById("studentFilterToolbar");
  if (toolbar) toolbar.style.display = canFilterStudents ? "" : "none";
  if (filterWrap) {
    filterWrap.style.display = currentRole === "HR" ? "" : "none";
  }
  renderDocManagement();
  renderContractManagement();

  const filtered = hasActiveStudentFilters();
  const countNode = document.getElementById("studentResultCount");
  if (countNode) {
    countNode.textContent = `Hiển thị ${studentsList.length}/${studentUnfilteredCount} thực tập sinh`;
  }
  if (!Array.isArray(studentsList) || studentsList.length === 0) {
    const message = filtered
      ? "Không tìm thấy thực tập sinh phù hợp"
      : "Chưa có hồ sơ thực tập sinh nào";
    tbody.innerHTML = `<tr>
            <td
              colspan="8"
              style="text-align:center;color:#94a3b8;padding:24px"
            >
              ${message}
            </td>
          </tr>`;
    return;
  }

  tbody.innerHTML = studentsList
    .map((s) => {
      let stColor = "badge-active";
      if (s.status === "Tạm dừng") stColor = "badge-pending";
      else if (s.status === "Hoàn thành") stColor = "badge-hr";

      const escapedName = escapeHtml(JSON.stringify(s.fullName));
      const contractButton =
        currentRole === "HR"
          ? `<button
                    class="btn btn-sm btn-info"
                    onclick="openContracts(${Number(s.id)}, ${escapedName})"
                    title="Hợp đồng"
                  ><i class="fa-solid fa-file-contract"></i></button>`
          : "";
      const scheduleButton = ["HR", "Mentor"].includes(currentRole)
        ? `<button
                  class="btn btn-sm btn-outline-primary"
                  onclick="openScheduleManager(${Number(s.id)}, ${escapedName})"
                  title="Quản lý lịch"
                ><i class="fa-solid fa-calendar-days"></i></button>`
        : "";
      const historyButton = ["HR", "Admin"].includes(currentRole)
        ? `<button
                  class="btn btn-sm btn-outline-primary"
                  onclick="internMentorHistoryOpen(${Number(s.id)}, ${escapedName})"
                  title="Lịch sử mentor"
                ><i class="fa-solid fa-clock-rotate-left"></i></button>`
        : "";
      const mentorCell =
        currentRole === "HR"
          ? renderStudentMentorSelect(s)
          : escapeHtml(s.mentorName || "Chưa phân công");
      const statusCell = escapeHtml(s.status || "Đang thực tập");

      return `
            <tr>
              <td style="font-family:monospace;font-size:13px;color:#64748b">
                ${escapeHtml(s.studentCode || "N/A")}
              </td>
              <td><b>${escapeHtml(s.fullName)}</b></td>
              <td>${escapeHtml(s.email)}</td>
              <td>${escapeHtml(s.university || "N/A")}</td>
              <td>${escapeHtml(s.major || "N/A")}</td>
              <td>${mentorCell}</td>
              <td>
                <span class="badge ${stColor}">${statusCell}</span>
              </td>
              <td align="center">
                <div class="action-group">
                  ${contractButton}
                  ${scheduleButton}
                  ${historyButton}
                  <button
                    class="btn btn-sm btn-primary"
                    onclick="editStudent(${Number(s.id)})"
                    title="Chỉnh sửa"
                  ><i class="fa-solid fa-pen"></i></button>
                  <button
                    class="btn btn-sm btn-danger"
                    onclick="deleteStudent(${Number(s.id)}, ${escapedName})"
                    title="Xóa"
                  ><i class="fa-solid fa-trash"></i></button>
                </div>
              </td>
            </tr>
          `;
    })
    .join("");
}

// Hiển thị danh sách thực tập sinh để HR mở quản lý hợp đồng.
function renderContractManagement() {
  const tbody = document.getElementById("contractManagementBody");
  if (!tbody) return;
  if (!Array.isArray(studentsList) || studentsList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:24px;">Chưa có hồ sơ thực tập sinh nào</td></tr>`;
    return;
  }
  tbody.innerHTML = studentsList
    .map((s) => {
      const contractCount = Number(s.contract_count) || 0;
      return `
          <tr>
            <td><b>${escapeHtml(s.fullName)}</b></td>
            <td>${escapeHtml(s.email)}</td>
            <td>${escapeHtml(s.studentCode || "N/A")}</td>
            <td align="center">
              <div class="action-group" style="justify-content:center;flex-wrap:nowrap;gap:6px">
                <button class="btn btn-sm btn-info" onclick="openContracts(${Number(s.id)}, ${escapeHtml(JSON.stringify(s.fullName))})">
                  <i class="fa-solid fa-file-contract"></i> Hợp đồng
                </button>
                ${
                  contractCount > 0
                    ? `<button class="btn btn-sm btn-outline-primary" onclick="openContracts(${Number(s.id)}, ${escapeHtml(JSON.stringify(s.fullName))}, true)" title="Xem hợp đồng">
                  <i class="fa-solid fa-eye"></i> Xem
                </button>`
                    : ""
                }
              </div>
            </td>
          </tr>`;
    })
    .join("");
}

function hasActiveStudentFilters() {
  return !!(
    document.getElementById("studentSearch")?.value.trim() ||
    document.getElementById("studentUniversityFilter")?.value ||
    document.getElementById("studentMajorFilter")?.value ||
    (currentRole === "HR" &&
      document.getElementById("studentUnassignedFilter")?.checked)
  );
}

function scheduleStudentSearch() {
  clearTimeout(studentSearchTimer);
  studentSearchTimer = setTimeout(loadStudents, 300);
}

async function clearStudentFilters() {
  const filterIds = [
    "studentSearch",
    "studentUniversityFilter",
    "studentMajorFilter",
    "studentUnassignedFilter",
  ];
  filterIds.forEach((id) => {
    const node = document.getElementById(id);
    if (!node) return;
    if (id === "studentUnassignedFilter") node.checked = false;
    else node.value = "";
  });
  studentFilterOptionsLoaded = false;
  await loadStudentFilterOptions(true);
  loadStudents();
}

async function loadStudentFilterOptions(force = false) {
  if (
    !["HR", "Admin"].includes(currentRole) ||
    (studentFilterOptionsLoaded && !force)
  ) {
    return;
  }

  const universitySelect = document.getElementById("studentUniversityFilter");
  const majorSelect = document.getElementById("studentMajorFilter");
  const selectedUniversity = universitySelect?.value || "";
  const selectedMajor = majorSelect?.value || "";
  const params = new URLSearchParams();
  if (selectedUniversity) params.set("university", selectedUniversity);
  const query = params.toString();
  const res = await fetch(
    `${API_BASE}/interns/filter-options${query ? `?${query}` : ""}`,
    { headers: authHeaders() },
  );
  if (!res.ok) return;

  const options = await res.json();
  if (universitySelect) {
    const universityOptions = (options.universities || [])
      .map(
        (value) =>
          `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
      )
      .join("");
    universitySelect.innerHTML = `<option value="">Tất cả</option>${universityOptions}`;
    universitySelect.value = selectedUniversity;
  }
  if (majorSelect) {
    const majorOptions = (options.majors || [])
      .map(
        (value) =>
          `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
      )
      .join("");
    majorSelect.innerHTML = `<option value="">Tất cả</option>${majorOptions}`;
    majorSelect.value = selectedMajor;
    if (majorSelect.value !== selectedMajor) majorSelect.value = "";
  }
  studentFilterOptionsLoaded = true;
}

async function handleStudentUniversityChange() {
  studentFilterOptionsLoaded = false;
  await loadStudentFilterOptions(true);
  loadStudents();
}

async function loadStudents() {
  const tbody = document.getElementById("studentTableBody");
  const requestId = ++studentSearchRequest;
  try {
    if (["HR", "Admin"].includes(currentRole)) {
      await loadStudentFilterOptions();
    }

    const params = new URLSearchParams();
    const q = document.getElementById("studentSearch")?.value.trim();
    const university = document.getElementById(
      "studentUniversityFilter",
    )?.value;
    const major = document.getElementById("studentMajorFilter")?.value;
    if (["HR", "Admin"].includes(currentRole) && q) {
      params.set("q", q);
    }
    if (["HR", "Admin"].includes(currentRole) && university) {
      params.set("university", university);
    }
    if (["HR", "Admin"].includes(currentRole) && major) {
      params.set("major", major);
    }
    const unassigned =
      currentRole === "HR" &&
      document.getElementById("studentUnassignedFilter")?.checked;
    if (unassigned) params.set("unassigned", "true");

    const query = params.toString();
    const listRequest = fetch(
      `${API_BASE}/students${query ? `?${query}` : ""}`,
      { headers: authHeaders() },
    );
    const countParams = new URLSearchParams();
    if (unassigned) countParams.set("unassigned", "true");
    const countQuery = countParams.toString();
    const countRequest = ["HR", "Admin"].includes(currentRole)
      ? fetch(
          `${API_BASE}/interns/count${countQuery ? `?${countQuery}` : ""}`,
          { headers: authHeaders() },
        )
      : Promise.resolve(null);
    const [res, countRes] = await Promise.all([listRequest, countRequest]);

    if (res.status === 401 || countRes?.status === 401) {
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    }
    if (countRes) {
      if (!countRes.ok) throw new Error("Không thể đếm hồ sơ thực tập sinh.");
      const countData = await countRes.json();
      studentUnfilteredCount = Number(countData.count) || 0;
    }

    const data = await res.json();
    if (requestId !== studentSearchRequest) return;
    studentsList = Array.isArray(data) ? data : [];
    renderStudents();
  } catch (err) {
    tbody.innerHTML = `<tr>
            <td colspan="8" style="text-align:center;color:#ef4444;padding:24px">
              Lỗi tải danh sách hồ sơ thực tập sinh!
            </td>
          </tr>`;
    const contractsBody = document.getElementById("contractManagementBody");
    if (contractsBody) {
      contractsBody.innerHTML = `<tr>
              <td colspan="4" style="text-align:center;color:#ef4444;padding:24px">
                Lỗi tải danh sách thực tập sinh. Vui lòng thử lại.
              </td>
            </tr>`;
    }
  }
}

function renderStudentMentorSelect(student) {
  const currentId = student.mentorId == null ? "" : String(student.mentorId);
  const options = mentorsList
    .map((mentor) => {
      const id = String(mentor.id);
      const department =
        mentor.department && mentor.department !== "Chưa cập nhật"
          ? ` — ${mentor.department}`
          : "";
      return `<option value="${escapeHtml(id)}" ${id === currentId ? "selected" : ""}>${escapeHtml(mentor.fullName)}${escapeHtml(department)} · ${Number(mentor.activeInterns || 0)} TTS</option>`;
    })
    .join("");
  const legacyName =
    !currentId && student.mentorName
      ? `<small style="display:block;color:#92400e;margin-top:3px">Tên cũ chưa xác minh: ${escapeHtml(student.mentorName)}</small>`
      : "";
  return `<select class="form-control" aria-label="Mentor của ${escapeHtml(student.fullName)}" data-current="${escapeHtml(currentId)}" onchange="assignStudentMentor(${Number(student.id)}, this)"><option value="">-- Chưa phân công --</option>${options}</select>${legacyName}`;
}

async function assignStudentMentor(studentId, select) {
  const message = document.getElementById("studentAssignmentMessage");
  const previous = select.dataset.current || "";
  select.disabled = true;
  message.textContent = "Đang cập nhật phân công...";
  message.style.color = "#64748b";
  try {
    const mentorId = select.value === "" ? null : Number(select.value);
    const send = async (confirmed) => {
      const r = await fetch(`${API_BASE}/interns/${studentId}/mentor`, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          mentor_id: mentorId,
          ...(confirmed ? { confirm_warnings: true } : {}),
        }),
      });
      return { res: r, data: await r.json() };
    };
    let { res, data } = await send(false);
    if (res.status === 409 && data.code === "NEEDS_CONFIRMATION") {
      if (!confirmAssignmentWarnings(data.warnings))
        throw new Error("Đã hủy phân công.");
      ({ res, data } = await send(true));
    }
    if (!res.ok)
      throw new Error(
        data.error || data.message || "Không thể cập nhật phân công.",
      );
    message.textContent = data.message || "Đã cập nhật phân công mentor.";
    message.style.color = "#047857";
    await loadMentorsForSelect(); // cập nhật số TTS của từng mentor trong ô chọn
    await loadStudents();
  } catch (err) {
    select.value = previous;
    message.textContent = err.message || "Lỗi cập nhật phân công mentor.";
    message.style.color = "#b91c1c";
  } finally {
    select.disabled = false;
  }
}

async function loadMyAssignedInterns() {
  const tbody = document.getElementById("myAssignedInternsBody");
  try {
    const res = await fetch(`${API_BASE}/mentors/me/interns`, {
      headers: authHeaders(),
    });
    if (res.status === 401)
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    const data = await res.json();
    if (!res.ok)
      throw new Error(data.error || "Không thể tải thực tập sinh của bạn.");
    const interns = Array.isArray(data) ? data : [];
    tbody.innerHTML = interns.length
      ? interns
          .map(
            (student) => `<tr>
            <td>${escapeHtml(student.studentCode || "N/A")}</td>
            <td><b>${escapeHtml(student.fullName)}</b></td>
            <td>${escapeHtml(student.email)}</td>
            <td>${escapeHtml(student.university || "N/A")}</td>
            <td>${escapeHtml(student.major || "N/A")}</td>
            <td>${escapeHtml(student.status || "Đang thực tập")}</td>
            <td><button class="btn btn-sm btn-outline-primary" onclick="openScheduleManager(${Number(student.id)}, ${escapeHtml(JSON.stringify(student.fullName))})"><i class="fa-solid fa-calendar-days"></i> Quản lý mốc</button></td>
          </tr>`,
          )
          .join("")
      : `<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px">Chưa có thực tập sinh được phân công</td></tr>`;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#b91c1c;padding:24px">${escapeHtml(err.message || "Lỗi tải danh sách")}</td></tr>`;
  }
}

async function handleSaveStudent(e) {
  e.preventDefault();
  const alertBox = document.getElementById("studentAlert");
  const btn = document.getElementById("btnSaveStudent");
  const editId = document.getElementById("studentEditId").value;

  const payload = {
    studentCode: document.getElementById("studentCode").value.trim(),
    fullName: document.getElementById("studentName").value.trim(),
    email: document.getElementById("studentEmail").value.trim(),
    phone: document.getElementById("studentPhone").value.trim(),
    university: document.getElementById("studentUniversity").value.trim(),
    major: document.getElementById("studentMajor").value.trim(),
    mentorName: document.getElementById("studentMentor").value,
    status: document.getElementById("studentStatus").value,
  };

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang xử lý...`;

  try {
    const url = editId
      ? `${API_BASE}/students/${editId}`
      : `${API_BASE}/students`;
    const method = editId ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (res.ok) {
      showAlert(alertBox, data.message, "success");
      cancelStudentEdit();
      studentFilterOptionsLoaded = false;
      await loadStudentFilterOptions(true);
      await loadStudents();
    } else {
      showAlert(alertBox, data.error || "Thao tác thất bại!", "error");
    }
  } catch (err) {
    showAlert(alertBox, " Không thể kết nối tới Backend!", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = editId
      ? `<i class="fa-solid fa-floppy-disk"></i> Cập Nhật Hồ Sơ`
      : `<i class="fa-solid fa-plus"></i> Lưu Hồ Sơ`;
  }
}

function editStudent(id) {
  const s = studentsList.find((x) => Number(x.id) === Number(id));
  if (!s) return;
  document.getElementById("studentEditId").value = s.id;
  document.getElementById("studentCode").value = s.studentCode || "";
  document.getElementById("studentName").value = s.fullName || "";
  document.getElementById("studentEmail").value = s.email || "";
  document.getElementById("studentPhone").value = s.phone || "";
  document.getElementById("studentUniversity").value = s.university || "";
  document.getElementById("studentMajor").value = s.major || "";
  document.getElementById("studentMentor").value = s.mentorName || "";
  document.getElementById("studentStatus").value = s.status || "Đang thực tập";
  document.getElementById("studentFormTitle").innerText =
    "Chỉnh Sửa Hồ Sơ Thực Tập Sinh";
  document.getElementById("btnSaveStudent").innerHTML =
    `<i class="fa-solid fa-floppy-disk"></i> Cập Nhật Hồ Sơ`;
  document.getElementById("btnCancelStudentEdit").style.display =
    "inline-block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function cancelStudentEdit() {
  document.getElementById("studentForm").reset();
  document.getElementById("studentEditId").value = "";
  document.getElementById("studentFormTitle").innerText =
    "Thêm Mới Hồ Sơ Thực Tập Sinh";
  document.getElementById("btnSaveStudent").innerHTML =
    `<i class="fa-solid fa-plus"></i> Lưu Hồ Sơ`;
  document.getElementById("btnCancelStudentEdit").style.display = "none";
}

async function deleteStudent(id, name) {
  if (!confirm(`Bạn có chắc muốn xóa hồ sơ thực tập sinh "${name}" không?`))
    return;
  try {
    const res = await fetch(`${API_BASE}/students/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (res.ok) {
      studentFilterOptionsLoaded = false;
      await loadStudentFilterOptions(true);
      await loadStudents();
      showToast("Đã xóa hồ sơ thực tập sinh.", "success");
    } else {
      showToast(await readErrorMessage(res, "Lỗi khi xóa hồ sơ!"), "error");
    }
  } catch (err) {
    showToast("Không thể kết nối Backend!", "error");
  }
}

function showAlert(el, msg, type) {
  el.className = `alert-box alert-${type}`;
  el.innerText = msg;
  el.style.display = "flex";
  setTimeout(() => {
    el.style.display = "none";
  }, 5000);
}
