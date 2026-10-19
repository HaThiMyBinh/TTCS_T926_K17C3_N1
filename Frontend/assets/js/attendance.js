function attendanceClockText() {
  if (!attendanceServerNow) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(attendanceServerNow);
}
function formatAttendanceMinutes(minutes) {
  if (minutes == null) return "—";
  return `${Math.floor(minutes / 60)} giờ ${minutes % 60} phút`;
}
async function loadAttendanceTab() {
  const state = document.getElementById("attendanceState");
  const button = document.getElementById("attendanceAction");
  state.innerText = "Đang tải trạng thái chấm công...";
  button.disabled = true;
  const result = await wrRequest("/me/attendance/today");
  if (!result) return;
  if (!result.res.ok) {
    state.innerText = "Không tải được trạng thái chấm công.";
    document.getElementById("attendanceError").innerText = wrApiError(
      result,
      "Lỗi tải dữ liệu",
    );
    return;
  }
  const d = result.body.data;
  attendanceServerNow = new Date(d.serverNow);
  document.getElementById("attendanceError").innerText = "";
  const row = d.record;
  const statusText = {
    NOT_CHECKED_IN: "Chưa check-in",
    CHECKED_IN: "Đang làm việc",
    CHECKED_OUT: "Đã hoàn thành hôm nay",
  }[d.status];
  const overnightNote =
    row && row.workDate !== d.workDate
      ? `<p class="text-danger">Bạn đang có ca làm việc bắt đầu ngày ${escapeHtml(row.workDate)} chưa check-out.</p>`
      : "";
  const cell = (label, value, id) =>
    `<div class="att-cell"><small>${label}</small><strong${id ? ` id="${id}"` : ""}>${value}</strong></div>`;
  const hhmm = (v, empty) => escapeHtml(v ? String(v).slice(11, 16) : empty);
  state.innerHTML = `<div class="att-grid">${cell("Ngày làm việc", escapeHtml(d.workDate))}${cell("Giờ máy chủ", escapeHtml(attendanceClockText()), "attendanceClock")}${cell("Trạng thái", statusText)}${row ? cell("Check-in", hhmm(row.checkInAt, "—")) + cell("Check-out", hhmm(row.checkOutAt, "Chưa")) + cell("Thời lượng", escapeHtml(formatAttendanceMinutes(row.durationMinutes))) : ""}</div>${overnightNote}`;
  document.getElementById("attendanceReason").innerText = d.reason || "";
  button.disabled = !(d.canCheckIn || d.canCheckOut);
  button.innerText = d.canCheckIn
    ? "Check-in"
    : d.canCheckOut
      ? "Check-out"
      : d.reason
        ? "Chưa đủ điều kiện"
        : "Đã hoàn thành hôm nay";
  if (attendanceClockTimer) clearInterval(attendanceClockTimer);
  attendanceClockTimer = setInterval(() => {
    attendanceServerNow = new Date(attendanceServerNow.getTime() + 1000);
    const clock = document.getElementById("attendanceClock");
    if (clock) clock.innerText = attendanceClockText();
  }, 1000);
  const today = d.workDate;
  const first = today.slice(0, 7) + "-01";
  document.getElementById("attendanceFrom").value ||= first;
  document.getElementById("attendanceTo").value ||= today;
  await loadAttendanceHistory();
}
async function submitAttendance() {
  const button = document.getElementById("attendanceAction");
  button.disabled = true;
  document.getElementById("attendanceError").innerText = "";
  const isIn = button.innerText === "Check-in";
  const body = isIn
    ? { note: document.getElementById("attendanceNote").value }
    : {};
  const result = await wrRequest(
    isIn ? "/me/attendance/check-in" : "/me/attendance/check-out",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!result) return;
  if (!result.res.ok)
    document.getElementById("attendanceError").innerText = wrApiError(
      result,
      "Không thể ghi nhận chấm công.",
    );
  await loadAttendanceTab();
}
function attendanceStatusText(r) {
  if (r.status === "COMPLETED")
    return r.isAdjusted ? "Hoàn tất (đã điều chỉnh)" : "Hoàn tất";
  if (r.status === "MISSING_CHECKOUT") {
    if (r.correctionStatus === "PENDING")
      return "Quên check-out · chờ duyệt bổ sung";
    if (r.correctionStatus === "REJECTED")
      return `Quên check-out · bị từ chối${r.correctionReviewNote ? ": " + r.correctionReviewNote : ""}`;
    return "Quên check-out";
  }
  return "Đang làm";
}
function attendanceSummaryChips(s) {
  const chip = (label, value, warn) =>
    `<div class="summary-chip${warn ? " warn" : ""}"><small>${label}</small><strong>${value}</strong></div>`;
  const missing = Number(s.missingCheckoutDays || 0),
    pending = Number(s.pendingCorrections || 0);
  return (
    chip(
      "Tổng thời gian",
      escapeHtml(formatAttendanceMinutes(s.totalMinutes)),
    ) +
    chip("Số ngày làm", Number(s.daysWorked || 0)) +
    chip("Quên check-out", missing, missing > 0) +
    chip("Đã điều chỉnh", Number(s.adjustedDays || 0)) +
    chip("Chờ duyệt", pending, pending > 0)
  );
}
async function loadAttendanceHistory() {
  const from = document.getElementById("attendanceFrom").value,
    to = document.getElementById("attendanceTo").value;
  const box = document.getElementById("attendanceHistory");
  box.innerText = "Đang tải lịch sử...";
  const result = await wrRequest(
    `/me/attendance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
  if (!result) return;
  if (!result.res.ok) {
    box.innerText = wrApiError(result, "Không tải được lịch sử.");
    return;
  }
  const d = result.body.data;
  document.getElementById("attendanceSummary").innerHTML =
    attendanceSummaryChips(d.summary);
  box.innerHTML = `<div class="table-container"><table><thead><tr><th>Ngày</th><th>Check-in</th><th>Check-out</th><th>Thời lượng</th><th>Trạng thái</th><th>Ghi chú</th><th></th></tr></thead><tbody>${
    d.records.length
      ? d.records
          .map(
            (r) =>
              `<tr><td>${escapeHtml(r.workDate)}</td><td>${escapeHtml(r.checkInAt ? String(r.checkInAt).slice(11, 16) : "—")}</td><td>${escapeHtml(r.checkOutAt ? String(r.checkOutAt).slice(11, 16) : "—")}</td><td>${formatAttendanceMinutes(r.durationMinutes)}</td><td>${escapeHtml(attendanceStatusText(r))}${r.correctionStatus === "PENDING" ? `<br><small>Đề nghị: ${escapeHtml(String(r.correctionCheckOutAt || "").slice(11, 16))} — ${escapeHtml(r.correctionReason || "")}</small>` : ""}</td><td>${escapeHtml(r.note || "")}</td><td>${
                r.canRequestCorrection
                  ? `<button class="btn btn-sm btn-secondary" onclick="openAttendanceCorrection(${Number(r.id)},'${escapeHtml(r.workDate)}','${escapeHtml(
                      String(r.checkInAt || "")
                        .slice(0, 16)
                        .replace(" ", "T"),
                    )}')">Bổ sung check-out</button>`
                  : ""
              }</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="7">Chưa có dữ liệu chấm công trong khoảng này.</td></tr>`
  }</tbody></table></div>`;
}
function openAttendanceCorrection(id, workDate, checkInLocal) {
  attendanceCorrectionId = id;
  document.getElementById("acDate").innerText = workDate;
  const input = document.getElementById("acCheckOut");
  input.min = checkInLocal;
  input.value = checkInLocal;
  document.getElementById("acReason").value = "";
  document.getElementById("acError").innerText = "";
  document.getElementById("attendanceCorrectionForm").style.display = "block";
}
function closeAttendanceCorrection() {
  attendanceCorrectionId = null;
  document.getElementById("attendanceCorrectionForm").style.display = "none";
}
async function submitAttendanceCorrection() {
  const error = document.getElementById("acError");
  error.innerText = "";
  const result = await wrRequest(
    `/me/attendance/${attendanceCorrectionId}/correction`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        check_out_at: document.getElementById("acCheckOut").value,
        reason: document.getElementById("acReason").value,
      }),
    },
  );
  if (!result) return;
  if (!result.res.ok) {
    error.innerText = wrApiError(result, "Không gửi được đề nghị bổ sung.");
    return;
  }
  closeAttendanceCorrection();
  await loadAttendanceHistory();
}
// ---- Chấm công: HR / Mentor ----
async function loadStaffAttendanceTab() {
  const today = new Date().toLocaleDateString("sv-SE");
  const from = document.getElementById("saFrom"),
    to = document.getElementById("saTo");
  if (!from.value) from.value = today.slice(0, 7) + "-01";
  if (!to.value) to.value = today;
  const select = document.getElementById("saIntern");
  const keep = select.value;
  const result = await wrRequest("/interns");
  if (!result) return;
  if (result.res.ok && Array.isArray(result.body)) {
    select.innerHTML =
      '<option value="">-- Chọn thực tập sinh --</option>' +
      result.body
        .map(
          (i) =>
            `<option value="${Number(i.id)}">${escapeHtml(i.fullName || i.name || "")} ${escapeHtml(i.studentCode ? "(" + i.studentCode + ")" : "")}</option>`,
        )
        .join("");
    if (keep) select.value = keep;
  }
  await loadStaffPendingCorrections();
}
async function loadStaffPendingCorrections() {
  const box = document.getElementById("saPending");
  document.getElementById("saError").innerText = "";
  box.innerText = "Đang tải...";
  const result = await wrRequest("/attendance/corrections/pending");
  if (!result) return;
  if (!result.res.ok) {
    box.innerText = "";
    document.getElementById("saError").innerText = wrApiError(
      result,
      "Không tải được danh sách chờ duyệt.",
    );
    return;
  }
  const rows = result.body.data;
  box.innerHTML = `<div class="table-container"><table><thead><tr><th>Thực tập sinh</th><th>Ngày</th><th>Check-in</th><th>Check-out đề nghị</th><th>Thời lượng</th><th>Lý do</th><th></th></tr></thead><tbody>${
    rows.length
      ? rows
          .map((r) => {
            const mins = Math.max(
              0,
              Math.floor(
                (new Date(
                  String(r.correctionCheckOutAt).replace(" ", "T") + "+07:00",
                ) -
                  new Date(String(r.checkInAt).replace(" ", "T") + "+07:00")) /
                  60000,
              ),
            );
            return `<tr><td>${escapeHtml(r.fullName || "")}<br>${escapeHtml(r.studentCode || "")}</td><td>${escapeHtml(r.workDate)}</td><td>${escapeHtml(String(r.checkInAt).slice(11, 16))}</td><td>${escapeHtml(String(r.correctionCheckOutAt).slice(0, 16))}</td><td>${formatAttendanceMinutes(mins)}</td><td>${escapeHtml(r.correctionReason || "")}</td><td><button class="btn btn-sm btn-primary" onclick="reviewAttendanceCorrection(${Number(r.id)},'APPROVED')">Duyệt</button> <button class="btn btn-sm btn-danger" onclick="reviewAttendanceCorrection(${Number(r.id)},'REJECTED')">Từ chối</button></td></tr>`;
          })
          .join("")
      : `<tr><td colspan="7">Không có đề nghị nào đang chờ duyệt.</td></tr>`
  }</tbody></table></div>`;
}
async function reviewAttendanceCorrection(id, decision) {
  let note = "";
  if (decision === "REJECTED") {
    note = prompt("Nhập lý do từ chối:") || "";
    if (!note.trim()) return;
  }
  const result = await wrRequest(`/attendance/${id}/correction/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, note }),
  });
  if (!result) return;
  if (!result.res.ok) {
    document.getElementById("saError").innerText = wrApiError(
      result,
      "Không xử lý được đề nghị.",
    );
    return;
  }
  await loadStaffPendingCorrections();
  if (document.getElementById("saIntern").value)
    await loadStaffAttendanceHistory();
}
async function loadStaffAttendanceHistory() {
  const internId = document.getElementById("saIntern").value;
  const box = document.getElementById("saHistory");
  if (!internId) {
    box.innerText = "Chưa chọn thực tập sinh.";
    return;
  }
  const from = document.getElementById("saFrom").value,
    to = document.getElementById("saTo").value;
  box.innerText = "Đang tải...";
  const result = await wrRequest(
    `/interns/${encodeURIComponent(internId)}/attendance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
  if (!result) return;
  if (!result.res.ok) {
    box.innerText = wrApiError(result, "Không tải được chấm công.");
    return;
  }
  const d = result.body.data;
  document.getElementById("saSummary").innerHTML = attendanceSummaryChips(
    d.summary,
  );
  box.innerHTML = `<div class="table-container"><table><thead><tr><th>Ngày</th><th>Check-in</th><th>Check-out</th><th>Thời lượng</th><th>Trạng thái</th><th>Ghi chú</th></tr></thead><tbody>${d.records.length ? d.records.map((r) => `<tr><td>${escapeHtml(r.workDate)}</td><td>${escapeHtml(r.checkInAt ? String(r.checkInAt).slice(11, 16) : "—")}</td><td>${escapeHtml(r.checkOutAt ? String(r.checkOutAt).slice(11, 16) : "—")}</td><td>${formatAttendanceMinutes(r.durationMinutes)}</td><td>${escapeHtml(attendanceStatusText(r))}</td><td>${escapeHtml(r.note || "")}</td></tr>`).join("") : `<tr><td colspan="6">Chưa có dữ liệu chấm công trong khoảng này.</td></tr>`}</tbody></table></div>`;
}
