function debounceInternOriginSearch() {
  clearTimeout(iorSearchTimer);
  iorSearchTimer = setTimeout(() => {
    loadInternOriginReport();
  }, 300);
}

function updateInternOriginView() {
  if (!internOriginData) return;
  const groupBy = document.getElementById("iorGroupBy").value;
  const uniChart = document.getElementById("iorUniChartCard");
  const majorChart = document.getElementById("iorMajorChartCard");
  const uniTable = document.getElementById("iorUniTableCard");
  const majorTable = document.getElementById("iorMajorTableCard");
  const matrixCard = document.getElementById("iorMatrixCard");

  if (groupBy === "university") {
    uniChart.style.display = "";
    uniTable.style.display = "";
    majorChart.style.display = "none";
    majorTable.style.display = "none";
    matrixCard.style.display = "none";
  } else if (groupBy === "major") {
    uniChart.style.display = "none";
    uniTable.style.display = "none";
    majorChart.style.display = "";
    majorTable.style.display = "";
    matrixCard.style.display = "none";
  } else {
    uniChart.style.display = "";
    uniTable.style.display = "";
    majorChart.style.display = "";
    majorTable.style.display = "";
    matrixCard.style.display = "";
  }
}

async function loadInternOriginReport() {
  const errorEl = document.getElementById("iorError");
  errorEl.textContent = "";

  const status = document.getElementById("iorStatus").value;
  const from = document.getElementById("iorFrom").value;
  const to = document.getElementById("iorTo").value;
  const q = document.getElementById("iorQ").value.trim();
  const groupBy = document.getElementById("iorGroupBy").value;

  if (from && to && from > to) {
    errorEl.textContent = "Ngày bắt đầu không được sau ngày kết thúc!";
    return;
  }

  const params = new URLSearchParams();
  if (status) params.append("status", status);
  if (from) params.append("from", from);
  if (to) params.append("to", to);
  if (q) params.append("q", q);
  params.append("groupBy", groupBy);

  const viewBtn = document.getElementById("iorViewButton");
  viewBtn.disabled = true;
  document.getElementById("iorSummary").innerHTML =
    "<div class='text-muted' style='padding:12px;'>Đang tải dữ liệu thống kê...</div>";

  try {
    const result = await wrRequest(
      `/reports/interns-by-origin?${params.toString()}`,
    );
    if (!result) return;
    if (!result.res.ok) {
      errorEl.textContent = wrApiError(
        result,
        "Không thể tải báo cáo thống kê.",
      );
      document.getElementById("iorSummary").innerHTML = "";
      return;
    }
    internOriginData = result.body.data;
    renderInternOriginSummary(internOriginData);
    renderInternOriginCharts(internOriginData);
    renderInternOriginTables(internOriginData);
    renderInternOriginMatrix(internOriginData);
    renderInternOriginFunnel(internOriginData);
    updateInternOriginView();
  } catch (err) {
    errorEl.textContent = "Lỗi kết nối khi tải thống kê: " + err.message;
  } finally {
    viewBtn.disabled = false;
  }
}

function renderInternOriginSummary(data) {
  const uniCount = data.byUniversity.filter((u) => u.name !== "Khác").length;
  const majorCount = data.byMajor.filter((m) => m.name !== "Khác").length;

  document.getElementById("iorSummary").innerHTML = `
          <div class="stat-card">
            <div class="info">
              <p>Tổng thực tập sinh</p>
              <h3>${data.total}</h3>
            </div>
            <div class="icon-wrap bg-blue-light"><i class="fa-solid fa-users"></i></div>
          </div>
          <div class="stat-card">
            <div class="info">
              <p>Số trường đào tạo</p>
              <h3>${uniCount}</h3>
            </div>
            <div class="icon-wrap bg-indigo-light"><i class="fa-solid fa-building-columns"></i></div>
          </div>
          <div class="stat-card">
            <div class="info">
              <p>Số chuyên ngành</p>
              <h3>${majorCount}</h3>
            </div>
            <div class="icon-wrap" style="background:#fef3c7; color:#d97706;"><i class="fa-solid fa-book-open"></i></div>
          </div>
          <div class="stat-card">
            <div class="info">
              <p>Chưa cập nhật trường/ngành</p>
              <h3>${data.unknown}</h3>
            </div>
            <div class="icon-wrap" style="background:#fee2e2; color:#dc2626;"><i class="fa-solid fa-circle-question"></i></div>
          </div>
        `;
}

// Nhóm tổng hợp "Khác" không có danh sách thành viên tương ứng nên không cho bấm xem chi tiết.
function iorIsClickable(university, major) {
  return university !== "Khác" && major !== "Khác";
}
function iorTriggerAttrs(university, major, title) {
  if (!iorIsClickable(university, major))
    return 'title="Nhóm tổng hợp nhiều trường/ngành nhỏ, không có danh sách chi tiết"';
  return `class="ior-detail-trigger" data-ior-university="${escapeHtml(university)}" data-ior-major="${escapeHtml(major)}" title="${escapeHtml(title)}"`;
}

function renderInternOriginCharts(data) {
  // Biểu đồ Top trường
  const uniBody = document.getElementById("iorUniChartBody");
  if (data.byUniversity.length === 0) {
    uniBody.innerHTML =
      "<div class='text-muted' style='padding:12px;'>Không có dữ liệu trường phù hợp.</div>";
  } else {
    uniBody.innerHTML = data.byUniversity
      .map((item) => {
        const isUnk = item.name === "Chưa cập nhật";
        const barColor = isUnk ? "#94a3b8" : "var(--primary)";
        return `
              <div style="margin-bottom: 12px;${iorIsClickable(item.name, "") ? " cursor: pointer;" : ""}" ${iorTriggerAttrs(item.name, "", "Bấm để xem danh sách thực tập sinh nhóm " + item.name)}>
                <div style="display: flex; justify-content: space-between; font-size: 14.5px; font-weight: 600; margin-bottom: 4px;">
                  <span style="color: ${isUnk ? "#64748b" : "var(--slate-800)"};">${escapeHtml(item.name)}</span>
                  <span style="color: var(--slate-600);">${item.count} hồ sơ (${item.percent}%)</span>
                </div>
                <div class="task-progress-bar" role="progressbar" aria-valuenow="${item.percent}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHtml(item.name)}: ${item.count} thực tập sinh (${item.percent}%)" style="height: 10px;">
                  <span style="width: ${Math.min(100, item.percent)}%; background: ${barColor};"></span>
                </div>
              </div>
            `;
      })
      .join("");
  }

  // Biểu đồ Top ngành
  const majorBody = document.getElementById("iorMajorChartBody");
  if (data.byMajor.length === 0) {
    majorBody.innerHTML =
      "<div class='text-muted' style='padding:12px;'>Không có dữ liệu ngành phù hợp.</div>";
  } else {
    majorBody.innerHTML = data.byMajor
      .map((item) => {
        const isUnk = item.name === "Chưa cập nhật";
        const barColor = isUnk ? "#94a3b8" : "#0d9488";
        return `
              <div style="margin-bottom: 12px;${iorIsClickable("", item.name) ? " cursor: pointer;" : ""}" ${iorTriggerAttrs("", item.name, "Bấm để xem danh sách thực tập sinh nhóm " + item.name)}>
                <div style="display: flex; justify-content: space-between; font-size: 14.5px; font-weight: 600; margin-bottom: 4px;">
                  <span style="color: ${isUnk ? "#64748b" : "var(--slate-800)"};">${escapeHtml(item.name)}</span>
                  <span style="color: var(--slate-600);">${item.count} hồ sơ (${item.percent}%)</span>
                </div>
                <div class="task-progress-bar" role="progressbar" aria-valuenow="${item.percent}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHtml(item.name)}: ${item.count} thực tập sinh (${item.percent}%)" style="height: 10px;">
                  <span style="width: ${Math.min(100, item.percent)}%; background: ${barColor};"></span>
                </div>
              </div>
            `;
      })
      .join("");
  }
}

function renderInternOriginTables(data) {
  // Bảng trường
  const uniTableBody = document.getElementById("iorUniTableBody");
  if (data.byUniversity.length === 0) {
    uniTableBody.innerHTML = "<div class='text-muted'>Không có dữ liệu.</div>";
  } else {
    const rows = data.byUniversity
      .map(
        (item, idx) => `
            <tr${iorIsClickable(item.name, "") ? ' style="cursor: pointer;"' : ""} ${iorTriggerAttrs(item.name, "", "Bấm để xem danh sách chi tiết")}>
              <td>${idx + 1}</td>
              <td style="font-weight: 600;">${escapeHtml(item.name)}</td>
              <td>${item.count}</td>
              <td><span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700;">${item.percent}%</span></td>
              <td>${iorIsClickable(item.name, "") ? `<button class="btn btn-sm btn-light ior-detail-trigger" data-ior-university="${escapeHtml(item.name)}" data-ior-major=""><i class="fa-solid fa-list-ul"></i> Xem hồ sơ</button>` : `<span class="text-muted">—</span>`}</td>
            </tr>
          `,
      )
      .join("");
    uniTableBody.innerHTML = `
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th style="width: 50px;">STT</th>
                    <th>Tên trường</th>
                    <th style="width: 120px;">Số lượng</th>
                    <th style="width: 120px;">Tỷ lệ (%)</th>
                    <th style="width: 140px;">Hành động</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          `;
  }

  // Bảng ngành
  const majorTableBody = document.getElementById("iorMajorTableBody");
  if (data.byMajor.length === 0) {
    majorTableBody.innerHTML =
      "<div class='text-muted'>Không có dữ liệu.</div>";
  } else {
    const rows = data.byMajor
      .map(
        (item, idx) => `
            <tr${iorIsClickable("", item.name) ? ' style="cursor: pointer;"' : ""} ${iorTriggerAttrs("", item.name, "Bấm để xem danh sách chi tiết")}>
              <td>${idx + 1}</td>
              <td style="font-weight: 600;">${escapeHtml(item.name)}</td>
              <td>${item.count}</td>
              <td><span class="badge" style="background:#ccfbf1; color:#0f766e; font-weight:700;">${item.percent}%</span></td>
              <td>${iorIsClickable("", item.name) ? `<button class="btn btn-sm btn-light ior-detail-trigger" data-ior-university="" data-ior-major="${escapeHtml(item.name)}"><i class="fa-solid fa-list-ul"></i> Xem hồ sơ</button>` : `<span class="text-muted">—</span>`}</td>
            </tr>
          `,
      )
      .join("");
    majorTableBody.innerHTML = `
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th style="width: 50px;">STT</th>
                    <th>Tên chuyên ngành</th>
                    <th style="width: 120px;">Số lượng</th>
                    <th style="width: 120px;">Tỷ lệ (%)</th>
                    <th style="width: 140px;">Hành động</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          `;
  }
}

function renderInternOriginMatrix(data) {
  const matrixBody = document.getElementById("iorMatrixBody");
  const m = data.matrix;
  if (!m || m.universities.length === 0 || m.majors.length === 0) {
    matrixBody.innerHTML =
      "<div class='text-muted'>Không có dữ liệu ma trận.</div>";
    return;
  }

  const headCols = m.majors.map((mj) => `<th>${escapeHtml(mj)}</th>`).join("");
  const bodyRows = m.universities
    .map((uni) => {
      const cells = m.majors
        .map((mj) => {
          const count = m.data[uni]?.[mj] || 0;
          if (count > 0 && iorIsClickable(uni, mj)) {
            return `<td style="cursor: pointer; font-weight: 600; color: var(--primary);" class="ior-detail-trigger" data-ior-university="${escapeHtml(uni)}" data-ior-major="${escapeHtml(mj)}" title="Xem ${count} thực tập sinh trường ${escapeHtml(uni)}, ngành ${escapeHtml(mj)}">${count}</td>`;
          }
          return `<td style="color: ${count > 0 ? "#334155" : "#94a3b8"};">${count}</td>`;
        })
        .join("");
      const rowTotal = m.totals.byUniversity[uni] || 0;
      return `
            <tr>
              <td style="font-weight: 600; position: sticky; left: 0; background: #fff;">${escapeHtml(uni)}</td>
              ${cells}
              <td style="font-weight: 700; background: #f8fafc;">${rowTotal}</td>
            </tr>
          `;
    })
    .join("");

  const footerCells = m.majors
    .map((mj) => {
      const colTotal = m.totals.byMajor[mj] || 0;
      return `<td style="font-weight: 700;">${colTotal}</td>`;
    })
    .join("");

  matrixBody.innerHTML = `
          <div class="table-container" style="overflow-x: auto; max-width: 100%;">
            <table style="min-width: max-content;">
              <thead>
                <tr>
                  <th style="position: sticky; left: 0; background: #f8fafc; z-index: 2;">Trường / Ngành</th>
                  ${headCols}
                  <th style="background: #f1f5f9;">Tổng cộng</th>
                </tr>
              </thead>
              <tbody>${bodyRows}</tbody>
              <tfoot>
                <tr style="background: #f8fafc;">
                  <td style="font-weight: 700; position: sticky; left: 0; background: #f8fafc;">Tổng cộng</td>
                  ${footerCells}
                  <td style="font-weight: 800; color: #0f172a; background: #e2e8f0;">${m.totals.grandTotal}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        `;
}

function renderInternOriginFunnel(data) {
  const funnelBody = document.getElementById("iorFunnelBody");
  if (!data.funnel || data.funnel.length === 0) {
    funnelBody.innerHTML =
      "<div class='text-muted'>Không có dữ liệu hồ sơ ứng tuyển từ các trường.</div>";
    return;
  }

  const rows = data.funnel
    .map(
      (f, i) => `
          <tr>
            <td>${i + 1}</td>
            <td style="font-weight: 600;">${escapeHtml(f.name)}</td>
            <td style="font-weight: 700;">${f.applied}</td>
            <td><span class="badge" style="background:#dcfce7; color:#15803d; font-weight:600;">${f.approved}</span></td>
            <td><span class="badge" style="background:#fee2e2; color:#b91c1c; font-weight:600;">${f.rejected}</span></td>
            <td><span class="badge" style="background:#fef3c7; color:#b45309; font-weight:600;">${f.pending}</span></td>
            <td><span class="badge" style="background:#e0e7ff; color:#4338ca; font-weight:700;">${f.approvalRate}%</span></td>
          </tr>
        `,
    )
    .join("");

  funnelBody.innerHTML = `
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th style="width: 50px;">STT</th>
                  <th>Tên trường</th>
                  <th>Hồ sơ nộp</th>
                  <th>Đã duyệt</th>
                  <th>Từ chối</th>
                  <th>Chờ duyệt</th>
                  <th>Tỷ lệ duyệt</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        `;
}

async function downloadInternOriginCsv() {
  return exportReport(
    "origin",
    "csv",
    document.activeElement?.tagName === "BUTTON"
      ? document.activeElement
      : null,
  );
}

async function openInternOriginDetailModal(university, major, page = 1) {
  iorModalState = { university, major, page };
  const modal = document.getElementById("iorDetailModal");
  const titleEl = document.getElementById("iorModalTitle");
  const contentEl = document.getElementById("iorModalContent");
  const paginationEl = document.getElementById("iorModalPagination");

  let titleParts = [];
  if (university) titleParts.push(`Trường: ${university}`);
  if (major) titleParts.push(`Ngành: ${major}`);
  titleEl.textContent = `Danh sách thực tập sinh (${titleParts.join(" | ") || "Tất cả"})`;

  modal.style.display = "flex";
  contentEl.innerHTML =
    "<div class='text-muted' style='padding:16px;'>Đang tải danh sách thực tập sinh...</div>";
  paginationEl.innerHTML = "";

  const status = document.getElementById("iorStatus").value;
  const from = document.getElementById("iorFrom").value;
  const to = document.getElementById("iorTo").value;
  const q = document.getElementById("iorQ").value.trim();

  const params = new URLSearchParams();
  if (university) params.append("university", university);
  if (major) params.append("major", major);
  if (status) params.append("status", status);
  if (from) params.append("from", from);
  if (to) params.append("to", to);
  if (q) params.append("q", q);
  params.append("page", String(page));
  params.append("pageSize", "15");

  const result = await wrRequest(
    `/reports/interns-by-origin/interns?${params.toString()}`,
  );
  if (!result) return;
  if (!result.res.ok) {
    contentEl.innerHTML = `<div class='text-danger' style='padding:16px;'>${escapeHtml(wrApiError(result, "Không thể tải danh sách."))}</div>`;
    return;
  }

  const { items, pagination } = result.body.data;
  if (!items || items.length === 0) {
    contentEl.innerHTML =
      "<div class='text-muted' style='padding:16px;'>Không có thực tập sinh nào thuộc nhóm này.</div>";
    return;
  }

  const rows = items
    .map(
      (it) => `
          <tr>
            <td><strong>${escapeHtml(it.fullName)}</strong></td>
            <td><code>${escapeHtml(it.studentCode || "—")}</code></td>
            <td>${escapeHtml(it.university || "Chưa cập nhật")}</td>
            <td>${escapeHtml(it.major || "Chưa cập nhật")}</td>
            <td><span class="badge" style="background:#e2e8f0; color:#334155;">${escapeHtml(it.status || "—")}</span></td>
            <td>${escapeHtml(it.mentorName || "Chưa phân công")}</td>
          </tr>
        `,
    )
    .join("");

  contentEl.innerHTML = `
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Họ tên</th>
                  <th>Mã SV</th>
                  <th>Trường</th>
                  <th>Ngành</th>
                  <th>Trạng thái</th>
                  <th>Mentor</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        `;

  const prevDisabled = pagination.page <= 1 ? "disabled" : "";
  const nextDisabled =
    pagination.page >= pagination.totalPages ? "disabled" : "";
  paginationEl.innerHTML = `
          <div style="font-size: 14.5px; color: var(--slate-600);">
            Trang <strong>${pagination.page}</strong> / <strong>${pagination.totalPages}</strong> (Tổng cộng <strong>${pagination.total}</strong> hồ sơ)
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-sm btn-secondary ior-detail-trigger" ${prevDisabled} data-ior-university="${escapeHtml(university)}" data-ior-major="${escapeHtml(major)}" data-ior-page="${pagination.page - 1}"><i class="fa-solid fa-chevron-left"></i> Trước</button>
            <button class="btn btn-sm btn-secondary ior-detail-trigger" ${nextDisabled} data-ior-university="${escapeHtml(university)}" data-ior-major="${escapeHtml(major)}" data-ior-page="${pagination.page + 1}">Sau <i class="fa-solid fa-chevron-right"></i></button>
          </div>
        `;
}

function closeInternOriginModal() {
  document.getElementById("iorDetailModal").style.display = "none";
}
