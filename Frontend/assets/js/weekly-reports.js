// Gọi API có kèm token; trả về null nếu phiên đã hết hạn (đã chuyển về đăng nhập).
async function wrRequest(url, options = {}) {
  const { headers, ...rest } = options;
  const res = await fetch(`${API_BASE}${url}`, {
    ...rest,
    headers: authHeaders(headers),
  });
  if (res.status === 401) {
    forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    return null;
  }
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

function wrApiError(result, fallback) {
  return result.body.message || result.body.error || fallback;
}

function wrWeekRange(weekStart, weekEnd) {
  return `${formatTaskDate(weekStart)} – ${formatTaskDate(weekEnd)}`;
}

// Số ngày từ ngày a đến ngày b (YYYY-MM-DD), dương nếu b ở sau a.
function wrDaysBetween(a, b) {
  const toUtc = (v) => {
    const [y, m, d] = v.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

function weeklyAttachmentList(report, { removable = false } = {}) {
  const files = Array.isArray(report.attachments) ? report.attachments : [];
  if (!files.length) return "";
  const items = files
    .map((f) => {
      const name = escapeHtml(f.original_name);
      const args = `${Number(report.id)}, ${Number(f.id)}, ${escapeHtml(JSON.stringify(f.original_name))}, ${f.can_preview ? "true" : "false"}`;
      const open = `<a onclick="downloadWeeklyReportAttachment(${args})" title="${f.can_preview ? "Xem" : "Tải xuống"}">${name}</a>`;
      const remove = removable
        ? `<button type="button" class="att-remove" title="Xóa file" onclick="removeWeeklyReportAttachment(${Number(report.id)}, ${Number(f.id)})"><i class="fa-solid fa-xmark"></i></button>`
        : "";
      return `<li><i class="fa-solid fa-paperclip"></i><span class="att-name">${open}</span><span class="att-size">${escapeHtml(formatFileSize(f.size_bytes))}</span>${remove}</li>`;
    })
    .join("");
  return `<ul class="task-attachments">${items}</ul>`;
}

// Tải/xem tệp đính kèm qua API có phân quyền (fetch kèm token rồi mở blob).
async function downloadWeeklyReportAttachment(
  reportId,
  attachmentId,
  filename,
  inline = false,
) {
  try {
    const res = await fetch(
      `${API_BASE}/weekly-reports/${Number(reportId)}/attachments/${Number(attachmentId)}/download${inline ? "?disposition=inline" : ""}`,
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

// ---------- Thực tập sinh ----------
async function loadWeeklyReportsTab({ keepOpen = false } = {}) {
  const internView = document.getElementById("wrInternView");
  const notIntern = document.getElementById("wrNotIntern");
  const isIntern = currentRole === "Intern";
  internView.style.display = isIntern ? "block" : "none";
  notIntern.style.display = isIntern ? "none" : "block";
  if (!isIntern) return;

  const tbody = document.getElementById("wrWeeksBody");
  try {
    const [st, list] = await Promise.all([
      wrRequest("/me/weekly-reports/status"),
      wrRequest("/me/weekly-reports"),
    ]);
    if (!st || !list) return;
    if (!st.res.ok || !st.body.success)
      throw new Error(wrApiError(st, "Không thể tải trạng thái báo cáo tuần."));
    if (!list.res.ok || !list.body.success)
      throw new Error(
        wrApiError(list, "Không thể tải danh sách báo cáo tuần."),
      );

    wrStatusData = st.body.data;
    wrReportsByWeek = {};
    for (const report of list.body.data)
      wrReportsByWeek[report.week_start] = report;

    // Form mặc định ẩn: chỉ giữ mở khi đang sửa dở (keepOpen)
    // và tuần đó còn tồn tại.
    const stillThere = wrStatusData.weeks.some(
      (w) => w.week_start === wrSelectedWeek,
    );
    if (keepOpen && stillThere) selectWeeklyReportWeek(wrSelectedWeek);
    else closeWeeklyReportForm();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#b91c1c;padding:24px">${escapeHtml(err.message || "Lỗi kết nối server!")}</td></tr>`;
  }
}

function renderWeeklyStatus() {
  const data = wrStatusData;
  const tbody = document.getElementById("wrWeeksBody");
  const summaryEl = document.getElementById("wrSummary");

  if (!data.weeks.length) {
    summaryEl.innerHTML = `<div class="wr-alert info">Kỳ thực tập của bạn chưa bắt đầu nên chưa có tuần nào cần nộp báo cáo.</div>`;
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:24px">Chưa có tuần nào cần nộp báo cáo.</td></tr>`;
    return;
  }

  const current = data.weeks.find(
    (w) => w.week_start === data.current_week_start,
  );
  let currentHtml = "";
  if (current) {
    const left = wrDaysBetween(data.today, current.week_end);
    const deadlineText =
      left === 0
        ? "hôm nay (Chủ nhật)"
        : `còn ${left} ngày (hết Chủ nhật ${formatTaskDate(current.week_end)})`;
    const stateText =
      current.status === "UPCOMING"
        ? `chưa nộp, hạn nộp ${deadlineText}`
        : current.status === "LATE_SUBMITTED"
          ? "đã nộp trễ"
          : "đã nộp";
    const cls = current.status === "UPCOMING" ? "info" : "ok";
    currentHtml = `<div class="wr-alert ${cls}"><b>Tuần này</b> (${escapeHtml(wrWeekRange(current.week_start, current.week_end))}): ${escapeHtml(stateText)}.</div>`;
  }
  const missing = data.summary.missing;
  const missingHtml = missing
    ? `<div class="wr-alert warn"><i class="fa-solid fa-triangle-exclamation"></i> Bạn còn <b>${missing}</b> tuần chưa nộp báo cáo. Hãy chọn tuần đó trong bảng và bấm <b>Nộp bù</b>.</div>`
    : "";
  summaryEl.innerHTML = `${missingHtml}${currentHtml}
          <span>Đã nộp: <b>${data.summary.submitted}</b></span>
          <span>Nộp trễ: <b>${data.summary.late_submitted}</b></span>
          <span>Chưa nộp: <b>${missing}</b></span>`;

  tbody.innerHTML = data.weeks
    .map((w) => {
      const selected = w.week_start === wrSelectedWeek;
      const action = w.report_id
        ? "Xem / Sửa"
        : w.status === "MISSING"
          ? "Nộp bù"
          : "Nộp";
      return `<tr class="${selected ? "wr-row-selected" : ""}">
              <td>${escapeHtml(wrWeekRange(w.week_start, w.week_end))}</td>
              <td>${escapeHtml(formatTaskDate(w.week_end))} 23:59</td>
              <td>${taskBadge(WR_STATUS_UI, w.status)}${w.has_feedback ? ' <span class="badge badge-sent" title="Mentor đã phản hồi báo cáo này"><i class="fa-solid fa-comment-dots"></i> Có phản hồi</span>' : ""}</td>
              <td>${escapeHtml(w.submitted_at ? formatProgressTime(w.submitted_at) : "—")}</td>
              <td><button class="btn btn-sm btn-primary" type="button" onclick="selectWeeklyReportWeek(${escapeHtml(JSON.stringify(w.week_start))})">${action}</button></td>
            </tr>`;
    })
    .join("");
}

// Chọn một tuần để nộp/sửa: điền sẵn nội dung nếu đã có báo cáo.
function selectWeeklyReportWeek(weekStart) {
  wrSelectedWeek = weekStart;
  wrPendingFiles = [];
  document.getElementById("wrFiles").value = "";
  document.getElementById("wrFormError").textContent = "";
  renderWeeklyStatus();

  const formCard = document.getElementById("wrFormCard");
  const formBody = document.getElementById("wrFormBody");
  const week = wrStatusData.weeks.find((w) => w.week_start === weekStart);
  if (!week) {
    closeWeeklyReportForm();
    return;
  }
  formBody.style.display = "block";
  formCard.style.display = "block";

  const report = wrReportsByWeek[weekStart] || null;
  document.getElementById("wrContent").value = report ? report.content : "";
  document.getElementById("wrDifficulties").value = report
    ? report.difficulties
    : "";
  document.getElementById("wrNextPlan").value = report ? report.next_plan : "";
  const verb = report ? "Sửa báo cáo" : "Nộp báo cáo";
  document.getElementById("wrFormTitle").innerHTML =
    `<i class="fa-solid fa-pen-to-square text-primary"></i> ${verb} tuần ${escapeHtml(wrWeekRange(week.week_start, week.week_end))}`;
  document.getElementById("wrSubmitBtn").innerHTML =
    `<i class="fa-solid fa-paper-plane"></i> ${report ? "Lưu thay đổi" : week.status === "MISSING" ? "Nộp bù" : "Nộp báo cáo"}`;
  renderWeeklyFiles();
  renderInternFeedback(report);
  formCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Ẩn form nộp/sửa báo cáo và bỏ chọn tuần (dùng khi lưu xong hoặc bấm Đóng).
function closeWeeklyReportForm() {
  wrSelectedWeek = null;
  wrPendingFiles = [];
  const filesEl = document.getElementById("wrFiles");
  if (filesEl) filesEl.value = "";
  document.getElementById("wrFormError").textContent = "";
  document.getElementById("wrFormCard").style.display = "none";
  if (wrStatusData) renderWeeklyStatus();
}

// Thực tập sinh chỉ đọc phản hồi của mentor (không sửa/xóa được).
function renderInternFeedback(report) {
  const box = document.getElementById("wrFeedbackBox");
  if (!box) return;
  if (!report) {
    box.innerHTML = "";
    return;
  }
  const fb = report.feedback;
  if (!fb) {
    box.innerHTML = `<div class="wr-feedback-box muted"><i class="fa-regular fa-comment-dots"></i> Mentor chưa phản hồi báo cáo này.</div>`;
    return;
  }
  const when = fb.updated_at ? formatProgressTime(fb.updated_at) : "";
  const who = fb.mentor_name ? escapeHtml(fb.mentor_name) : "Mentor";
  const outdated = report.feedback_outdated
    ? `<div class="wr-alert info" style="margin-top:10px">Bạn đã sửa báo cáo sau lần phản hồi này, mentor có thể chưa xem bản mới.</div>`
    : "";
  box.innerHTML = `<div class="wr-feedback-box">
          <div class="wr-feedback-head"><i class="fa-solid fa-comment-dots"></i> <b>Phản hồi của ${who}</b>${when ? ` · ${escapeHtml(when)}` : ""}</div>
          <div class="wr-detail-text">${escapeHtml(fb.content)}</div>
          ${outdated}
        </div>`;
}

function renderWeeklyFiles() {
  const report = wrReportsByWeek[wrSelectedWeek] || null;
  document.getElementById("wrExistingFiles").innerHTML = report
    ? weeklyAttachmentList(report, { removable: true })
    : "";
  document.getElementById("wrPendingFiles").innerHTML = wrPendingFiles
    .map(
      (f, i) =>
        `<li><i class="fa-solid fa-file-arrow-up"></i><span class="att-name">${escapeHtml(f.name)}</span><span class="att-size">${escapeHtml(formatFileSize(f.size))}</span><button type="button" class="att-remove" title="Bỏ file" onclick="removePendingWeeklyFile(${i})"><i class="fa-solid fa-xmark"></i></button></li>`,
    )
    .join("");
}

function removePendingWeeklyFile(index) {
  wrPendingFiles.splice(index, 1);
  renderWeeklyFiles();
}

// Kiểm tra nhanh phía client (server vẫn kiểm tra lại đuôi, dung lượng, nội dung).
function onWeeklyFilesChange() {
  const input = document.getElementById("wrFiles");
  const errEl = document.getElementById("wrFormError");
  const report = wrReportsByWeek[wrSelectedWeek] || null;
  const existing = report ? report.attachments.length : 0;
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
    } else if (existing + wrPendingFiles.length >= TASK_ATTACHMENT_LIMIT) {
      problems.push(`Chỉ được đính kèm tối đa ${TASK_ATTACHMENT_LIMIT} file`);
      break;
    } else {
      wrPendingFiles.push(file);
    }
  }
  input.value = "";
  errEl.textContent = problems.join("; ");
  renderWeeklyFiles();
}

// Xóa file đã đính kèm trước đó (thực hiện ngay, không cần bấm Nộp).
async function removeWeeklyReportAttachment(reportId, attachmentId) {
  if (!confirm("Bạn có chắc chắn muốn xóa tệp đính kèm này không?")) return;
  const errEl = document.getElementById("wrFormError");
  try {
    const r = await wrRequest(
      `/me/weekly-reports/${Number(reportId)}/attachments/${Number(attachmentId)}`,
      { method: "DELETE" },
    );
    if (!r) return;
    if (!r.res.ok || !r.body.success) {
      errEl.textContent = wrApiError(r, "Không thể xóa tệp đính kèm.");
      return;
    }
    errEl.textContent = "";
    const updated = r.body.data.report;
    wrReportsByWeek[updated.week_start] = updated;
    renderWeeklyFiles();
  } catch (err) {
    errEl.textContent = "Lỗi kết nối server!";
  }
}

// Tải lần lượt từng file; trả về danh sách lỗi (null nếu hết phiên đăng nhập).
async function uploadWeeklyReportFiles(reportId, files) {
  const failures = [];
  for (const file of files) {
    try {
      const formData = new FormData();
      formData.append("file", file);
      const r = await wrRequest(
        `/me/weekly-reports/${Number(reportId)}/attachments`,
        { method: "POST", body: formData },
      );
      if (!r) return null;
      if (!r.res.ok || !r.body.success)
        failures.push({
          file,
          message: wrApiError(r, "Tải lên thất bại"),
        });
    } catch (err) {
      failures.push({ file, message: "Lỗi kết nối server" });
    }
  }
  return failures;
}

async function submitWeeklyReport() {
  if (!wrSelectedWeek) return;
  const errEl = document.getElementById("wrFormError");
  const btn = document.getElementById("wrSubmitBtn");
  const content = document.getElementById("wrContent").value;
  if (!content.trim()) {
    errEl.textContent = "Vui lòng nhập nội dung kết quả thực hiện!";
    return;
  }
  errEl.textContent = "";
  btn.disabled = true;

  let saved = false;
  let uploadFailures = [];
  let message = "Đã nộp báo cáo tuần!";
  try {
    const r = await wrRequest("/me/weekly-reports", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        week_start: wrSelectedWeek,
        content,
        difficulties: document.getElementById("wrDifficulties").value,
        next_plan: document.getElementById("wrNextPlan").value,
      }),
    });
    if (!r) return;
    if (!r.res.ok || !r.body.success) {
      errEl.textContent = wrApiError(r, "Không thể nộp báo cáo.");
      return;
    }
    saved = true;
    message = r.body.message || message;

    // Báo cáo đã lưu; tiếp tục tải các file đính kèm (nếu có).
    if (wrPendingFiles.length) {
      const failures = await uploadWeeklyReportFiles(
        r.body.data.id,
        wrPendingFiles,
      );
      if (failures === null) return; // hết phiên đăng nhập
      uploadFailures = failures;
    }
  } catch (err) {
    errEl.textContent = saved
      ? "Đã lưu báo cáo nhưng lỗi kết nối khi tải file!"
      : "Lỗi kết nối server!";
  } finally {
    btn.disabled = false;
  }
  if (!saved) return;

  await loadWeeklyReportsTab({ keepOpen: uploadFailures.length > 0 });
  if (uploadFailures.length) {
    // Giữ lại các file lỗi để thử lại; báo cáo đã được lưu.
    wrPendingFiles = uploadFailures.map((f) => f.file);
    renderWeeklyFiles();
    document.getElementById("wrFormError").textContent =
      "Đã lưu báo cáo nhưng chưa tải được: " +
      uploadFailures.map((f) => `"${f.file.name}" (${f.message})`).join("; ");
    return;
  }
  showToast(message, "success");
}

// ---------- Mentor: xem báo cáo (chỉ đọc) + phản hồi ----------
function wrMondayOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay(); // 0 = Chủ nhật
  date.setUTCDate(date.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return date.toISOString().slice(0, 10);
}

function wrAddDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

function shiftMentorWeek(direction) {
  if (!wrMentorWeek) return;
  loadMentorWeeklyReports(wrAddDays(wrMentorWeek, 7 * direction));
}

function onMentorWeekDateChange() {
  const value = document.getElementById("wrMentorDate").value;
  if (value) loadMentorWeeklyReports(wrMondayOf(value));
}

// weekStart: undefined = giữ tuần đang xem, null = tuần hiện tại, chuỗi = tuần chỉ định.
async function loadMentorWeeklyReports(weekStart) {
  if (weekStart !== undefined) wrMentorWeek = weekStart;
  const tbody = document.getElementById("wrMentorBody");
  const summaryEl = document.getElementById("wrMentorSummary");
  document.getElementById("wrMentorDetail").style.display = "none";
  const query = wrMentorWeek
    ? `?week_start=${encodeURIComponent(wrMentorWeek)}`
    : "";
  try {
    const [ov, list] = await Promise.all([
      wrRequest(`/weekly-reports/overview${query}`),
      wrRequest(`/weekly-reports${query}`),
    ]);
    if (!ov || !list) return;
    if (!ov.res.ok || !ov.body.success)
      throw new Error(wrApiError(ov, "Không thể tải tổng quan báo cáo tuần."));
    if (!list.res.ok || !list.body.success)
      throw new Error(wrApiError(list, "Không thể tải báo cáo tuần."));

    wrMentorOverview = ov.body.data;
    wrMentorWeek = wrMentorOverview.week_start;
    wrMentorReports = list.body.data;
    document.getElementById("wrMentorDate").value = wrMentorOverview.week_start;
    renderMentorWeeklyTable();
  } catch (err) {
    wrMentorOverview = null;
    summaryEl.innerHTML = "";
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#b91c1c;padding:24px">${escapeHtml(err.message || "Lỗi kết nối server!")}</td></tr>`;
  }
}

function wrFeedbackState(row) {
  if (!row.has_feedback) return "PENDING";
  return row.feedback_outdated ? "OUTDATED" : "DONE";
}

// Vẽ lại tóm tắt + bảng từ wrMentorOverview (không gọi API) — dùng khi đổi bộ lọc hoặc vừa lưu phản hồi.
function renderMentorWeeklyTable() {
  const data = wrMentorOverview;
  if (!data) return;
  const tbody = document.getElementById("wrMentorBody");
  const summaryEl = document.getElementById("wrMentorSummary");
  const pendingOnly = document.getElementById("wrMentorPendingOnly").checked;

  const s = data.summary;
  summaryEl.innerHTML = `
          <span><b>Tuần ${escapeHtml(wrWeekRange(data.week_start, data.week_end))}</b> · hạn nộp ${escapeHtml(formatTaskDate(data.week_end))} 23:59</span>
          <span>Đã nộp: <b>${s.submitted}</b></span>
          <span>Nộp trễ: <b>${s.late_submitted}</b></span>
          <span>Chưa nộp: <b>${s.missing}</b></span>
          <span>Chưa đến hạn: <b>${s.upcoming}</b></span>
          <span>Chờ phản hồi: <b>${s.feedback_pending}</b></span>`;

  if (!data.interns.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:24px">Không có thực tập sinh nào cần nộp báo cáo trong tuần này.</td></tr>`;
    return;
  }
  const rows = pendingOnly
    ? data.interns.filter((i) => i.report_id && !i.has_feedback)
    : data.interns;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:24px">Không có báo cáo nào đang chờ phản hồi.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((i) => {
      const code = i.student_code
        ? ` <span style="color:#94a3b8">(${escapeHtml(i.student_code)})</span>`
        : "";
      const feedbackCell = i.report_id
        ? taskBadge(WR_FEEDBACK_UI, wrFeedbackState(i))
        : "—";
      const action = i.report_id
        ? `<button class="btn btn-sm btn-primary" type="button" onclick="showMentorWeeklyReport(${Number(i.intern_id)})">Xem / Phản hồi</button>`
        : "—";
      return `<tr>
              <td>${escapeHtml(i.intern_name)}${code}</td>
              <td>${taskBadge(WR_STATUS_UI, i.status)}</td>
              <td>${escapeHtml(i.submitted_at ? formatProgressTime(i.submitted_at) : "—")}</td>
              <td>${feedbackCell}</td>
              <td>${action}</td>
            </tr>`;
    })
    .join("");
}

function showMentorWeeklyReport(internId, { scroll = true } = {}) {
  const report = wrMentorReports.find(
    (r) => Number(r.intern_id) === Number(internId),
  );
  const box = document.getElementById("wrMentorDetail");
  if (!report) {
    box.style.display = "none";
    return;
  }
  const block = (label, text) =>
    `<div class="form-group"><label>${label}</label><div class="wr-detail-text">${text ? escapeHtml(text) : '<span style="color:#94a3b8">Không có</span>'}</div></div>`;
  const late = report.is_late
    ? ' <span class="badge badge-retrying">Nộp trễ</span>'
    : "";
  const fb = report.feedback;
  const fbInfo = fb
    ? `<div class="wr-field-note" style="margin-bottom:6px">Phản hồi bởi ${escapeHtml(fb.mentor_name || "Mentor")}${fb.updated_at ? ` · cập nhật lúc ${escapeHtml(formatProgressTime(fb.updated_at))}` : ""}</div>`
    : `<div class="wr-field-note" style="margin-bottom:6px">Chưa có phản hồi cho báo cáo này.</div>`;
  const fbOutdated =
    fb && report.feedback_outdated
      ? `<div class="wr-alert warn" style="margin-bottom:8px">Thực tập sinh đã sửa báo cáo sau lần phản hồi gần nhất. Hãy xem lại và cập nhật phản hồi.</div>`
      : "";
  box.innerHTML = `
          <div class="card-header">
            <h3><i class="fa-solid fa-file-lines text-primary"></i> ${escapeHtml(report.intern_name)} · tuần ${escapeHtml(wrWeekRange(report.week_start, report.week_end))}${late}</h3>
          </div>
          <div class="card-body">
            <div class="wr-field-note" style="margin-bottom:12px">Nộp lúc ${escapeHtml(formatProgressTime(report.submitted_at))}</div>
            ${block("Kết quả thực hiện trong tuần", report.content)}
            ${block("Khó khăn gặp phải", report.difficulties)}
            ${block("Kế hoạch tuần sau", report.next_plan)}
            <div class="form-group"><label>Tệp đính kèm</label>${weeklyAttachmentList(report) || '<div><span style="color:#94a3b8">Không có</span></div>'}</div>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0" />
            <div class="form-group">
              <label for="wrFeedbackInput"><i class="fa-solid fa-comment-dots text-primary"></i> Phản hồi cho thực tập sinh</label>
              ${fbInfo}
              ${fbOutdated}
              <textarea id="wrFeedbackInput" class="form-control" maxlength="${WR_FEEDBACK_MAX}" style="min-height:110px" placeholder="Nhận xét, góp ý, hướng dẫn cho thực tập sinh..." oninput="updateFeedbackCounter()"></textarea>
              <div id="wrFeedbackCounter" class="wr-field-note"></div>
              <div id="wrFeedbackError" class="modal-error"></div>
              <div class="wr-feedback-actions">
                <button id="wrFeedbackSaveBtn" class="btn btn-primary" type="button" onclick="saveMentorFeedback(${Number(report.id)})"><i class="fa-solid fa-paper-plane"></i> ${fb ? "Cập nhật phản hồi" : "Gửi phản hồi"}</button>
                ${fb ? `<button id="wrFeedbackDeleteBtn" class="btn btn-sm btn-outline-danger" type="button" onclick="deleteMentorFeedback(${Number(report.id)})"><i class="fa-solid fa-trash"></i> Xóa phản hồi</button>` : ""}
              </div>
            </div>
          </div>`;
  // Gán qua .value để nội dung người dùng không bao giờ được diễn giải như HTML.
  document.getElementById("wrFeedbackInput").value = fb ? fb.content : "";
  updateFeedbackCounter();
  box.style.display = "block";
  if (scroll) box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function updateFeedbackCounter() {
  const input = document.getElementById("wrFeedbackInput");
  const counter = document.getElementById("wrFeedbackCounter");
  if (!input || !counter) return;
  counter.textContent = `${input.value.trim().length}/${WR_FEEDBACK_MAX} ký tự`;
}

function setFeedbackBusy(busy) {
  for (const id of [
    "wrFeedbackSaveBtn",
    "wrFeedbackDeleteBtn",
    "wrFeedbackInput",
  ]) {
    const el = document.getElementById(id);
    if (el) el.disabled = busy;
  }
}

// Cập nhật báo cáo vừa lưu/xóa phản hồi vào bộ nhớ rồi vẽ lại bảng + khung chi tiết (không tải lại cả trang).
function applyMentorFeedbackResult(report) {
  wrMentorReports = wrMentorReports.map((r) =>
    Number(r.id) === Number(report.id) ? report : r,
  );
  if (wrMentorOverview) {
    const row = wrMentorOverview.interns.find(
      (i) => Number(i.report_id) === Number(report.id),
    );
    if (row) {
      row.has_feedback = Boolean(report.feedback);
      row.feedback_outdated = Boolean(report.feedback_outdated);
    }
    wrMentorOverview.summary.feedback_pending = wrMentorOverview.interns.filter(
      (i) => i.report_id && !i.has_feedback,
    ).length;
    renderMentorWeeklyTable();
  }
  showMentorWeeklyReport(report.intern_id, { scroll: false });
}

async function saveMentorFeedback(reportId) {
  const input = document.getElementById("wrFeedbackInput");
  const errEl = document.getElementById("wrFeedbackError");
  const content = input.value;
  if (!content.trim()) {
    errEl.textContent = "Vui lòng nhập nội dung phản hồi!";
    return;
  }
  if (content.trim().length > WR_FEEDBACK_MAX) {
    errEl.textContent = `Nội dung phản hồi không được vượt quá ${WR_FEEDBACK_MAX} ký tự!`;
    return;
  }
  errEl.textContent = "";
  setFeedbackBusy(true);
  try {
    const r = await wrRequest(`/weekly-reports/${Number(reportId)}/feedback`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!r) return;
    if (!r.res.ok || !r.body.success) {
      errEl.textContent = wrApiError(r, "Không thể lưu phản hồi.");
      return;
    }
    showToast(r.body.message || "Đã lưu phản hồi!", "success");
    applyMentorFeedbackResult(r.body.data);
  } catch (err) {
    errEl.textContent = "Lỗi kết nối server!";
  } finally {
    setFeedbackBusy(false);
  }
}

async function deleteMentorFeedback(reportId) {
  if (!confirm("Bạn có chắc chắn muốn xóa phản hồi này không?")) return;
  const errEl = document.getElementById("wrFeedbackError");
  errEl.textContent = "";
  setFeedbackBusy(true);
  try {
    const r = await wrRequest(`/weekly-reports/${Number(reportId)}/feedback`, {
      method: "DELETE",
    });
    if (!r) return;
    if (!r.res.ok || !r.body.success) {
      errEl.textContent = wrApiError(r, "Không thể xóa phản hồi.");
      return;
    }
    showToast(r.body.message || "Đã xóa phản hồi!", "success");
    applyMentorFeedbackResult(r.body.data);
  } catch (err) {
    errEl.textContent = "Lỗi kết nối server!";
  } finally {
    setFeedbackBusy(false);
  }
}
