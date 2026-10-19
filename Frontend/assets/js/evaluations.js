function evFormatScore(value) {
  return value === null || value === undefined ? "—" : `${value}/5`;
}

async function loadMentorEvaluations() {
  const tbody = document.getElementById("evBody");
  document.getElementById("evDetail").style.display = "none";
  evCurrentInternId = null;
  try {
    const r = await wrRequest("/evaluations/overview");
    if (!r) return;
    if (!r.res.ok || !r.body.success)
      throw new Error(
        wrApiError(r, "Không thể tải danh sách đánh giá thực tập sinh."),
      );
    evOverview = r.body.data;
    renderMentorEvaluationTable();
  } catch (err) {
    evOverview = null;
    document.getElementById("evSummary").innerHTML = "";
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#b91c1c;padding:24px">${escapeHtml(err.message || "Lỗi kết nối server!")}</td></tr>`;
  }
}

// Vẽ lại tóm tắt + bảng từ evOverview (không gọi API).
function renderMentorEvaluationTable() {
  const data = evOverview;
  if (!data) return;
  const tbody = document.getElementById("evBody");
  const pendingOnly = document.getElementById("evPendingOnly").checked;
  const s = data.summary;
  document.getElementById("evSummary").innerHTML = `
          <span>Tổng thực tập sinh: <b>${s.total}</b></span>
          <span>Đã đánh giá: <b>${s.evaluated}</b></span>
          <span>Chưa đánh giá: <b>${s.pending}</b></span>`;

  if (!data.interns.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px">Bạn chưa được phân công thực tập sinh nào.</td></tr>`;
    return;
  }
  const rows = pendingOnly
    ? data.interns.filter((i) => !i.has_evaluation)
    : data.interns;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px">Tất cả thực tập sinh đã được đánh giá.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((i) => {
      const code = i.student_code
        ? ` <span style="color:#94a3b8">(${escapeHtml(i.student_code)})</span>`
        : "";
      return `<tr>
              <td>${escapeHtml(i.intern_name)}${code}</td>
              <td>${taskBadge(EV_STATUS_UI, i.has_evaluation ? "DONE" : "PENDING")}</td>
              <td>${escapeHtml(evFormatScore(i.skill_score))}</td>
              <td>${escapeHtml(evFormatScore(i.attitude_score))}</td>
              <td>${i.has_evaluation ? `<b>${escapeHtml(i.overall_score)}</b>/5` : "—"}</td>
              <td>${escapeHtml(i.updated_at ? formatProgressTime(i.updated_at) : "—")}</td>
              <td><button class="btn btn-sm btn-primary" type="button" onclick="openMentorEvaluation(${Number(i.intern_id)})">${i.has_evaluation ? "Xem / Sửa" : "Đánh giá"}</button></td>
            </tr>`;
    })
    .join("");
}

// ---------- Bản nháp (lưu trên trình duyệt, chưa gửi lên server) ----------
function evDraftKey(internId) {
  return `ev_draft_${Number(internId)}`;
}
function evLoadDraft(internId) {
  try {
    const raw = localStorage.getItem(evDraftKey(internId));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}
function evClearDraft(internId) {
  try {
    localStorage.removeItem(evDraftKey(internId));
  } catch (err) {
    /* bỏ qua */
  }
}

function evScoreGroup(name, selected) {
  return `<div class="ev-score-group" role="radiogroup">${[1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<label class="ev-score-option"><input type="radio" name="${name}" value="${n}" ${Number(selected) === n ? "checked" : ""} onchange="updateEvaluationOverall()" /><span class="ev-score-num">${n}</span><i class="fa-regular fa-star ev-score-star"></i></label>`,
    )
    .join("")}</div>`;
}

async function openMentorEvaluation(internId) {
  const row = evOverview?.interns.find(
    (i) => Number(i.intern_id) === Number(internId),
  );
  const box = document.getElementById("evDetail");
  if (!row) {
    box.style.display = "none";
    return;
  }
  evCurrentInternId = Number(internId);
  box.style.display = "block";
  box.innerHTML = `<div class="card-body" style="color:#94a3b8">Đang tải đánh giá...</div>`;
  let ev = null;
  try {
    const r = await wrRequest(`/interns/${Number(internId)}/evaluation`);
    if (!r) return;
    if (!r.res.ok || !r.body.success)
      throw new Error(wrApiError(r, "Không thể tải đánh giá."));
    ev = r.body.data;
  } catch (err) {
    box.innerHTML = `<div class="card-body" style="color:#b91c1c">${escapeHtml(err.message || "Lỗi kết nối server!")}</div>`;
    return;
  }
  // Chưa có đánh giá chính thức thì dùng bản nháp (nếu có) để điền sẵn.
  const draft = ev ? null : evLoadDraft(internId);
  const init = ev || draft || {};
  const code = row.student_code ? ` (${escapeHtml(row.student_code)})` : "";
  const [statusLabel, statusCls] = ev
    ? ["Đã đánh giá", "ev-pill-done"]
    : draft
      ? ["Bản nháp", "ev-pill-draft"]
      : ["Chờ đánh giá", "ev-pill-wait"];
  const subInfo = ev
    ? `Thực tập sinh · Đã đánh giá${ev.updated_at ? ` · cập nhật ${escapeHtml(formatProgressTime(ev.updated_at))}` : ""}`
    : "Thực tập sinh · Chưa đánh giá";
  const byLine = ev
    ? `<div class="ev-sub" style="margin-top:6px">Đánh giá bởi ${escapeHtml(ev.mentor_name || "Mentor")}</div>`
    : "";
  box.innerHTML = `
          <div class="ev-head">
            <div>
              <h3 class="ev-title">Đánh giá thực tập sinh</h3>
              <div class="ev-sub">Đánh giá cuối kỳ</div>
            </div>
            <button id="evCloseBtn" class="ev-close" type="button" title="Đóng" onclick="closeMentorEvaluation()"><i class="fa-solid fa-xmark"></i></button>
          </div>

          <div class="ev-intern">
            <i class="fa-regular fa-user ev-intern-icon"></i>
            <div class="ev-intern-info">
              <div class="ev-intern-name">${escapeHtml(row.intern_name)}${code}</div>
              <div class="ev-sub">${subInfo}</div>
            </div>
            <span class="ev-pill ${statusCls}">${statusLabel}</span>
          </div>
          ${byLine}

          <div class="ev-section">
            <div class="ev-label">1. Kỹ năng chuyên môn</div>
            <div class="ev-sub">Đánh giá chất lượng và khả năng hoàn thành công việc.</div>
            ${evScoreGroup("evSkillScore", init.skill_score)}
            <textarea id="evSkillComment" class="ev-textarea" maxlength="${EV_COMMENT_MAX}" placeholder="Nhận xét ngắn (không bắt buộc)"></textarea>
          </div>

          <div class="ev-section ev-section-line">
            <div class="ev-label">2. Thái độ và trách nhiệm</div>
            <div class="ev-sub">Đánh giá tinh thần học hỏi, chủ động và trách nhiệm.</div>
            ${evScoreGroup("evAttitudeScore", init.attitude_score)}
            <textarea id="evAttitudeComment" class="ev-textarea" maxlength="${EV_COMMENT_MAX}" placeholder="Nhận xét ngắn (không bắt buộc)"></textarea>
          </div>

          <div class="ev-avg">
            <div class="ev-sub">Điểm trung bình</div>
            <div id="evOverall" class="ev-avg-value"></div>
          </div>

          <div class="ev-section">
            <label class="ev-label" for="evOverallComment">Nhận xét tổng kết <span style="color:#b91c1c">*</span></label>
            <textarea id="evOverallComment" class="ev-textarea ev-textarea-lg" maxlength="${EV_COMMENT_MAX}" placeholder="Tóm tắt kết quả, điểm mạnh và điều cần cải thiện..." oninput="updateEvaluationCounter()"></textarea>
            <div id="evCounter" class="ev-sub" style="text-align:right"></div>
          </div>

          <div id="evError" class="modal-error"></div>
          <div class="ev-actions">
            ${
              ev
                ? `<button id="evDeleteBtn" class="ev-btn ev-btn-outline" type="button" onclick="deleteMentorEvaluation()">Xóa đánh giá</button>`
                : `<button id="evDraftBtn" class="ev-btn ev-btn-outline" type="button" onclick="saveEvaluationDraft()">Lưu nháp</button>`
            }
            <button id="evSaveBtn" class="ev-btn ev-btn-dark" type="button" onclick="saveMentorEvaluation()">${ev ? "Cập nhật đánh giá" : "Gửi đánh giá"}</button>
          </div>`;
  // Gán qua .value để nội dung người dùng không bao giờ được diễn giải như HTML.
  document.getElementById("evSkillComment").value = init.skill_comment || "";
  document.getElementById("evAttitudeComment").value =
    init.attitude_comment || "";
  document.getElementById("evOverallComment").value =
    init.overall_comment || "";
  updateEvaluationOverall();
  updateEvaluationCounter();
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Lưu nháp: chỉ giữ trên trình duyệt này, không cần điền đủ.
function saveEvaluationDraft() {
  if (!evCurrentInternId) return;
  const errEl = document.getElementById("evError");
  const draft = {
    skill_score: evSelectedScore("evSkillScore"),
    skill_comment: document.getElementById("evSkillComment").value,
    attitude_score: evSelectedScore("evAttitudeScore"),
    attitude_comment: document.getElementById("evAttitudeComment").value,
    overall_comment: document.getElementById("evOverallComment").value,
    saved_at: new Date().toISOString(),
  };
  try {
    localStorage.setItem(evDraftKey(evCurrentInternId), JSON.stringify(draft));
    errEl.textContent = "";
    showToast("Đã lưu nháp (chưa gửi đánh giá).", "success");
  } catch (err) {
    errEl.textContent = "Không thể lưu nháp trên trình duyệt này!";
  }
}

function closeMentorEvaluation() {
  document.getElementById("evDetail").style.display = "none";
  evCurrentInternId = null;
}

function evSelectedScore(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? Number(el.value) : null;
}

// Điểm tổng (xem trước) = trung bình kỹ năng và thái độ; server mới là nơi tính chính thức.
function updateEvaluationOverall() {
  const el = document.getElementById("evOverall");
  if (!el) return;
  const skill = evSelectedScore("evSkillScore");
  const attitude = evSelectedScore("evAttitudeScore");
  el.textContent =
    skill && attitude
      ? `${Math.round(((skill + attitude) / 2) * 10) / 10}/5`
      : "Chưa đủ điểm";
}

function updateEvaluationCounter() {
  const input = document.getElementById("evOverallComment");
  const counter = document.getElementById("evCounter");
  if (!input || !counter) return;
  counter.textContent = `${input.value.trim().length}/${EV_COMMENT_MAX} ký tự`;
}

function setEvaluationBusy(busy) {
  for (const id of [
    "evSaveBtn",
    "evDraftBtn",
    "evDeleteBtn",
    "evCloseBtn",
    "evSkillComment",
    "evAttitudeComment",
    "evOverallComment",
  ]) {
    const el = document.getElementById(id);
    if (el) el.disabled = busy;
  }
  document
    .querySelectorAll('#evDetail input[type="radio"]')
    .forEach((el) => (el.disabled = busy));
}

// Cập nhật dòng của thực tập sinh trong bộ nhớ rồi vẽ lại bảng (không tải lại cả trang).
function applyEvaluationResult(internId, ev) {
  if (!evOverview) return;
  const row = evOverview.interns.find(
    (i) => Number(i.intern_id) === Number(internId),
  );
  if (row) {
    row.has_evaluation = Boolean(ev);
    row.skill_score = ev ? ev.skill_score : null;
    row.attitude_score = ev ? ev.attitude_score : null;
    row.overall_score = ev ? ev.overall_score : null;
    row.updated_at = ev ? ev.updated_at : null;
  }
  const evaluated = evOverview.interns.filter((i) => i.has_evaluation).length;
  evOverview.summary.evaluated = evaluated;
  evOverview.summary.pending = evOverview.interns.length - evaluated;
  renderMentorEvaluationTable();
}

async function saveMentorEvaluation() {
  const errEl = document.getElementById("evError");
  const skillScore = evSelectedScore("evSkillScore");
  const attitudeScore = evSelectedScore("evAttitudeScore");
  const skillComment = document.getElementById("evSkillComment").value;
  const attitudeComment = document.getElementById("evAttitudeComment").value;
  const overallComment = document.getElementById("evOverallComment").value;

  if (!skillScore) {
    errEl.textContent = "Vui lòng chấm điểm kỹ năng!";
    return;
  }
  if (!attitudeScore) {
    errEl.textContent = "Vui lòng chấm điểm thái độ!";
    return;
  }
  if (!overallComment.trim()) {
    errEl.textContent = "Vui lòng nhập nhận xét tổng kết!";
    return;
  }
  for (const [label, text] of [
    ["Nhận xét kỹ năng", skillComment],
    ["Nhận xét thái độ", attitudeComment],
    ["Nhận xét tổng kết", overallComment],
  ]) {
    if (text.trim().length > EV_COMMENT_MAX) {
      errEl.textContent = `${label} không được vượt quá ${EV_COMMENT_MAX} ký tự!`;
      return;
    }
  }
  errEl.textContent = "";
  const internId = evCurrentInternId;
  setEvaluationBusy(true);
  try {
    const r = await wrRequest(`/interns/${Number(internId)}/evaluation`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skill_score: skillScore,
        skill_comment: skillComment,
        attitude_score: attitudeScore,
        attitude_comment: attitudeComment,
        overall_comment: overallComment,
      }),
    });
    if (!r) return;
    if (!r.res.ok || !r.body.success) {
      errEl.textContent = wrApiError(r, "Không thể lưu đánh giá.");
      return;
    }
    showToast(r.body.message || "Đã lưu đánh giá!", "success");
    evClearDraft(internId);
    applyEvaluationResult(internId, r.body.data);
    await openMentorEvaluation(internId);
  } catch (err) {
    errEl.textContent = "Lỗi kết nối server!";
  } finally {
    setEvaluationBusy(false);
  }
}

async function deleteMentorEvaluation() {
  if (!confirm("Bạn có chắc chắn muốn xóa đánh giá này không?")) return;
  const errEl = document.getElementById("evError");
  errEl.textContent = "";
  const internId = evCurrentInternId;
  setEvaluationBusy(true);
  try {
    const r = await wrRequest(`/interns/${Number(internId)}/evaluation`, {
      method: "DELETE",
    });
    if (!r) return;
    if (!r.res.ok || !r.body.success) {
      errEl.textContent = wrApiError(r, "Không thể xóa đánh giá.");
      return;
    }
    showToast(r.body.message || "Đã xóa đánh giá!", "success");
    applyEvaluationResult(internId, null);
    await openMentorEvaluation(internId);
  } catch (err) {
    errEl.textContent = "Lỗi kết nối server!";
  } finally {
    setEvaluationBusy(false);
  }
}
