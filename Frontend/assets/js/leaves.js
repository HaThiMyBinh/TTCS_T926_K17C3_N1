// ---------- Nghỉ phép: thực tập sinh ----------
async function loadMyLeaves() {
  const box = document.getElementById("lvList");
  box.textContent = "Đang tải...";
  const today = getVietnamToday();
  const from = document.getElementById("lvFrom"),
    to = document.getElementById("lvTo");
  if (!from.value) {
    from.value = today;
    to.value = today;
    to.min = today;
  }
  const result = await wrRequest("/me/leaves");
  if (!result) return;
  if (!result.res.ok) {
    box.textContent = wrApiError(result, "Không tải được đơn nghỉ.");
    return;
  }
  const rows = result.body.data;
  box.innerHTML = rows.length
    ? `<div class="table-container"><table><thead><tr><th>Loại</th><th>Thời gian</th><th>Số ngày</th><th>Lý do</th><th>Trạng thái</th><th></th></tr></thead><tbody>${rows
        .map((l) => {
          const [label, cls] = LEAVE_STATUS_LABEL[l.status] || [
            l.status,
            "ar-b-muted",
          ];
          const cancellable =
            l.status === "PENDING" ||
            (l.status === "APPROVED" && l.fromDate > today);
          return `<tr><td>${escapeHtml(LEAVE_TYPE_LABEL[l.leaveType] || l.leaveType)}</td><td>${escapeHtml(formatDateOnly(l.fromDate))}${l.toDate !== l.fromDate ? ` – ${escapeHtml(formatDateOnly(l.toDate))}` : ""}</td><td class="ar-num">${daysInclusive(l.fromDate, l.toDate)}</td><td>${escapeHtml(l.reason)}${l.reviewNote ? `<span class="fr-sub">Phản hồi: ${escapeHtml(l.reviewNote)}</span>` : ""}</td><td>${pill(label, cls)}</td><td>${cancellable ? `<button class="btn btn-sm btn-secondary" onclick="cancelMyLeave(${Number(l.id)})">Hủy đơn</button>` : ""}</td></tr>`;
        })
        .join("")}</tbody></table></div>`
    : "<p>Bạn chưa có đơn nghỉ nào.</p>";
}
async function submitLeave() {
  const from = document.getElementById("lvFrom").value,
    to = document.getElementById("lvTo").value,
    reason = document.getElementById("lvReason").value.trim();
  setText("lvError", "");
  if (!from || !to) return setText("lvError", "Vui lòng chọn ngày nghỉ.");
  if (from > to)
    return setText("lvError", "Ngày bắt đầu không được sau ngày kết thúc.");
  if (daysInclusive(from, to) > 30)
    return setText("lvError", "Mỗi đơn nghỉ không quá 30 ngày.");
  if (!reason) return setText("lvError", "Vui lòng nhập lý do nghỉ.");
  const button = document.getElementById("lvSubmit");
  button.disabled = true;
  try {
    const result = await wrRequest(
      "/me/leaves",
      postJson({
        leave_type: document.getElementById("lvType").value,
        from_date: from,
        to_date: to,
        reason,
      }),
    );
    if (!result) return;
    if (!result.res.ok)
      return setText("lvError", wrApiError(result, "Không gửi được đơn nghỉ."));
    document.getElementById("lvReason").value = "";
    document.getElementById("lvReasonCount").innerText = "0/500";
    const notified =
      result.body && result.body.data && result.body.data.hrNotified;
    showToast(
      notified
        ? "Đã gửi đơn nghỉ và báo cho HR qua email."
        : "Đã gửi đơn nghỉ. HR sẽ thấy đơn trong danh sách chờ duyệt.",
    );
    await loadMyLeaves();
  } finally {
    button.disabled = false;
  }
}
async function cancelMyLeave(id) {
  if (!confirm("Bạn muốn hủy đơn nghỉ này?")) return;
  const result = await wrRequest(`/me/leaves/${id}/cancel`, {
    method: "POST",
  });
  if (!result) return;
  if (!result.res.ok)
    return setText("lvError", wrApiError(result, "Không hủy được đơn nghỉ."));
  await loadMyLeaves();
}

// ---------- Nghỉ phép: HR / Mentor duyệt ----------
async function loadStaffPendingLeaves() {
  const box = document.getElementById("saLeaves");
  setText("saLeaveError", "");
  box.textContent = "Đang tải...";
  const result = await wrRequest("/leaves/pending");
  if (!result) return;
  if (!result.res.ok) {
    box.textContent = "";
    setText(
      "saLeaveError",
      wrApiError(result, "Không tải được đơn nghỉ chờ duyệt."),
    );
    return;
  }
  const rows = result.body.data;
  box.innerHTML = rows.length
    ? `<div class="table-container"><table><thead><tr><th>Thực tập sinh</th><th>Loại</th><th>Thời gian</th><th>Số ngày</th><th>Lý do</th><th></th></tr></thead><tbody>${rows.map((l) => `<tr><td>${escapeHtml(l.fullName || "")}<span class="fr-sub">${escapeHtml(l.studentCode || "")}</span></td><td>${escapeHtml(LEAVE_TYPE_LABEL[l.leaveType] || l.leaveType)}</td><td>${escapeHtml(formatDateOnly(l.fromDate))}${l.toDate !== l.fromDate ? ` – ${escapeHtml(formatDateOnly(l.toDate))}` : ""}</td><td class="ar-num">${daysInclusive(l.fromDate, l.toDate)}</td><td>${escapeHtml(l.reason)}</td><td><div class="fr-row-actions"><button class="btn btn-sm btn-primary" onclick="reviewLeave(${Number(l.id)}, 'APPROVED')">Duyệt</button><button class="btn btn-sm btn-danger" onclick="reviewLeave(${Number(l.id)}, 'REJECTED')">Từ chối</button></div></td></tr>`).join("")}</tbody></table></div>`
    : "<p>Không có đơn nghỉ nào đang chờ duyệt.</p>";
}
async function reviewLeave(id, decision) {
  let note = "";
  if (decision === "REJECTED") {
    note = prompt("Nhập lý do từ chối:") || "";
    if (!note.trim()) return;
  }
  const result = await wrRequest(
    `/leaves/${id}/review`,
    postJson({ decision, note }),
  );
  if (!result) return;
  if (!result.res.ok) {
    setText("saLeaveError", wrApiError(result, "Không xử lý được đơn nghỉ."));
    return;
  }
  await loadStaffPendingLeaves();
}
