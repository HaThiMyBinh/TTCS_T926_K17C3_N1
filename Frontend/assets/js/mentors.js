async function loadMentors() {
  const tbody = document.getElementById("mentorTableBody");
  try {
    const res = await fetch(`${API_BASE}/mentors`, {
      headers: authHeaders(),
    });
    mentorsList = await res.json();

    if (!Array.isArray(mentorsList) || mentorsList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 24px;">Chưa có mentor nào trong hệ thống</td></tr>`;
      return;
    }

    tbody.innerHTML = mentorsList
      .map(
        (m) => `
          <tr>
            <td><b>${escapeHtml(m.fullName)}</b></td>
            <td>${escapeHtml(m.email)}</td>
            <td>${escapeHtml(m.phone || "N/A")}</td>
            <td><span class="badge badge-mentor">${escapeHtml(m.department || "N/A")}</span></td>
            <td>${escapeHtml(m.specialization || "N/A")}</td>
            <td align="center">
              <div class="action-group">
                <button class="btn btn-sm btn-soft" onclick="mentorInternsOpen(${Number(m.id)}, ${escapeHtml(JSON.stringify(m.fullName))})" title="Thực tập sinh của mentor"><i class="fa-solid fa-user-group"></i> TTS (${Number(m.activeInterns || 0)})</button>
                <button class="btn btn-sm btn-primary" onclick="editMentor(${Number(m.id)})" title="Chỉnh sửa">
                  <i class="fa-solid fa-pen"></i>
                </button>
                <button class="btn btn-sm btn-danger" onclick="deleteMentor(${Number(m.id)}, ${escapeHtml(JSON.stringify(m.fullName))})" title="Xóa">
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </td>
          </tr>
        `,
      )
      .join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 24px;">Lỗi tải danh sách mentor!</td></tr>`;
  }
}

// Nạp danh sách mentor cho ô chọn "Mentor phụ trách" ở form hồ sơ thực tập sinh
async function loadMentorsForSelect() {
  try {
    const res = await fetch(`${API_BASE}/mentors`, {
      headers: authHeaders(),
    });
    const list = await res.json();
    mentorsList = Array.isArray(list) ? list : [];
    const select = document.getElementById("studentMentor");
    const current = select.value;
    select.innerHTML =
      `<option value="">-- Chưa phân công --</option>` +
      mentorsList
        // Giá trị lưu là họ tên nên chỉ giữ 1 mục cho mỗi tên (tránh lặp)
        .filter(
          (m, i, arr) =>
            arr.findIndex(
              (x) =>
                x.fullName.trim().toLowerCase() ===
                m.fullName.trim().toLowerCase(),
            ) === i,
        )
        .map((m) => {
          const dept =
            m.department && m.department !== "Chưa cập nhật"
              ? ` — ${m.department}`
              : "";
          return `<option value="${escapeHtml(m.fullName)}">${escapeHtml(m.fullName)}${escapeHtml(dept)}</option>`;
        })
        .join("");
    if (current) select.value = current;
    if (currentTab === "tab-students") renderStudents();
  } catch (err) {
    console.error("Lỗi tải danh sách mentor cho form:", err);
  }
}

async function handleSaveMentor(e) {
  e.preventDefault();
  const alertBox = document.getElementById("mentorAlert");
  const btn = document.getElementById("btnSaveMentor");
  const editId = document.getElementById("mentorEditId").value;

  const payload = {
    fullName: document.getElementById("mentorName").value.trim(),
    email: document.getElementById("mentorEmail").value.trim(),
    phone: document.getElementById("mentorPhone").value.trim(),
    department: document.getElementById("mentorDepartment").value.trim(),
    specialization: document
      .getElementById("mentorSpecialization")
      .value.trim(),
  };

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang xử lý...`;

  try {
    const url = editId
      ? `${API_BASE}/mentors/${editId}`
      : `${API_BASE}/mentors`;
    const method = editId ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (res.ok) {
      showAlert(alertBox, data.message, "success");
      cancelMentorEdit();
      await loadMentors();
    } else {
      showAlert(alertBox, data.error || "Thao tác thất bại!", "error");
    }
  } catch (err) {
    showAlert(alertBox, " Không thể kết nối tới Backend!", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = editId
      ? `<i class="fa-solid fa-floppy-disk"></i> Cập Nhật Mentor`
      : `<i class="fa-solid fa-plus"></i> Thêm Mentor`;
  }
}

function editMentor(id) {
  const m = mentorsList.find((x) => Number(x.id) === Number(id));
  if (!m) return;
  document.getElementById("mentorEditId").value = m.id;
  document.getElementById("mentorName").value = m.fullName || "";
  document.getElementById("mentorEmail").value = m.email || "";
  document.getElementById("mentorPhone").value = m.phone || "";
  document.getElementById("mentorDepartment").value = m.department || "";
  document.getElementById("mentorSpecialization").value =
    m.specialization || "";
  document.getElementById("mentorFormTitle").innerText = "Chỉnh Sửa Mentor";
  document.getElementById("btnSaveMentor").innerHTML =
    `<i class="fa-solid fa-floppy-disk"></i> Cập Nhật Mentor`;
  document.getElementById("btnCancelMentorEdit").style.display = "inline-block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function cancelMentorEdit() {
  document.getElementById("mentorForm").reset();
  document.getElementById("mentorEditId").value = "";
  document.getElementById("mentorFormTitle").innerText = "Thêm Mới Mentor";
  document.getElementById("btnSaveMentor").innerHTML =
    `<i class="fa-solid fa-plus"></i> Thêm Mentor`;
  document.getElementById("btnCancelMentorEdit").style.display = "none";
}

async function deleteMentor(id, name) {
  if (!confirm(`Bạn có chắc muốn xóa mentor "${name}" không?`)) return;
  try {
    const res = await fetch(`${API_BASE}/mentors/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (res.ok) {
      await loadMentors();
      showToast("Đã xóa mentor.", "success");
    } else {
      showToast(await readErrorMessage(res, "Lỗi khi xóa mentor!"), "error");
    }
  } catch (err) {
    showToast("Không thể kết nối Backend!", "error");
  }
}
async function mentorInternsOpen(mentorId, name) {
  miMentorId = mentorId;
  document.getElementById("miTitle").innerText = `Thực tập sinh của ${name}`;
  setText("miError", "");
  document.getElementById("miSearch").value = "";
  document.getElementById("miAddBox").open = false;
  document.getElementById("mentorInternsModal").style.display = "flex";
  await mentorInternsReload();
}
function mentorInternsClose() {
  document.getElementById("mentorInternsModal").style.display = "none";
  loadMentors();
}
async function mentorInternsReload() {
  const [mine, avail] = await Promise.all([
    wrRequest(`/mentors/${miMentorId}/interns`),
    wrRequest(`/mentors/${miMentorId}/available-interns`),
  ]);
  if (!mine || !avail) return;
  if (!mine.res.ok)
    return setText(
      "miError",
      wrApiError(mine, "Không tải được danh sách thực tập sinh."),
    );
  miAvailable = avail.res.ok ? avail.body.data : [];
  const rows = mine.body.data;
  document.getElementById("miRows").innerHTML = rows.length
    ? rows
        .map(
          (i) =>
            `<tr><td><b>${escapeHtml(i.fullName)}</b><span class="fr-sub">${escapeHtml(i.studentCode || "")}</span></td><td>${escapeHtml(i.university || "")}</td><td>${escapeHtml(i.status || "")}</td><td><button class="btn btn-sm btn-soft-danger" onclick="mentorInternsRemove(${Number(i.id)}, ${escapeHtml(JSON.stringify(i.fullName))})">Gỡ</button></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="4">Mentor này chưa phụ trách thực tập sinh nào.</td></tr>';
  mentorInternsRenderAvailable();
}
function mentorInternsRenderAvailable() {
  const q = document
    .getElementById("miSearch")
    .value.trim()
    .toLocaleLowerCase("vi");
  const rows = miAvailable.filter(
    (i) =>
      !q ||
      [i.fullName, i.studentCode, i.university].some((v) =>
        String(v || "")
          .toLocaleLowerCase("vi")
          .includes(q),
      ),
  );
  document.getElementById("miAvailable").innerHTML = rows.length
    ? rows
        .map(
          (i) =>
            `<tr><td style="width:36px"><input type="checkbox" class="mi-check" value="${Number(i.id)}" aria-label="Chọn ${escapeHtml(i.fullName)}" /></td><td>${escapeHtml(i.fullName)}<span class="fr-sub">${escapeHtml(i.studentCode || "")}</span></td><td>${escapeHtml(i.university || "")}</td><td>${escapeHtml(i.status || "")}</td><td>${i.mentorName ? `Đang thuộc ${escapeHtml(i.mentorName)}` : "<em>Chưa có mentor</em>"}</td></tr>`,
        )
        .join("")
    : "<tr><td>Không có thực tập sinh nào để gán.</td></tr>";
}
async function mentorInternsAdd() {
  const ids = [
    ...document.querySelectorAll("#miAvailable .mi-check:checked"),
  ].map((c) => Number(c.value));
  if (!ids.length)
    return setText("miError", "Vui lòng chọn thực tập sinh cần gán.");
  setText("miError", "");
  const send = (confirmed) =>
    wrRequest(`/mentors/${miMentorId}/interns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intern_ids: ids,
        ...(confirmed ? { confirm_warnings: true } : {}),
      }),
    });
  let result = await send(false);
  if (
    result &&
    result.res.status === 409 &&
    result.body.code === "NEEDS_CONFIRMATION"
  ) {
    if (!confirmAssignmentWarnings(result.body.warnings)) return;
    result = await send(true);
  }
  if (!result) return;
  if (!result.res.ok)
    return setText(
      "miError",
      wrApiError(result, "Không gán được thực tập sinh."),
    );
  const r = result.body.data;
  showToast(
    `Đã gán ${r.updated} thực tập sinh cho mentor${r.unchanged ? ` (${r.unchanged} người không đổi)` : ""}.`,
  );
  await mentorInternsReload();
}
async function mentorInternsRemove(internId, name) {
  if (
    !confirm(
      `Gỡ ${name} khỏi mentor này? Thực tập sinh sẽ trở về trạng thái chưa có mentor.`,
    )
  )
    return;
  setText("miError", "");
  const result = await wrRequest(`/interns/${internId}/mentor`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mentor_id: null }),
  });
  if (!result) return;
  if (!result.res.ok)
    return setText(
      "miError",
      wrApiError(result, "Không gỡ được thực tập sinh."),
    );
  await mentorInternsReload();
}

// Cảnh báo mềm khi phân công mentor (server trả 409 NEEDS_CONFIRMATION): hỏi HR rồi gửi lại với confirm_warnings.
function confirmAssignmentWarnings(warnings) {
  return confirm(
    "Cần lưu ý trước khi phân công:\n\n• " +
      (warnings || []).map((w) => w.message).join("\n• ") +
      "\n\nVẫn tiếp tục phân công?",
  );
}
