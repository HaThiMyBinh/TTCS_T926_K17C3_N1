function crElement(tag, text, className) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = String(text);
  if (className) el.className = className;
  return el;
}
function crReadFilters() {
  const params = new URLSearchParams();
  for (const [key, id] of [
    ["programId", "crProgram"],
    ["programStatus", "crProgramStatus"],
    ["status", "crStatus"],
    ["from", "crFrom"],
    ["to", "crTo"],
    ["q", "crQ"],
  ]) {
    const value = document.getElementById(id).value.trim();
    if (value) params.set(key, value);
  }
  return params;
}
function crTable(headers, rows) {
  const wrapper = crElement("div", null, "table-container");
  wrapper.style.overflowX = "auto";
  const table = document.createElement("table");
  const tr = document.createElement("tr");
  headers.forEach((text) => tr.append(crElement("th", text)));
  const head = document.createElement("thead");
  head.append(tr);
  const body = document.createElement("tbody");
  rows.forEach((cells) => {
    const row = document.createElement("tr");
    cells.forEach((value) => {
      const cell = document.createElement("td");
      if (value instanceof Node) cell.append(value);
      else
        cell.innerHTML = escapeHtml(
          value == null || value === "" ? "Chưa cập nhật" : String(value),
        );
      row.append(cell);
    });
    body.append(row);
  });
  table.append(head, body);
  wrapper.append(table);
  return wrapper;
}
function renderCompletionRate(data) {
  const summary = document.getElementById("crSummary");
  summary.replaceChildren();
  const s = data.summary;
  const cards = crElement("div", null, "stats-grid");
  cards.style.marginTop = "20px";
  for (const [label, value] of [
    ["Tổng lượt tham gia", s.total],
    ["Đã hoàn thành", s.completed],
    ["Đang thực tập", s.active],
    ["Tạm dừng / không hoàn thành", s.notCompleted],
    ["Tỷ lệ chung", `${Number(s.rate).toFixed(1)}%`],
  ]) {
    const card = crElement("div", null, "stat-card");
    const info = crElement("div", null, "info");
    info.append(crElement("p", label), crElement("h3", value));
    card.append(info);
    cards.append(card);
  }
  summary.append(cards);
  if (s.pendingReview)
    summary.append(
      crElement(
        "p",
        `${s.pendingReview} lượt chưa cập nhật kết quả.`,
        "text-muted",
      ),
    );
  if (s.unknownStatus)
    summary.append(
      crElement(
        "p",
        `${s.unknownStatus} lượt cần kiểm tra trạng thái kết quả.`,
        "text-muted",
      ),
    );
  if (!s.total)
    summary.append(
      crElement("p", "Không có thực tập sinh trong phạm vi lọc.", "text-muted"),
    );
  for (const [dimension, id, groups] of [
    ["program", "crPrograms", data.byProgram],
    ["mentor", "crMentors", data.byMentor],
  ]) {
    const host = document.getElementById(id);
    host.replaceChildren();
    if (!groups.length) {
      host.append(crElement("p", "Không có dữ liệu phù hợp.", "text-muted"));
      continue;
    }
    const rows = groups.map((group) => {
      const button = crElement(
        "button",
        `${group.name} — ${Number(group.rate).toFixed(1)}%${group.programStatus ? ` (${group.programStatus})` : ""}`,
        "btn btn-light cr-group",
      );
      button.type = "button";
      button.dataset.dimension = dimension;
      button.dataset.key = group.key;
      button.dataset.name = group.name;
      const progress = crElement("div", null, "task-progress-bar");
      progress.setAttribute("role", "progressbar");
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", "100");
      progress.setAttribute("aria-valuenow", String(group.rate));
      progress.setAttribute(
        "aria-label",
        `${group.name}: ${group.completed}/${group.total} (${group.rate}%)`,
      );
      const bar = document.createElement("span");
      bar.style.width = `${Math.min(100, Math.max(0, Number(group.rate)))}%`;
      bar.style.background = "var(--primary)";
      progress.append(bar);
      const label = document.createElement("div");
      label.append(button, progress);
      return [
        label,
        group.total,
        group.completed,
        group.active,
        group.notCompleted,
      ];
    });
    host.append(
      crTable(
        [
          "Nhóm / tỷ lệ (bấm xem hồ sơ)",
          "Tổng",
          "Đã hoàn thành",
          "Đang thực tập",
          "Tạm dừng / không hoàn thành",
        ],
        rows,
      ),
    );
  }
}
async function loadCompletionRate() {
  const request = ++crReportRequest;
  closeCompletionRateModal();
  crAppliedFilters = null;
  const exportButton = document.getElementById("crExport");
  exportButton.disabled = true;
  document.getElementById("crError").textContent = "";
  document.getElementById("crSummary").textContent = "Đang tải báo cáo...";
  document.getElementById("crPrograms").replaceChildren();
  document.getElementById("crMentors").replaceChildren();
  const params = crReadFilters();
  try {
    const result = await wrRequest(`/reports/completion-rate?${params}`);
    if (request !== crReportRequest || !result) return;
    if (!result.res.ok)
      throw new Error(wrApiError(result, "Không thể tải báo cáo."));
    crAppliedFilters = new URLSearchParams(params);
    const select = document.getElementById("crProgram");
    const selected = params.get("programId") || "";
    select.replaceChildren(new Option("Tất cả chương trình", ""));
    for (const program of result.body.data.programs)
      select.add(
        new Option(program.name || "Chưa cập nhật", String(program.id)),
      );
    // Keep a manually requested/missing ID selected so filters cannot silently reset.
    if (
      selected &&
      !Array.from(select.options).some((option) => option.value === selected)
    )
      select.add(new Option(`Chương trình #${selected}`, selected));
    select.value = selected;
    renderCompletionRate(result.body.data);
    exportButton.disabled = false;
  } catch (err) {
    if (request !== crReportRequest) return;
    document.getElementById("crSummary").textContent =
      "Không tải được dữ liệu.";
    document.getElementById("crError").textContent = err.message;
  }
}
function closeCompletionRateModal() {
  ++crDetailRequest;
  document.getElementById("crModal").style.display = "none";
  if (crReturnFocus?.isConnected) crReturnFocus.focus();
  crReturnFocus = null;
}
async function openCompletionRateGroup(dimension, key, name, page = 1) {
  if (!crAppliedFilters) return;
  const request = ++crDetailRequest;
  const modal = document.getElementById("crModal");
  if (modal.style.display !== "flex") crReturnFocus = document.activeElement;
  modal.style.display = "flex";
  document.getElementById("crClose").focus();
  document.getElementById("crModalTitle").textContent = `Danh sách: ${name}`;
  const details = document.getElementById("crDetails");
  details.textContent = "Đang tải danh sách...";
  const pages = document.getElementById("crPages");
  pages.replaceChildren();
  const params = new URLSearchParams(crAppliedFilters);
  params.set("groupBy", dimension);
  params.set("groupKey", key);
  params.set("page", String(page));
  params.set("pageSize", "15");
  try {
    const result = await wrRequest(
      `/reports/completion-rate/interns?${params}`,
    );
    if (request !== crDetailRequest || !result) return;
    if (!result.res.ok)
      throw new Error(wrApiError(result, "Không thể tải danh sách."));
    const { items, pagination, summary } = result.body.data;
    details.replaceChildren();
    details.append(
      crElement(
        "p",
        `Tổng ${pagination.total} lượt tham gia; đã hoàn thành ${summary.completed}; tỷ lệ ${Number(summary.rate).toFixed(1)}%.`,
      ),
    );
    if (!items.length)
      details.append(
        crElement("p", "Không có hồ sơ trong nhóm/trang này.", "text-muted"),
      );
    else
      details.append(
        crTable(
          [
            "Họ tên",
            "MSSV",
            "Chương trình",
            "Thời gian chương trình",
            "Trường",
            "Mentor",
            "Kết quả",
            "Ngày hoàn thành",
            "HR xác nhận (mã)",
            "Ghi chú",
          ],
          items.map((item) => [
            item.fullName,
            item.studentCode,
            item.programName,
            `${item.programStart || "?"} – ${item.programEnd || "?"}`,
            item.university,
            item.mentorName,
            item.status,
            item.completedAt,
            item.completedBy,
            item.completionNote,
          ]),
        ),
      );
    const previous = crElement("button", "Trước", "btn btn-secondary");
    previous.type = "button";
    previous.disabled = pagination.page <= 1;
    const next = crElement("button", "Sau", "btn btn-secondary");
    next.type = "button";
    next.disabled = pagination.page >= pagination.totalPages;
    previous.addEventListener("click", () =>
      openCompletionRateGroup(dimension, key, name, pagination.page - 1),
    );
    next.addEventListener("click", () =>
      openCompletionRateGroup(dimension, key, name, pagination.page + 1),
    );
    pages.append(
      previous,
      crElement("span", `Trang ${pagination.page}/${pagination.totalPages}`),
      next,
    );
  } catch (err) {
    if (request === crDetailRequest) details.textContent = err.message;
  }
}
async function downloadCompletionRateCsv() {
  return exportReport(
    "completion",
    "csv",
    document.activeElement?.tagName === "BUTTON"
      ? document.activeElement
      : null,
  );
}
