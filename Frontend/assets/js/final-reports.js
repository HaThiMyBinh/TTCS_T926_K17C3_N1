function finalReportStatusBadge(r) {
  if (r.status === "DRAFT")
    return `<span class="badge badge-pending">Nháp</span>`;
  if (r.isSent || Number(r.sendCount) > 0)
    return `<span class="badge badge-active">Đã gửi</span>`;
  return `<span class="badge fr-badge-final">Đã chốt</span>`;
}
function finalReportPeriod(r) {
  const from = r.periodFrom ? formatDateOnly(r.periodFrom) : "",
    to = r.periodTo ? formatDateOnly(r.periodTo) : "";
  return from || to ? `${from || "..."} – ${to || "..."}` : "Toàn bộ thời gian";
}
function finalReportRow(r) {
  const id = Number(r.id),
    sendCount = Number(r.sendCount || 0),
    isDraft = r.status === "DRAFT";
  const sentCell = sendCount
    ? `${sendCount} lần<span class="fr-sub">Gần nhất: ${escapeHtml(formatDateTime(r.lastSentAt))}</span><span class="fr-sub">${escapeHtml((r.lastRecipients || []).join(", "))}</span>`
    : isDraft
      ? "—"
      : `<span class="fr-sub">Chưa gửi</span>`;
  const actions =
    `<button class="btn btn-sm btn-primary" onclick="openFinalReport(${id})">Mở</button><button class="btn btn-sm btn-secondary" onclick="downloadFinalReportCsv(${id})">CSV</button>` +
    (isDraft
      ? `<button class="btn btn-sm btn-secondary" onclick="editFinalReport(${id})">Sửa</button><button class="btn btn-sm btn-primary" onclick="finalizeFinalReport(${id})">Chốt</button><button class="btn btn-sm btn-danger" onclick="deleteFinalReport(${id})">Xóa</button>`
      : `<button class="btn btn-sm btn-primary" onclick="openFinalReport(${id}, { focusSend: true })">Gửi</button>`);
  return `<tr><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.scopeLabel || "")}<span class="fr-sub">${escapeHtml(finalReportPeriod(r))}</span></td><td>${finalReportStatusBadge(r)}</td><td>${sentCell}</td><td>${escapeHtml(r.createdByName || "")}</td><td>${escapeHtml(formatDateTime(r.createdAt))}</td><td><div class="fr-row-actions">${actions}</div></td></tr>`;
}
function syncFinalReportDates() {
  const from = document.getElementById("frFrom"),
    to = document.getElementById("frTo");
  to.min = from.value || "";
  from.max = to.value || "";
}
function validateFinalReportForm({ requireTitle = true } = {}) {
  const err = document.getElementById("frFormError");
  err.innerText = "";
  const fail = (message, fieldId) => {
    err.innerText = message;
    document.getElementById(fieldId).focus();
    return false;
  };
  const p = finalReportPayload();
  if (requireTitle && !p.title.trim())
    return fail("Vui lòng nhập tiêu đề báo cáo!", "frTitle");
  if (p.scope_type !== "ALL" && !p.scope_value)
    return fail("Vui lòng chọn trường hoặc chương trình!", "frScopeValue");
  if (p.period_from && p.period_to && p.period_from > p.period_to)
    return fail("Ngày bắt đầu không được sau ngày kết thúc!", "frFrom");
  return true;
}
async function loadFinalReports() {
  const box = document.getElementById("finalReportList");
  box.innerText = "Đang tải danh sách báo cáo...";
  document.getElementById("finalReportError").innerText = "";
  const result = await wrRequest("/final-reports");
  if (!result) return;
  if (!result.res.ok) {
    box.innerText = wrApiError(result, "Không tải được báo cáo.");
    return;
  }
  finalReportOptions = result.body.data.options;
  const reports = result.body.data.reports;
  box.innerHTML = `<div class="table-container"><table><thead><tr><th>Tiêu đề</th><th>Phạm vi</th><th>Trạng thái</th><th>Đã gửi</th><th>Người tạo</th><th>Thời điểm</th><th>Thao tác</th></tr></thead><tbody>${reports.length ? reports.map(finalReportRow).join("") : `<tr><td colspan="7">Chưa có báo cáo nào.</td></tr>`}</tbody></table></div>`;
}
function showFinalReportForm() {
  editingFinalReportId = null;
  document.getElementById("frTitle").value = "";
  document.getElementById("frNote").value = "";
  document.getElementById("frFrom").value = "";
  document.getElementById("frTo").value = "";
  document.getElementById("frScope").value = "ALL";
  document.getElementById("frSaveButton").innerText = "Lưu bản nháp";
  document.getElementById("frFormError").innerText = "";
  document.getElementById("frPreview").innerHTML = "";
  document.getElementById("finalReportForm").style.display = "block";
  document.getElementById("finalReportDetail").style.display = "none";
  updateFinalReportScope();
  syncFinalReportDates();
}
async function editFinalReport(id) {
  const result = await wrRequest(`/final-reports/${id}`);
  if (!result) return;
  if (!result.res.ok) {
    document.getElementById("finalReportError").innerText = wrApiError(
      result,
      "Không tải được bản nháp.",
    );
    return;
  }
  const r = result.body.data;
  editingFinalReportId = id;
  document.getElementById("frTitle").value = r.title;
  document.getElementById("frScope").value = r.scopeType;
  updateFinalReportScope();
  if (r.scopeValue)
    document.getElementById("frScopeValue").value = r.scopeValue;
  document.getElementById("frFrom").value = r.periodFrom || "";
  document.getElementById("frTo").value = r.periodTo || "";
  document.getElementById("frNote").value = r.hrNote || "";
  document.getElementById("frSaveButton").innerText = "Cập nhật bản nháp";
  document.getElementById("frFormError").innerText = "";
  document.getElementById("frPreview").innerHTML = "";
  syncFinalReportDates();
  document.getElementById("finalReportForm").style.display = "block";
  document.getElementById("finalReportDetail").style.display = "none";
}
function updateFinalReportScope() {
  const scope = document.getElementById("frScope").value;
  document.getElementById("frScopeValueWrap").style.display =
    scope === "ALL" ? "none" : "";
  document.getElementById("frScopeValueLabel").innerText =
    scope === "UNIVERSITY" ? "Trường" : "Chương trình";
  const options =
    scope === "UNIVERSITY"
      ? (finalReportOptions.universities || []).map((v) => ({
          value: v,
          label: v,
        }))
      : (finalReportOptions.programs || []).map((p) => ({
          value: String(p.id),
          label: p.name,
        }));
  document.getElementById("frScopeValue").innerHTML = options.length
    ? options
        .map(
          (o) =>
            `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`,
        )
        .join("")
    : `<option value="">— Chưa có dữ liệu —</option>`;
}
function finalReportPayload() {
  const scope = document.getElementById("frScope").value;
  return {
    title: document.getElementById("frTitle").value,
    scope_type: scope,
    scope_value:
      scope === "ALL"
        ? null
        : document.getElementById("frScopeValue").value || null,
    period_from: document.getElementById("frFrom").value || null,
    period_to: document.getElementById("frTo").value || null,
    hr_note: document.getElementById("frNote").value || null,
  };
}
function renderFinalReportData(d) {
  const s = d.summary;
  const cell = (v) => (v === null || v === undefined ? "—" : escapeHtml(v));
  const chip = (label, value) =>
    `<div class="summary-chip"><small>${label}</small><strong>${value}</strong></div>`;

  const distEntries = Object.entries(s.distribution || {});
  const maxDist = Math.max(0, ...distEntries.map(([, v]) => Number(v) || 0));
  const distribution = distEntries
    .map(([range, count]) => {
      const pct = maxDist ? Math.round(((Number(count) || 0) / maxDist) * 100) : 0;
      return `<div class="fr-dist-row"><span class="fr-dist-label">${escapeHtml(range)}</span><span class="fr-dist-track"><span class="fr-dist-bar" style="width:${pct}%"></span></span><strong class="fr-dist-count">${Number(count) || 0}</strong></div>`;
    })
    .join("");

  // Gom 3 ô nhận xét của mỗi thực tập sinh thành một nút xem duy nhất.
  const commentsOf = (i) => {
    const body = [
      ["Kỹ năng", i.skillComment],
      ["Thái độ", i.attitudeComment],
      ["Tổng kết", i.overallComment],
    ]
      .filter(([, text]) => text)
      .map(([label, text]) => `<p><b>${label}:</b> ${escapeHtml(text)}</p>`)
      .join("");
    return body
      ? `<details class="fr-comments"><summary>Xem nhận xét</summary>${body}</details>`
      : "";
  };

  const rows = d.interns
    .map(
      (i) =>
        `<tr><td><b>${escapeHtml(i.fullName)}</b>${i.studentCode ? `<span class="fr-sub">${escapeHtml(i.studentCode)}</span>` : ""}${commentsOf(i)}</td><td>${escapeHtml(i.university || "")}<span class="fr-sub">${escapeHtml(i.major || "")}</span></td><td>${escapeHtml(i.mentorName || "—")}</td><td>${i.evaluated ? cell(i.skillScore) : '<span class="badge badge-pending">Chưa đánh giá</span>'}</td><td>${i.evaluated ? cell(i.attitudeScore) : "—"}</td><td>${cell(i.overallScore)}</td><td>${i.weeklyReportStats.onTime} / ${i.weeklyReportStats.late} / ${i.weeklyReportStats.missing}</td><td>${i.taskStats.done}/${i.taskStats.total}</td><td>${formatAttendanceMinutes(i.totalWorkMinutes || 0)}</td></tr>`,
    )
    .join("");

  return `<h3 class="fr-section-title">Tổng quan</h3>
<div class="summary-chips fr-overview">${chip("Thực tập sinh", Number(s.totalInterns))}${chip("Đã đánh giá", Number(s.evaluated))}${chip("Chưa đánh giá", Number(s.notEvaluated))}${chip("Điểm TB kỹ năng", cell(s.avgSkill))}${chip("Điểm TB thái độ", cell(s.avgAttitude))}${chip("Điểm TB tổng", cell(s.avgOverall))}${chip("Tổng giờ làm trong kỳ", escapeHtml(formatAttendanceMinutes(s.totalWorkMinutes || 0)))}</div>
<h4 class="fr-section-title">Phân bố điểm tổng</h4>
<div class="fr-chart fr-dist">${distribution}</div>
<h4 class="fr-section-title">Chi tiết thực tập sinh</h4>
<div class="table-container"><table class="fr-print-table"><thead><tr><th>Thực tập sinh</th><th>Trường / ngành</th><th>Mentor</th><th>Kỹ năng</th><th>Thái độ</th><th>Điểm tổng</th><th>Tuần đúng / trễ / thiếu</th><th>Nhiệm vụ trong kỳ</th><th>Giờ làm</th></tr></thead><tbody>${rows}</tbody></table></div>${d.hrNote ? `<div class="fr-hr-note"><h4>Ghi chú HR</h4><p>${escapeHtml(d.hrNote)}</p></div>` : ""}`;
}
async function previewFinalReport() {
  if (!validateFinalReportForm({ requireTitle: false })) return;
  const button = document.getElementById("frPreviewButton");
  button.disabled = true;
  const params = new URLSearchParams({
    scope_type: document.getElementById("frScope").value,
  });
  const scope = document.getElementById("frScope").value;
  if (scope !== "ALL")
    params.set("scope_value", document.getElementById("frScopeValue").value);
  if (document.getElementById("frFrom").value)
    params.set("from", document.getElementById("frFrom").value);
  if (document.getElementById("frTo").value)
    params.set("to", document.getElementById("frTo").value);
  const result = await wrRequest(`/final-reports/preview?${params}`);
  button.disabled = false;
  const box = document.getElementById("frPreview");
  if (!result) return;
  if (!result.res.ok) {
    box.innerText = wrApiError(result, "Không xem trước được báo cáo.");
    return;
  }
  box.innerHTML = renderFinalReportData(result.body.data);
}
async function saveFinalReport() {
  if (!validateFinalReportForm()) return;
  const button = document.getElementById("frSaveButton");
  button.disabled = true;
  try {
    const updating = !!editingFinalReportId;
    const result = await wrRequest(
      updating ? `/final-reports/${editingFinalReportId}` : "/final-reports",
      {
        method: updating ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalReportPayload()),
      },
    );
    if (!result) return;
    if (!result.res.ok) {
      document.getElementById("frFormError").innerText = wrApiError(
        result,
        "Không lưu được báo cáo.",
      );
      return;
    }
    const id = updating ? editingFinalReportId : result.body.data.id;
    editingFinalReportId = null;
    document.getElementById("finalReportForm").style.display = "none";
    await loadFinalReports();
    await openFinalReport(id);
  } finally {
    button.disabled = false;
  }
}
async function openFinalReport(id, opts = {}) {
  const result = await wrRequest(`/final-reports/${id}`);
  if (!result) return;
  if (!result.res.ok) {
    document.getElementById("finalReportError").innerText = wrApiError(
      result,
      "Không tải được báo cáo.",
    );
    return;
  }
  const r = result.body.data;
  const rid = Number(r.id);
  const sends = r.sends || [];
  let suggestions = [];
  if (r.status === "FINALIZED") {
    const q = new URLSearchParams({ scope_type: r.scopeType });
    if (r.scopeType !== "ALL" && r.scopeValue)
      q.set("scope_value", r.scopeValue);
    const rr = await wrRequest(`/final-reports/recipients?${q}`);
    if (rr && rr.res.ok) suggestions = rr.body.data.recipients || [];
  }
  const chips = suggestions.length
    ? `<div><div style="font-size: 13px; font-weight: 600; color: var(--slate-600); margin-bottom: 6px;">Gợi ý người nhận:</div><div class="fr-chips">${suggestions.map((x) => `<span class="fr-chip-wrap"><button type="button" class="fr-chip" data-email="${escapeHtml(x.email)}" onclick="addFinalReportRecipient(this.dataset.email)">${escapeHtml(x.email)}</button><button type="button" class="fr-chip-x" title="Xóa khỏi danh sách gợi ý" aria-label="Xóa ${escapeHtml(x.email)} khỏi gợi ý" onclick="removeFinalReportRecipient(${Number(x.id)}, this)">×</button></span>`).join("")}</div></div>`
    : "";
  const sendPanel = `<div class="fr-send-panel"><label class="fr-field"><span>Gửi cho</span><input id="frSendTo" placeholder="ban.lanh.dao@truong.edu.vn, phong.dao.tao@truong.edu.vn"></label>${chips}<label class="fr-field">Lời nhắn<textarea id="frSendMessage" maxlength="1000"></textarea></label><div class="fr-actions"><button id="frSendButton" class="btn btn-primary" onclick="sendFinalReportEmail(${rid}, ${sends.length})">Gửi báo cáo qua email (kèm CSV)</button><span id="frSendResult" role="status"></span></div></div>`;
  const history =
    r.status === "FINALIZED"
      ? `<div class="fr-history"><strong>Lịch sử gửi (${sends.length})</strong>${sends.length ? `<ul>${sends.map((x) => `<li>${escapeHtml(formatDateTime(x.sentAt))} · ${escapeHtml(x.sentByName || "—")} → ${escapeHtml((x.recipients || []).join(", "))}${x.message ? `<span class="fr-sub">Lời nhắn: ${escapeHtml(x.message)}</span>` : ""}</li>`).join("")}</ul>` : `<p class="fr-hint">Báo cáo này chưa được gửi cho ai.</p>`}</div>`
      : "";
  const draftButtons = `<button class="btn btn-secondary" onclick="editFinalReport(${rid})">Sửa nháp</button><button class="btn btn-primary" onclick="finalizeFinalReport(${rid})">Chốt báo cáo</button><button class="btn btn-danger" onclick="deleteFinalReport(${rid})">Xóa nháp</button>`;
  document.getElementById("finalReportForm").style.display = "none";
  document.getElementById("finalReportDetail").style.display = "block";
  document.getElementById("finalReportDetailBody").innerHTML =
    `<div class="fr-screen-controls"><h2>${escapeHtml(r.title)}</h2>${finalReportStatusBadge(r)}<button class="btn btn-secondary" onclick="downloadFinalReportCsv(${rid})">Tải CSV</button><button type="button" class="btn btn-primary" data-report-export="final" data-export-format="xlsx" data-report-id="${rid}">Xuất Excel</button><button type="button" class="btn btn-secondary" data-report-export="final" data-export-format="pdf" data-report-id="${rid}">Xuất PDF</button>${r.status === "DRAFT" ? draftButtons : sendPanel + history}</div><div id="frPrintable"><h1>${escapeHtml(r.title)}</h1><p>Ngày lập: ${escapeHtml(formatDateTime(r.data.generatedAt || r.createdAt))} · Phạm vi: ${escapeHtml(r.scopeLabel || "")} · Thời gian: ${escapeHtml(finalReportPeriod(r))}</p>${renderFinalReportData(r.data)}<p class="fr-signature">Đại diện Nhân sự</p></div>`;
  if (opts.flash) {
    const out = document.getElementById("frSendResult");
    if (out) {
      out.className = "text-success";
      out.innerText = opts.flash;
    }
  }
  const sendInput = document.getElementById("frSendTo");
  if (opts.focusSend && sendInput) {
    sendInput.scrollIntoView({ behavior: "smooth", block: "center" });
    sendInput.focus();
  } else
    document
      .getElementById("finalReportDetail")
      .scrollIntoView({ behavior: "smooth", block: "start" });
}
async function finalizeFinalReport(id, confirmIncomplete = false) {
  if (
    !confirmIncomplete &&
    !confirm(
      "Sau khi chốt, báo cáo không thể sửa hoặc xóa. Bạn có muốn tiếp tục?",
    )
  )
    return;
  const button = document.activeElement;
  button.disabled = true;
  try {
    const result = await wrRequest(`/final-reports/${id}/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        confirmIncomplete ? { confirm_incomplete: true } : {},
      ),
    });
    if (!result) return;
    if (!result.res.ok) {
      if (
        result.res.status === 409 &&
        result.body.code === "INCOMPLETE_EVALUATION"
      ) {
        if (confirm(result.body.message + "\n\nVẫn chốt báo cáo này?")) {
          button.disabled = false;
          return finalizeFinalReport(id, true);
        }
        return;
      }
      document.getElementById("finalReportError").innerText = wrApiError(
        result,
        "Không chốt được báo cáo.",
      );
      return;
    }
    await loadFinalReports();
    await openFinalReport(id);
  } finally {
    button.disabled = false;
  }
}
function parseFinalReportRecipients(text) {
  return String(text || "")
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}
function addFinalReportRecipient(email) {
  const input = document.getElementById("frSendTo");
  const list = parseFinalReportRecipients(input.value);
  if (!list.some((x) => x.toLowerCase() === String(email).toLowerCase()))
    list.push(email);
  input.value = list.join(", ");
  input.focus();
}
async function removeFinalReportRecipient(recipientId, el) {
  if (
    !confirm(
      "Xóa email này khỏi danh sách gợi ý? (Không ảnh hưởng các báo cáo đã gửi)",
    )
  )
    return;
  const result = await wrRequest(`/final-reports/recipients/${recipientId}`, {
    method: "DELETE",
  });
  if (!result) return;
  if (!result.res.ok) {
    const out = document.getElementById("frSendResult");
    out.className = "text-danger";
    out.innerText = wrApiError(result, "Không xóa được người nhận.");
    return;
  }
  const wrap = el.closest(".fr-chip-wrap");
  if (wrap) wrap.remove();
}
async function sendFinalReportEmail(id, previousCount = 0) {
  const out = document.getElementById("frSendResult"),
    button = document.getElementById("frSendButton");
  out.className = "";
  const recipients = parseFinalReportRecipients(
    document.getElementById("frSendTo").value,
  );
  if (!recipients.length) {
    out.className = "text-danger";
    out.innerText = "Vui lòng nhập ít nhất một email người nhận!";
    return;
  }
  if (
    previousCount > 0 &&
    !confirm(
      `Báo cáo này đã được gửi ${previousCount} lần. Bạn vẫn muốn gửi lại?`,
    )
  )
    return;
  out.innerText = "Đang gửi...";
  button.disabled = true;
  try {
    const result = await wrRequest(`/final-reports/${id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipients,
        message: document.getElementById("frSendMessage").value,
      }),
    });
    if (!result) return;
    if (!result.res.ok) {
      out.className = "text-danger";
      out.innerText = wrApiError(result, "Không gửi được email.");
      return;
    }
    const sentTo = result.body.data.recipients.join(", ");
    await loadFinalReports();
    await openFinalReport(id, { flash: `Đã gửi tới ${sentTo}` });
  } finally {
    button.disabled = false;
  }
}
async function deleteFinalReport(id) {
  if (!confirm("Xóa bản nháp báo cáo này?")) return;
  const button = document.activeElement;
  button.disabled = true;
  try {
    const result = await wrRequest(`/final-reports/${id}`, {
      method: "DELETE",
    });
    if (!result) return;
    if (!result.res.ok) {
      document.getElementById("finalReportError").innerText = wrApiError(
        result,
        "Không xóa được báo cáo.",
      );
      return;
    }
    document.getElementById("finalReportDetail").style.display = "none";
    await loadFinalReports();
  } finally {
    button.disabled = false;
  }
}
async function downloadFinalReportCsv(id) {
  return exportReport(
    "final",
    "csv",
    document.activeElement?.tagName === "BUTTON"
      ? document.activeElement
      : null,
    id,
  );
}
