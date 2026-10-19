function supportStatusLabel(status) {
  return SUPPORT_STATUS_LABELS[status] || status;
}
function supportTypeLabel(type) {
  return SUPPORT_TYPE_LABELS[type] || type;
}
function supportDate(value) {
  return value
    ? escapeHtml(
        new Date(value).toLocaleString("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
        }),
      )
    : "—";
}
function supportBadge(status) {
  const cls =
    {
      PENDING: "pending",
      IN_PROGRESS: "progress",
      RESOLVED: "resolved",
      REJECTED: "rejected",
      CANCELLED: "cancelled",
    }[status] || "pending";
  return `<span class="sp-badge sp-badge--${cls}">${escapeHtml(supportStatusLabel(status))}</span>`;
}
// Nhãn ghi chú của HR theo trạng thái để thực tập sinh phân biệt được lý do từ chối và kết quả.
function supportNoteLabel(status) {
  return status === "REJECTED"
    ? "Lý do từ chối"
    : status === "RESOLVED"
      ? "Kết quả / ghi chú của HR"
      : "Phản hồi của HR";
}
// Thời điểm xử lý gần nhất: đã kết thúc → resolvedAt; đang xử lý / đã hủy → lần cập nhật cuối; chờ tiếp nhận → chưa có.
function supportHandledAt(x) {
  return (
    x.resolvedAt ||
    (x.status === "IN_PROGRESS" || x.status === "CANCELLED"
      ? x.updatedAt
      : null)
  );
}
async function supportReadJson(res) {
  try {
    return await res.json();
  } catch (e) {
    return {};
  }
}
function supportFileNameFrom(res, fallback) {
  const header = res.headers.get("Content-Disposition") || "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch (e) {
      /* dùng tên dự phòng */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1] : fallback;
}
async function downloadSupport(id, attachmentId, errorBoxId, fallbackName) {
  const box = document.getElementById(errorBoxId || "supportMineError");
  if (box) box.textContent = "";
  try {
    const res = await fetch(
      `${API_BASE}/support-requests/${id}/attachments/${attachmentId}/download`,
      { headers: authHeaders() },
    );
    if (!res.ok)
      throw new Error(
        (await supportReadJson(res)).message || "Không tải được file",
      );
    const blob = await res.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = supportFileNameFrom(res, fallbackName || "tai-lieu");
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (e) {
    if (box) box.textContent = e.message;
  }
}
async function uploadSupportFile(id, file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/me/support-requests/${id}/attachments`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  const data = await supportReadJson(res);
  if (!res.ok) throw new Error(data.message || "Không tải được file");
  return data;
}
function supportMineMessage(text, isError) {
  const box = document.getElementById("supportMineError");
  if (!box) return;
  box.textContent = text || "";
  box.style.color = isError === false ? "#15803d" : "";
}

// ===== Thực tập sinh =====
async function submitSupport(event) {
  event.preventDefault();
  const button = event.submitter;
  if (button.disabled) return;
  const form = event.target,
    files = Array.from(document.getElementById("supportFiles").files);
  supportMineMessage("");
  if (files.length > SUPPORT_MAX_REQUEST_FILES) {
    supportMineMessage(
      `Chỉ được đính kèm tối đa ${SUPPORT_MAX_REQUEST_FILES} file mỗi yêu cầu.`,
    );
    return;
  }
  button.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/me/support-requests`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        request_type: document.getElementById("supportType").value,
        title: document.getElementById("supportTitle").value,
        description: document.getElementById("supportDescription").value,
      }),
    });
    const data = await supportReadJson(res);
    if (!res.ok) throw new Error(data.message || "Không gửi được yêu cầu");
    const failed = [];
    for (const file of files) {
      try {
        await uploadSupportFile(data.data.id, file);
      } catch (e) {
        failed.push(`${file.name}: ${e.message}`);
      }
    }
    form.reset();
    await loadSupportMine();
    if (failed.length)
      supportMineMessage(
        `Yêu cầu đã được gửi nhưng một số file chưa tải lên được (${failed.join("; ")}). Bạn có thể thêm lại file trong yêu cầu bên dưới khi yêu cầu còn chờ tiếp nhận.`,
      );
    else supportMineMessage("Đã gửi yêu cầu hỗ trợ.", false);
  } catch (e) {
    supportMineMessage(e.message);
  } finally {
    button.disabled = false;
  }
}
function supportFileButtons(request, files, canDelete) {
  return `<div class="sp-files">${files.map((a) => `<span class="sp-file"><button type="button" title="${escapeHtml(a.originalName)}" data-name="${escapeHtml(a.originalName)}" onclick="downloadSupport(${Number(request.id)},${Number(a.id)},'supportMineError',this.dataset.name)">${escapeHtml(a.originalName)}</button>${canDelete ? `<button type="button" class="sp-file-del" title="Xóa file" aria-label="Xóa ${escapeHtml(a.originalName)}" onclick="removeSupportFile(${Number(request.id)},${Number(a.id)})">×</button>` : ""}</span>`).join("")}</div>`;
}
function renderSupportMineItem(x) {
  const requestFiles = (x.attachments || []).filter(
      (a) => a.kind === "REQUEST",
    ),
    resultFiles = (x.attachments || []).filter((a) => a.kind === "RESULT");
  const pending = x.status === "PENDING",
    handledAt = supportHandledAt(x);
  const noteClass =
    x.status === "REJECTED"
      ? " sp-note--rejected"
      : x.status === "RESOLVED"
        ? " sp-note--resolved"
        : "";
  return `<article class="sp-item">
          <div class="sp-item-head">
            <div><div class="sp-title">${escapeHtml(x.title)}</div><div class="sp-meta">${escapeHtml(supportTypeLabel(x.requestType))} · Gửi ${supportDate(x.createdAt)}${handledAt ? ` · Cập nhật ${supportDate(handledAt)}` : ""}</div></div>
            ${supportBadge(x.status)}
          </div>
          ${x.description ? `<div class="sp-desc">${escapeHtml(x.description)}</div>` : ""}
          ${requestFiles.length ? `<div class="sp-sec"><div class="sp-sec-label">File đã gửi</div>${supportFileButtons(x, requestFiles, pending)}</div>` : ""}
          ${x.resolutionNote ? `<div class="sp-note${noteClass}"><b>${escapeHtml(supportNoteLabel(x.status))}</b>${escapeHtml(x.resolutionNote)}</div>` : ""}
          ${resultFiles.length ? `<div class="sp-sec"><div class="sp-sec-label">File kết quả từ HR</div>${supportFileButtons(x, resultFiles, false)}</div>` : ""}
          ${pending ? `<div class="sp-foot"><button type="button" class="btn btn-sm btn-secondary" onclick="cancelSupport(${Number(x.id)})">Hủy yêu cầu</button>${requestFiles.length < SUPPORT_MAX_REQUEST_FILES ? `<label class="btn btn-sm btn-secondary">Thêm file<input type="file" hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.txt" onchange="addSupportFile(${Number(x.id)},this)"></label>` : ""}</div>` : ""}
        </article>`;
}
async function loadSupportMine() {
  const host = document.getElementById("supportMineList");
  if (!host) return;
  try {
    const res = await fetch(
      `${API_BASE}/me/support-requests?status=${encodeURIComponent(document.getElementById("supportMineStatus")?.value || "")}&type=${encodeURIComponent(document.getElementById("supportMineType")?.value || "")}`,
      { headers: authHeaders() },
    );
    const data = await supportReadJson(res);
    if (!res.ok)
      throw new Error(data.message || "Không tải được danh sách yêu cầu");
    const s = data.data.summary || {};
    const summary = document.getElementById("supportMineSummary");
    if (summary)
      summary.innerHTML = [
        ["Tổng", s.total],
        ["Chờ tiếp nhận", s.pending],
        ["Đang xử lý", s.inProgress],
        ["Đã giải quyết", s.resolved],
        ["Từ chối", s.rejected],
        ["Đã hủy", s.cancelled],
      ]
        .map(
          ([label, n]) =>
            `<span class="sp-chip">${label} <b>${Number(n || 0)}</b></span>`,
        )
        .join("");
    const items = data.data.items || [];
    host.innerHTML =
      items.map(renderSupportMineItem).join("") ||
      `<div class="sp-empty">${Number(s.total || 0) ? "Không có yêu cầu phù hợp với bộ lọc." : "Bạn chưa gửi yêu cầu hỗ trợ nào."}</div>`;
  } catch (e) {
    supportMineMessage(e.message);
  }
}
async function cancelSupport(id) {
  if (!confirm("Hủy yêu cầu này?")) return;
  supportMineMessage("");
  try {
    const res = await fetch(`${API_BASE}/me/support-requests/${id}/cancel`, {
      method: "POST",
      headers: authHeaders(),
    });
    const data = await supportReadJson(res);
    if (!res.ok) throw new Error(data.message || "Không hủy được yêu cầu");
  } catch (e) {
    supportMineMessage(e.message);
  }
  await loadSupportMine();
}
async function addSupportFile(id, input) {
  const file = input.files[0];
  input.value = "";
  if (!file) return;
  supportMineMessage("");
  try {
    await uploadSupportFile(id, file);
  } catch (e) {
    supportMineMessage(e.message);
  }
  await loadSupportMine();
}
async function removeSupportFile(id, attachmentId) {
  if (!confirm("Xóa file đính kèm này?")) return;
  supportMineMessage("");
  try {
    const res = await fetch(
      `${API_BASE}/me/support-requests/${id}/attachments/${attachmentId}`,
      { method: "DELETE", headers: authHeaders() },
    );
    const data = await supportReadJson(res);
    if (!res.ok) throw new Error(data.message || "Không xóa được file");
  } catch (e) {
    supportMineMessage(e.message);
  }
  await loadSupportMine();
}

// ===== HR =====
function resetSupportPage() {
  supportPage = 1;
  loadSupportHr();
}
function scheduleSupportSearch() {
  clearTimeout(supportSearchTimer);
  supportSearchTimer = setTimeout(resetSupportPage, 300);
}
function clearSupportFilters() {
  document.getElementById("supportHrSearch").value = "";
  document.getElementById("supportHrStatus").value = "";
  document.getElementById("supportHrType").value = "";
  resetSupportPage();
}
function filterSupportStatus(status) {
  const select = document.getElementById("supportHrStatus");
  select.value = select.value === status ? "" : status;
  resetSupportPage();
}
function renderSupportSummary(summary) {
  const current = document.getElementById("supportHrStatus").value;
  document.getElementById("supportHrSummary").innerHTML = [
    ["PENDING", "pending"],
    ["IN_PROGRESS", "inProgress"],
    ["RESOLVED", "resolved"],
    ["REJECTED", "rejected"],
    ["CANCELLED", "cancelled"],
  ]
    .map(
      ([status, key]) =>
        `<button type="button" class="sp-chip${current === status ? " is-active" : ""}" onclick="filterSupportStatus('${status}')">${supportStatusLabel(status)} <b>${Number(summary[key] || 0)}</b></button>`,
    )
    .join("");
}
async function loadSupportHr() {
  const host = document.getElementById("supportHrList");
  if (!host) return;
  host.innerHTML =
    '<tr><td colspan="7" style="text-align:center;padding:24px">Đang tải...</td></tr>';
  document.getElementById("supportHrError").textContent = "";
  try {
    const q = encodeURIComponent(
        document.getElementById("supportHrSearch").value || "",
      ),
      st = encodeURIComponent(
        document.getElementById("supportHrStatus").value || "",
      ),
      ty = encodeURIComponent(
        document.getElementById("supportHrType").value || "",
      );
    const res = await fetch(
      `${API_BASE}/support-requests?q=${q}&status=${st}&type=${ty}&page=${supportPage}&pageSize=20`,
      { headers: authHeaders() },
    );
    const body = await supportReadJson(res);
    if (!res.ok) throw new Error(body.message || "Không tải được danh sách");
    const data = body.data;
    renderSupportSummary(data.summary);
    host.innerHTML =
      (data.items || [])
        .map(
          (x) =>
            `<tr><td><b>${escapeHtml(x.fullName)}</b><br><small>${escapeHtml(x.studentCode || "—")} · ${escapeHtml(x.university || "—")}</small></td><td>${escapeHtml(supportTypeLabel(x.requestType))}</td><td>${escapeHtml(x.title)}</td><td>${supportBadge(x.status)}</td><td>${supportDate(x.createdAt)}</td><td>${supportDate(supportHandledAt(x))}</td><td><button class="btn btn-sm btn-secondary" onclick="openSupportDetail(${Number(x.id)})">Xem</button></td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="7" style="text-align:center;padding:24px;color:#94a3b8">Không có yêu cầu phù hợp.</td></tr>';
    const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
    if (data.page > pages) {
      supportPage = pages;
      return loadSupportHr();
    }
    document.getElementById("supportHrPager").innerHTML =
      `<button class="btn btn-sm btn-secondary" ${data.page <= 1 ? "disabled" : ""} onclick="supportPage--;loadSupportHr()">Trước</button><span>Trang ${data.page}/${pages} · ${data.total} yêu cầu</span><button class="btn btn-sm btn-secondary" ${data.page >= pages ? "disabled" : ""} onclick="supportPage++;loadSupportHr()">Sau</button>`;
  } catch (e) {
    host.innerHTML = "";
    document.getElementById("supportHrError").textContent = e.message;
  }
}
function closeSupportModal() {
  document.getElementById("supportHrModal").style.display = "none";
  supportCurrent = null;
  supportNoteDraft = "";
}
async function openSupportDetail(id, keepDraft) {
  const modal = document.getElementById("supportHrModal"),
    body = document.getElementById("supportHrModalBody");
  if (!keepDraft) supportNoteDraft = "";
  modal.style.display = "flex";
  body.textContent = "Đang tải...";
  if (!keepDraft) {
    document.getElementById("supportHrModalTitle").textContent =
      "Chi tiết yêu cầu hỗ trợ";
    document.getElementById("supportHrModalBadge").innerHTML = "";
  }
  document.getElementById("supportHrModalError").textContent = "";
  try {
    const res = await fetch(`${API_BASE}/support-requests/${id}`, {
      headers: authHeaders(),
    });
    const data = await supportReadJson(res);
    if (!res.ok) throw new Error(data.message || "Không tải được chi tiết");
    supportCurrent = data.data;
    renderSupportModal();
  } catch (e) {
    body.textContent = "";
    document.getElementById("supportHrModalError").textContent = e.message;
  }
}
function renderSupportModal() {
  const x = supportCurrent;
  if (!x) return;
  const requestFiles = (x.attachments || []).filter(
      (a) => a.kind === "REQUEST",
    ),
    resultFiles = (x.attachments || []).filter((a) => a.kind === "RESULT");
  const files = (list, canDelete) =>
    list.length
      ? `<div class="sp-files">${list.map((a) => `<span class="sp-file"><button type="button" title="${escapeHtml(a.originalName)}" data-name="${escapeHtml(a.originalName)}" onclick="downloadSupport(${Number(x.id)},${Number(a.id)},'supportHrModalError',this.dataset.name)">${escapeHtml(a.originalName)}</button>${canDelete ? `<button type="button" class="sp-file-del" title="Xóa file" aria-label="Xóa ${escapeHtml(a.originalName)}" onclick="deleteSupportResult(${Number(x.id)},${Number(a.id)})">×</button>` : ""}</span>`).join("")}</div>`
      : `<span style="color:#94a3b8;font-size:14.5px">Không có</span>`;
  const handledAt = supportHandledAt(x);
  const noteClass =
    x.status === "REJECTED"
      ? " sp-note--rejected"
      : x.status === "RESOLVED"
        ? " sp-note--resolved"
        : "";
  const canUpload = resultFiles.length < SUPPORT_MAX_RESULT_FILES;
  const kv = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  document.getElementById("supportHrModalTitle").textContent =
    x.title || "Yêu cầu hỗ trợ";
  document.getElementById("supportHrModalBadge").innerHTML = supportBadge(
    x.status,
  );
  let reply = "";
  if (x.status === "PENDING") {
    reply = `<div class="sp-reply">
            <div class="sp-sec-label" style="margin:0">Phản hồi</div>
            <textarea id="supportResponseNote" class="form-control" maxlength="1000" placeholder="Lý do từ chối (bắt buộc khi từ chối)" oninput="supportNoteDraft=this.value">${escapeHtml(supportNoteDraft)}</textarea>
            <div class="sp-actions"><button class="btn btn-danger sp-reject" onclick="processSupport(${Number(x.id)},'REJECT')">Từ chối</button><button class="btn btn-primary" onclick="processSupport(${Number(x.id)},'START')">Bắt đầu xử lý</button></div>
          </div>`;
  } else if (x.status === "IN_PROGRESS") {
    reply = `<div class="sp-reply">
            <div class="sp-sec-label" style="margin:0">Phản hồi</div>
            <textarea id="supportResponseNote" class="form-control" maxlength="1000" placeholder="Ghi chú kết quả cho thực tập sinh (bắt buộc nếu chưa có file kết quả; bắt buộc khi từ chối)" oninput="supportNoteDraft=this.value">${escapeHtml(supportNoteDraft)}</textarea>
            ${canUpload ? `<div class="sp-upload"><input id="supportResultFile" type="file" class="form-control" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.txt"><button class="btn btn-secondary" onclick="uploadSupportResult(${Number(x.id)})">Tải file lên</button></div>` : `<div class="sp-hint">Đã đủ ${SUPPORT_MAX_RESULT_FILES} file kết quả.</div>`}
            <div class="sp-actions"><button class="btn btn-danger sp-reject" onclick="processSupport(${Number(x.id)},'REJECT')">Từ chối</button><button class="btn btn-success" onclick="processSupport(${Number(x.id)},'RESOLVE')">Giải quyết</button></div>
          </div>`;
  }
  document.getElementById("supportHrModalBody").innerHTML = `
          <dl class="sp-kv">
            ${kv("Thực tập sinh", escapeHtml(x.fullName))}
            ${kv("MSSV", escapeHtml(x.studentCode || "—"))}
            ${kv("Trường", escapeHtml(x.university || "—"))}
            ${kv("Loại yêu cầu", escapeHtml(supportTypeLabel(x.requestType)))}
            ${kv("Gửi lúc", supportDate(x.createdAt))}
            ${kv(x.status === "PENDING" ? "Người xử lý" : "Người xử lý · cập nhật", `${escapeHtml(x.handledByName || "—")}${handledAt ? ` · ${supportDate(handledAt)}` : ""}`)}
          </dl>
          <div class="sp-sec" style="margin:0"><div class="sp-sec-label">Nội dung yêu cầu</div><div class="sp-box">${x.description ? escapeHtml(x.description) : '<span style="color:#94a3b8">Không có mô tả</span>'}</div></div>
          <div class="sp-sec" style="margin:0"><div class="sp-sec-label">File thực tập sinh gửi</div>${files(requestFiles, false)}</div>
          ${x.status === "PENDING" ? "" : `<div class="sp-sec" style="margin:0"><div class="sp-sec-label">File kết quả (${resultFiles.length}/${SUPPORT_MAX_RESULT_FILES})</div>${files(resultFiles, x.status === "IN_PROGRESS")}</div>`}
          ${x.resolutionNote ? `<div class="sp-note${noteClass}" style="margin:0"><b>${escapeHtml(supportNoteLabel(x.status))}</b>${escapeHtml(x.resolutionNote)}</div>` : ""}
          ${reply}`;
}
async function uploadSupportResult(id) {
  const input = document.getElementById("supportResultFile"),
    file = input && input.files[0];
  if (!file || supportActionBusy) return;
  supportActionBusy = true;
  try {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(
      `${API_BASE}/support-requests/${id}/result-attachments`,
      { method: "POST", headers: authHeaders(), body },
    );
    const data = await supportReadJson(res);
    if (!res.ok) throw new Error(data.message || "Không tải được file");
    await openSupportDetail(id, true);
  } catch (e) {
    document.getElementById("supportHrModalError").textContent = e.message;
  } finally {
    supportActionBusy = false;
  }
}
async function deleteSupportResult(id, attachmentId) {
  if (!confirm("Xóa file kết quả này?") || supportActionBusy) return;
  supportActionBusy = true;
  try {
    const res = await fetch(
      `${API_BASE}/support-requests/${id}/result-attachments/${attachmentId}`,
      { method: "DELETE", headers: authHeaders() },
    );
    const data = await supportReadJson(res);
    if (!res.ok) throw new Error(data.message || "Không xóa được file");
    await openSupportDetail(id, true);
  } catch (e) {
    document.getElementById("supportHrModalError").textContent = e.message;
  } finally {
    supportActionBusy = false;
  }
}
async function processSupport(id, decision) {
  if (supportActionBusy) return;
  const errorBox = document.getElementById("supportHrModalError");
  errorBox.textContent = "";
  const note =
    decision === "START"
      ? ""
      : String(
          document.getElementById("supportResponseNote")?.value || "",
        ).trim();
  if (decision === "REJECT" && !note) {
    errorBox.textContent = "Vui lòng nhập lý do từ chối.";
    return;
  }
  if (
    decision === "RESOLVE" &&
    !note &&
    !(supportCurrent?.attachments || []).some((a) => a.kind === "RESULT")
  ) {
    errorBox.textContent = "Giải quyết yêu cầu cần ghi chú hoặc file kết quả.";
    return;
  }
  if (
    (decision === "REJECT" || decision === "RESOLVE") &&
    !confirm(
      decision === "REJECT"
        ? "Xác nhận từ chối yêu cầu?"
        : "Xác nhận giải quyết yêu cầu?",
    )
  )
    return;
  supportActionBusy = true;
  try {
    const res = await fetch(`${API_BASE}/support-requests/${id}/process`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ decision, note }),
    });
    const data = await supportReadJson(res);
    if (!res.ok)
      throw new Error(
        res.status === 409
          ? "Yêu cầu đã được xử lý ở nơi khác."
          : data.message || "Không xử lý được yêu cầu",
      );
    supportNoteDraft = "";
    await loadSupportHr();
    await openSupportDetail(id);
  } catch (e) {
    errorBox.textContent = e.message;
    if (String(e.message).includes("nơi khác")) {
      await loadSupportHr();
      await openSupportDetail(id);
      errorBox.textContent = e.message;
    }
  } finally {
    supportActionBusy = false;
  }
}
