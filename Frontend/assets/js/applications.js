// chỉ HR được xem/tải tài liệu ứng viên. Mọi dữ liệu đều qua escapeHtml;
// nút tải dùng data-attribute (không nhúng tên file vào onclick) và event delegation bên dưới.
// Tiến độ tài liệu bắt buộc (CV + Đơn xin thực tập): x/2. Server vẫn là nơi quyết định cuối cùng.
function getDocProgress(c) {
  const types = new Set((c.documents || []).map((d) => d.doc_type));
  const uploaded = ["CV", "APPLICATION_LETTER"].filter((t) =>
    types.has(t),
  ).length;
  return { uploaded, required: 2, complete: uploaded === 2 };
}

function renderDocsPanel(c) {
  if (currentRole !== "HR") return "";
  const docs = c.documents || [];
  const p = getDocProgress(c);
  const chipCls = p.complete ? "doc-progress-ok" : "doc-progress-warn";
  const progress = `<span class="doc-progress ${chipCls}">Tài liệu: ${p.uploaded}/${p.required}</span>`;
  if (docs.length === 0) {
    return `${progress}<span class="doc-empty">Chưa nộp tài liệu</span>`;
  }

  const labels = { CV: "CV", APPLICATION_LETTER: "Đơn xin thực tập" };
  const iconOf = (name) =>
    /\.pdf$/i.test(name)
      ? "fa-file-pdf"
      : /\.docx?$/i.test(name)
        ? "fa-file-word"
        : "fa-file";
  const iconButton = (cls, icon, label, d) => `
            <button type="button" class="${cls}" title="${label}"
              aria-label="${label} ${escapeHtml(d.original_name)}"
              data-app-id="${Number(c.id)}" data-doc-id="${Number(d.id)}"
              data-name="${escapeHtml(d.original_name)}">
              <i class="fa-solid ${icon}"></i>
            </button>`;

  const items = docs.map((d) => {
    const name = escapeHtml(d.original_name);
    const size = escapeHtml(formatFileSize(d.size_bytes));
    const when = escapeHtml(formatDateTime(d.uploaded_at));
    return `
          <div class="doc-hr-item">
            <i class="fa-solid ${iconOf(d.original_name)}"></i>
            <div class="doc-hr-meta" title="${name} • ${size} • ${when}">
              <span class="doc-hr-type">${escapeHtml(labels[d.doc_type] || d.doc_type)} · ${size}</span>
              <span class="doc-hr-name">${name}</span>
            </div>
            ${iconButton("doc-view-btn", "fa-eye", "Xem", d)}
            ${iconButton("doc-download-btn", "fa-download", "Tải xuống", d)}
          </div>`;
  });
  return `${progress}<div class="doc-hr-list">${items.join("")}</div>`;
}

// Nút "Xem": PDF mở tab mới (server trả Content-Disposition: inline); DOC/DOCX tải về
async function viewDocumentFile(appId, docId, filename) {
  if (!/\.pdf$/i.test(filename || "")) {
    return downloadDocumentFile(appId, docId, filename);
  }
  const tab = window.open("", "_blank"); // mở ngay trong sự kiện click để không bị chặn popup
  try {
    const res = await fetch(
      `${API_BASE}/applications/${appId}/documents/${docId}/download?disposition=inline`,
      { headers: authHeaders() },
    );
    if (res.status === 401) {
      if (tab) tab.close();
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (tab) tab.close();
      showToast(err.message || "Không mở được tài liệu!", "error");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(
      new Blob([blob], { type: "application/pdf" }),
    );
    if (!tab) {
      URL.revokeObjectURL(url);
      showToast(
        "Trình duyệt chặn cửa sổ mới, hãy cho phép popup hoặc dùng nút Tải!",
        "error",
      );
      return;
    }
    tab.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    if (tab) tab.close();
    showToast("Lỗi khi mở tài liệu!", "error");
  }
}

// Badge trạng thái hồ sơ + lý do từ chối (nếu có), dùng chung cho tab ứng tuyển và Quản lý Tài liệu
function renderStatusCell(status, rejectionReason) {
  const ui = STATUS_UI[status] || STATUS_UI.PENDING;
  const reason =
    status === "REJECTED" && rejectionReason
      ? `<span class="reject-reason">Lý do: ${escapeHtml(rejectionReason)}</span>`
      : "";
  return `<span class="badge ${ui.cls}">${ui.label}</span>${reason}`;
}

// Nút Duyệt / Từ chối. Nếu app.documents được truyền vào (tab Quản lý Tài liệu) thì Duyệt bị vô hiệu
// kèm tooltip khi thiếu tài liệu; nếu không (tab Hồ sơ ứng tuyển) thì duyệt không cần tài liệu.
function renderReviewActions(app) {
  if (currentRole !== "HR" || app.status !== "PENDING") {
    return `<span style="color:#94a3b8;">—</span>`;
  }
  const id = Number(app.id);
  const disabledAll = busyApplicationIds.has(app.id) ? "disabled" : "";
  const hasDocs = Array.isArray(app.documents);
  const prog = getDocProgress(app);
  const blocked = hasDocs && !prog.complete;
  const blockTip = `Hồ sơ chưa đủ tài liệu (${prog.uploaded}/${prog.required}), không thể duyệt!`;
  return `<div class="action-group">
            <span class="approve-wrap ${blocked ? "is-blocked" : ""}"
              ${blocked ? `title="${escapeHtml(blockTip)}"` : ""}>
              <button class="btn btn-sm btn-success" ${disabledAll || blocked ? "disabled" : ""}
                onclick="approveApplication(${id})">Duyệt</button>
            </span>
            <button class="btn btn-sm btn-reject" ${disabledAll}
              onclick="openRejectModal(${id})">Từ chối</button>
          </div>`;
}

// Cập nhật mọi nơi đang hiển thị hồ sơ ứng tuyển (2 tab dùng chung dữ liệu duyệt)
function renderApplicationViews() {
  renderCandidates();
  if (studentsList.length) renderStudents();
}

function renderCandidates() {
  const tbody = document.getElementById("candidateTableBody");
  if (applicationsList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:24px;">Chưa có hồ sơ ứng tuyển nào</td></tr>`;
    return;
  }
  tbody.innerHTML = applicationsList
    .map((c) => {
      const cv = /^https?:\/\//i.test(c.cvLink || "")
        ? ` <a href="${escapeHtml(c.cvLink)}" target="_blank" rel="noopener noreferrer" title="Xem CV"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>`
        : "";

      const actions = renderReviewActions({ id: c.id, status: c.status });
      return `
            <tr>
              <td>
                <b>${escapeHtml(c.name)}</b>${cv}
              </td>
              <td>${escapeHtml(c.email)}</td>
              <td>${escapeHtml(c.university || "N/A")}</td>
              <td>${escapeHtml(c.major || "N/A")}</td>
              <td>${renderStatusCell(c.status, c.rejection_reason)}</td>
              <td align="center">${actions}</td>
            </tr>`;
    })
    .join("");
}

async function loadCandidates() {
  const tbody = document.getElementById("candidateTableBody");
  if (currentRole === "Intern") {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#ef4444;padding:24px;"><b><i class="fa-solid fa-lock"></i> Thực tập sinh không có quyền xem danh sách hồ sơ ứng tuyển!</b></td></tr>`;
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/applications`, {
      headers: authHeaders(),
    });
    if (res.status === 401) {
      forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
      return;
    }
    if (res.status === 403) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#ef4444;padding:24px;"><b><i class="fa-solid fa-lock"></i> Bạn không có quyền truy cập hồ sơ ứng tuyển!</b></td></tr>`;
      return;
    }
    const body = await res.json();
    if (!res.ok || !body.success) throw new Error(body.message);
    applicationsList = body.data;
    renderCandidates();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#ef4444;padding:24px;">Lỗi tải danh sách hồ sơ!</td></tr>`;
    showToast("Không tải được danh sách hồ sơ!", "error");
  }
}

// Gọi PATCH và thay đúng dòng trong state bằng dữ liệu server trả về (không reload trang).
// Trả về true nếu thành công.
async function submitApplicationStatus(id, payload) {
  if (busyApplicationIds.has(id)) return false;
  busyApplicationIds.add(id);
  renderApplicationViews();
  try {
    const res = await fetch(`${API_BASE}/applications/${id}/status`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
      return false;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      showToast(body.message || "Thao tác thất bại!", "error");
      // 409: hồ sơ đã bị người khác xử lý -> đồng bộ lại danh sách
      if (res.status === 409 || res.status === 404) {
        loadCandidates();
        loadStudents();
      } else if (res.status === 400) refreshApplicationDocs(id); // có thể tài liệu vừa thay đổi
      return false;
    }
    // PATCH không trả documents -> giữ lại danh sách file của dòng đó
    applicationsList = applicationsList.map((c) =>
      c.id === body.data.id ? { ...body.data, documents: c.documents } : c,
    );
    // Đồng bộ dòng tương ứng ở mục Quản lý Tài liệu (đổi trạng thái -> ẩn nút Duyệt/Từ chối)
    studentsList = studentsList.map((s) =>
      s.application && s.application.id === body.data.id
        ? {
            ...s,
            application: {
              ...s.application,
              status: body.data.status,
              rejection_reason: body.data.rejection_reason,
            },
          }
        : s,
    );
    showToast(body.message, "success");
    return true;
  } catch (err) {
    showToast("Không thể kết nối tới Backend!", "error");
    return false;
  } finally {
    busyApplicationIds.delete(id);
    renderApplicationViews();
  }
}

// Làm mới tài liệu của 1 dòng bằng GET /applications/:id/documents (HR)
async function refreshApplicationDocs(id) {
  try {
    const res = await fetch(`${API_BASE}/applications/${id}/documents`, {
      headers: authHeaders(),
    });
    if (res.status === 401)
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) return;
    applicationsList = applicationsList.map((c) =>
      c.id === id ? { ...c, documents: body.documents } : c,
    );
    studentsList = studentsList.map((s) =>
      s.application && s.application.id === id
        ? { ...s, documents: body.documents }
        : s,
    );
    renderApplicationViews();
  } catch (err) {
    // Không chặn luồng: danh sách sẽ tải lại ở lần làm mới kế tiếp.
  }
}

// Duyệt luôn yêu cầu đủ CV + Đơn xin thực tập; server từ chối (400) nếu thiếu.
function approveApplication(id) {
  return submitApplicationStatus(id, { status: "APPROVED" });
}

// Tên + email người nộp hồ sơ, tìm ở tab ứng tuyển hoặc mục Quản lý Tài liệu
function findApplicationView(id) {
  const c = applicationsList.find((x) => x.id === id);
  if (c) return { name: c.name, email: c.email };
  const s = studentsList.find((x) => x.application && x.application.id === id);
  return s ? { name: s.fullName, email: s.email } : null;
}

// ---- Modal từ chối ----
function openRejectModal(id) {
  const c = findApplicationView(id);
  if (!c) return;
  reviewingId = id;
  document.getElementById("rejectModalTarget").textContent =
    `Ứng viên: ${c.name} (${c.email})`;
  document.getElementById("rejectReasonInput").value = "";
  document.getElementById("rejectReasonError").textContent = "";
  document.getElementById("rejectConfirmBtn").disabled = false;
  document.getElementById("rejectCancelBtn").disabled = false;
  document.getElementById("rejectModal").classList.add("open");
  document.getElementById("rejectReasonInput").focus();
}

function closeRejectModal() {
  if (document.getElementById("rejectConfirmBtn").disabled) return; // đang gửi
  document.getElementById("rejectModal").classList.remove("open");
  reviewingId = null;
}

async function confirmReject() {
  const input = document.getElementById("rejectReasonInput");
  const errEl = document.getElementById("rejectReasonError");
  const reason = input.value.trim();
  if (!reason) {
    errEl.textContent = "Vui lòng nhập lý do từ chối!"; // không gọi API
    input.focus();
    return;
  }
  errEl.textContent = "";
  const confirmBtn = document.getElementById("rejectConfirmBtn");
  const cancelBtn = document.getElementById("rejectCancelBtn");
  confirmBtn.disabled = true;
  cancelBtn.disabled = true;
  const ok = await submitApplicationStatus(reviewingId, {
    status: "REJECTED",
    rejection_reason: reason,
  });
  confirmBtn.disabled = false;
  cancelBtn.disabled = false;
  if (ok) closeRejectModal();
}
