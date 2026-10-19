function formatVnd(value) {
  return `${Number(value || 0).toLocaleString("vi-VN")} đ`;
}

async function loadAllowanceUniversityOptions() {
  if (allowanceUniversitiesLoaded) return;
  const select = document.getElementById("allowanceUniversityFilter");
  try {
    const res = await fetch(`${API_BASE}/interns/filter-options`, {
      headers: authHeaders(),
    });
    if (!res.ok) return;
    const options = await res.json();
    const selected = select.value;
    select.innerHTML =
      `<option value="">Tất cả</option>` +
      (options.universities || [])
        .map(
          (u) => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`,
        )
        .join("");
    select.value = selected;
    allowanceUniversitiesLoaded = true;
  } catch (err) {
    /* bộ lọc trường là tùy chọn, bỏ qua lỗi */
  }
}

function scheduleAllowanceSearch() {
  clearTimeout(allowanceSearchTimer);
  allowanceSearchTimer = setTimeout(loadAllowanceOverview, 300);
}

async function loadAllowanceOverview() {
  const body = document.getElementById("allowanceOverviewBody");
  const requestId = ++allowanceOverviewRequest;
  loadAllowanceUniversityOptions();
  const params = new URLSearchParams();
  const q = document.getElementById("allowanceSearch").value.trim();
  const university = document.getElementById("allowanceUniversityFilter").value;
  if (q) params.set("q", q);
  if (university) params.set("university", university);
  try {
    const res = await fetch(
      `${API_BASE}/allowances/overview${params.toString() ? `?${params}` : ""}`,
      { headers: authHeaders() },
    );
    if (!res.ok) {
      throw new Error(
        await readErrorMessage(res, "Không tải được danh sách phụ cấp!"),
      );
    }
    const payload = await res.json();
    if (requestId !== allowanceOverviewRequest) return; // đã có yêu cầu mới hơn
    renderAllowanceOverview(payload.data);
  } catch (err) {
    if (requestId !== allowanceOverviewRequest) return;
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#b91c1c;padding:24px">${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderAllowanceOverview(data) {
  const body = document.getElementById("allowanceOverviewBody");
  const { items, summary } = data;
  document.getElementById("allowanceOverviewSummary").innerHTML =
    `<span>Thực tập sinh: <b>${summary.internCount}</b></span>` +
    `<span>Đang có phụ cấp: <b>${summary.withAllowance}</b></span>` +
    `<span>Tổng phụ cấp theo tháng: <b>${formatVnd(summary.totalMonthly)}</b></span>`;
  if (!items.length) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:24px">Không có thực tập sinh phù hợp.</td></tr>`;
    return;
  }
  body.innerHTML = items
    .map((i) => {
      const noContract = !i.hasConfirmedContract;
      return `<tr>
              <td><b>${escapeHtml(i.fullName)}</b><br /><span style="color:#64748b;font-size:13px">${escapeHtml(i.email)}</span></td>
              <td>${escapeHtml(i.studentCode || "—")}</td>
              <td>${escapeHtml(i.university || "—")}</td>
              <td style="text-align:center">${i.activeCount}${i.totalCount > i.activeCount ? ` <span style="color:#94a3b8;font-size:13px">/ ${i.totalCount}</span>` : ""}</td>
              <td style="text-align:right" class="allowance-amount">${i.totalMonthly ? formatVnd(i.totalMonthly) : "—"}</td>
              <td style="text-align:center">
                <button class="btn btn-sm btn-primary" type="button"
                  data-name="${escapeHtml(i.fullName)}"
                  ${noContract ? 'disabled title="Cần có hợp đồng đã xác nhận mới nhập được phụ cấp"' : ""}
                  onclick="openAllowances(${Number(i.id)}, this.dataset.name)">
                  <i class="fa-solid fa-hand-holding-dollar"></i> Quản lý
                </button>
                ${noContract ? '<br /><span class="badge badge-pending" style="margin-top:4px">Chưa có HĐ xác nhận</span>' : ""}
              </td>
            </tr>`;
    })
    .join("");
}

function openAllowances(internId, name) {
  allowancesInternId = internId;
  document.getElementById("allowancesInternName").textContent = name;
  document.getElementById("allowancesModal").classList.add("open");
  resetAllowanceForm();
  loadAllowances();
}

function closeAllowances() {
  document.getElementById("allowancesModal").classList.remove("open");
  allowancesInternId = null;
  // Cập nhật lại tổng quan vì số liệu có thể đã thay đổi.
  if (currentTab === "tab-allowances") loadAllowanceOverview();
}

async function loadAllowances() {
  const list = document.getElementById("allowancesList");
  list.textContent = "Đang tải danh sách phụ cấp...";
  try {
    const res = await fetch(
      `${API_BASE}/interns/${allowancesInternId}/allowances`,
      {
        headers: authHeaders(),
      },
    );
    if (!res.ok) {
      throw new Error(
        await readErrorMessage(res, "Không tải được danh sách phụ cấp!"),
      );
    }
    const { data } = await res.json();
    allowanceItems = data.items;
    renderAllowances(data);
  } catch (err) {
    list.innerHTML = `<span style="color:#b91c1c">${escapeHtml(err.message)}</span>`;
  }
}

function renderAllowances(data) {
  const { items, summary } = data;
  document.getElementById("allowancesSummary").innerHTML =
    `<span>Khoản đang hiệu lực: <b>${summary.activeCount}</b></span>` +
    `<span>Tổng theo tháng: <b>${formatVnd(summary.totalMonthly)}</b></span>` +
    `<span>Tổng theo ngày: <b>${formatVnd(summary.totalDaily)}</b></span>`;
  const list = document.getElementById("allowancesList");
  if (!items.length) {
    list.innerHTML = `<div style="color:#94a3b8;padding:12px 0">Chưa có khoản phụ cấp nào. Hãy thêm khoản đầu tiên bên dưới.</div>`;
    return;
  }
  list.innerHTML = `<div class="table-container"><table>
          <thead><tr>
            <th>Loại</th><th style="text-align:right">Số tiền</th><th>Chu kỳ</th>
            <th>Hiệu lực</th><th>Trạng thái</th><th>Ghi chú</th><th style="text-align:center">Chức năng</th>
          </tr></thead><tbody>${items
            .map((a) => {
              const st =
                ALLOWANCE_STATUS_BADGES[a.status] ||
                ALLOWANCE_STATUS_BADGES.EXPIRED;
              return `<tr>
                <td>${escapeHtml(ALLOWANCE_TYPE_LABELS[a.allowanceType] || a.allowanceType)}</td>
                <td style="text-align:right" class="allowance-amount">${formatVnd(a.amount)}</td>
                <td>${escapeHtml(ALLOWANCE_CYCLE_LABELS[a.payCycle] || a.payCycle)}</td>
                <td>${escapeHtml(formatDateOnly(a.effectiveFrom))} – ${a.effectiveTo ? escapeHtml(formatDateOnly(a.effectiveTo)) : "hết hợp đồng"}</td>
                <td><span class="badge ${st.cls}">${st.label}</span></td>
                <td>${escapeHtml(a.note || "")}</td>
                <td style="text-align:center;white-space:nowrap">
                  <button class="btn btn-sm btn-outline-primary" type="button" onclick="editAllowance(${Number(a.id)})"><i class="fa-solid fa-pen"></i></button>
                  <button class="btn btn-sm btn-danger" type="button" onclick="deleteAllowance(${Number(a.id)})"><i class="fa-solid fa-trash"></i></button>
                </td>
              </tr>`;
            })
            .join("")}</tbody></table></div>`;
}

function onAllowanceTypeChange() {
  const isOther = document.getElementById("allowanceType").value === "OTHER";
  document.getElementById("allowanceNoteRequired").style.display = isOther
    ? "inline"
    : "none";
}

function resetAllowanceForm() {
  allowanceEditingId = null;
  document.getElementById("allowanceType").value = "MEAL";
  document.getElementById("allowanceAmount").value = "";
  document.getElementById("allowanceCycle").value = "MONTHLY";
  document.getElementById("allowanceFrom").value = "";
  document.getElementById("allowanceTo").value = "";
  document.getElementById("allowanceNote").value = "";
  document.getElementById("allowanceError").textContent = "";
  document.getElementById("allowanceFormTitle").textContent =
    "Thêm khoản phụ cấp";
  document.getElementById("allowanceCancelEditBtn").style.display = "none";
  onAllowanceTypeChange();
}

function editAllowance(id) {
  const item = allowanceItems.find((a) => a.id === id);
  if (!item) return;
  allowanceEditingId = id;
  document.getElementById("allowanceType").value = item.allowanceType;
  document.getElementById("allowanceAmount").value = item.amount;
  document.getElementById("allowanceCycle").value = item.payCycle;
  document.getElementById("allowanceFrom").value = item.effectiveFrom;
  document.getElementById("allowanceTo").value = item.effectiveTo || "";
  document.getElementById("allowanceNote").value = item.note || "";
  document.getElementById("allowanceError").textContent = "";
  document.getElementById("allowanceFormTitle").textContent =
    "Sửa khoản phụ cấp";
  document.getElementById("allowanceCancelEditBtn").style.display = "";
  onAllowanceTypeChange();
  document
    .getElementById("allowanceForm")
    .scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Kiểm tra phía client giống server; server vẫn là nơi quyết định cuối cùng.
function readAllowanceForm() {
  const type = document.getElementById("allowanceType").value;
  const rawAmount = document.getElementById("allowanceAmount").value.trim();
  const from = document.getElementById("allowanceFrom").value;
  const to = document.getElementById("allowanceTo").value;
  const note = document.getElementById("allowanceNote").value.trim();
  if (!/^\d+$/.test(rawAmount) || Number(rawAmount) <= 0) {
    throw new Error("Số tiền phải là số nguyên dương (VND)!");
  }
  const amount = Number(rawAmount);
  if (amount > 999999999)
    throw new Error("Số tiền không được vượt quá 999.999.999 đ!");
  if (!from) throw new Error("Vui lòng chọn ngày bắt đầu hiệu lực!");
  if (to && to < from)
    throw new Error("Ngày kết thúc không được trước ngày bắt đầu!");
  if (type === "OTHER" && !note)
    throw new Error("Phụ cấp loại Khác bắt buộc phải có ghi chú!");
  if (note.length > 500)
    throw new Error("Ghi chú không được vượt quá 500 ký tự!");
  return {
    allowance_type: type,
    amount,
    pay_cycle: document.getElementById("allowanceCycle").value,
    effective_from: from,
    effective_to: to || null,
    note: note || null,
  };
}

async function saveAllowance(event) {
  event.preventDefault();
  if (allowanceSaving) return; // chặn bấm lưu hai lần
  const errorEl = document.getElementById("allowanceError");
  const submitBtn = document.getElementById("allowanceSubmitBtn");
  errorEl.textContent = "";
  let payload;
  try {
    payload = readAllowanceForm();
  } catch (err) {
    errorEl.textContent = err.message;
    return;
  }
  const editing = allowanceEditingId !== null;
  allowanceSaving = true;
  submitBtn.disabled = true;
  try {
    const res = await fetch(
      `${API_BASE}/interns/${allowancesInternId}/allowances${editing ? `/${allowanceEditingId}` : ""}`,
      {
        method: editing ? "PATCH" : "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) {
      throw new Error(
        await readErrorMessage(res, "Không lưu được khoản phụ cấp!"),
      );
    }
    showToast(
      editing ? "Đã cập nhật khoản phụ cấp!" : "Đã thêm khoản phụ cấp!",
    );
    resetAllowanceForm();
    await loadAllowances();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    allowanceSaving = false;
    submitBtn.disabled = false;
  }
}

async function deleteAllowance(id) {
  const item = allowanceItems.find((a) => a.id === id);
  const label = item
    ? `${ALLOWANCE_TYPE_LABELS[item.allowanceType]} ${formatVnd(item.amount)}`
    : "khoản phụ cấp này";
  if (!confirm(`Xóa ${label}? Thao tác này không thể hoàn tác.`)) return;
  try {
    const res = await fetch(
      `${API_BASE}/interns/${allowancesInternId}/allowances/${id}`,
      {
        method: "DELETE",
        headers: authHeaders(),
      },
    );
    if (!res.ok)
      throw new Error(
        await readErrorMessage(res, "Không xóa được khoản phụ cấp!"),
      );
    showToast("Đã xóa khoản phụ cấp!");
    if (allowanceEditingId === id) resetAllowanceForm();
    await loadAllowances();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function loadMyAllowances() {
  if (currentRole !== "Intern") return;
  const body = document.getElementById("myAllowancesBody");
  const requestId = ++myAllowancesRequest;
  const status = document.getElementById("myAllowanceStatus").value;
  const type = document.getElementById("myAllowanceType").value;
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (type) params.set("type", type);
  try {
    const res = await fetch(
      `${API_BASE}/me/allowances${params.toString() ? `?${params}` : ""}`,
      { headers: authHeaders() },
    );
    if (res.status === 401) {
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    }
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload || !payload.success) {
      throw new Error(
        (payload && payload.message) || "Không tải được lịch sử phụ cấp.",
      );
    }
    if (requestId !== myAllowancesRequest) return; // đã có yêu cầu mới hơn
    renderMyAllowances(payload.data, Boolean(status || type));
  } catch (err) {
    if (requestId !== myAllowancesRequest) return;
    body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#b91c1c;padding:24px">${escapeHtml(err.message)}</td></tr>`;
  }
}

function formatRecordedDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

function renderMyAllowances(data, filtered) {
  const { items, summary } = data;
  document.getElementById("myAllowanceSummary").innerHTML =
    `<span>Đang hưởng theo tháng: <b>${formatVnd(summary.totalMonthly)}</b></span>` +
    `<span>Theo ngày: <b>${formatVnd(summary.totalDaily)}</b></span>` +
    `<span>Đang hiệu lực: <b>${summary.activeCount}</b></span>` +
    `<span>Sắp hiệu lực: <b>${summary.upcomingCount}</b></span>` +
    `<span>Đã hết hạn: <b>${summary.expiredCount}</b></span>`;
  const body = document.getElementById("myAllowancesBody");
  if (!items.length) {
    const message = filtered
      ? "Không có khoản phụ cấp nào phù hợp bộ lọc."
      : "HR chưa ghi nhận khoản phụ cấp nào cho bạn.";
    body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px">${message}</td></tr>`;
    return;
  }
  body.innerHTML = items
    .map((a) => {
      const st =
        ALLOWANCE_STATUS_BADGES[a.status] || ALLOWANCE_STATUS_BADGES.EXPIRED;
      return `<tr>
              <td>${escapeHtml(ALLOWANCE_TYPE_LABELS[a.allowanceType] || a.allowanceType)}</td>
              <td style="text-align:right" class="allowance-amount">${formatVnd(a.amount)}</td>
              <td>${escapeHtml(ALLOWANCE_CYCLE_LABELS[a.payCycle] || a.payCycle)}</td>
              <td>${escapeHtml(formatDateOnly(a.effectiveFrom))} – ${a.effectiveTo ? escapeHtml(formatDateOnly(a.effectiveTo)) : "hết hợp đồng"}</td>
              <td><span class="badge ${st.cls}">${st.label}</span></td>
              <td>${escapeHtml(a.note || "")}</td>
              <td>${escapeHtml(formatRecordedDate(a.recordedAt))}</td>
            </tr>`;
    })
    .join("");
}
