async function loadMyContracts() {
  if (currentRole !== "Intern") return;
  const list = document.getElementById("myContractsList");
  list.innerHTML = `<p style="text-align:center;color:#94a3b8;padding:16px;">Đang tải danh sách hợp đồng...</p>`;
  try {
    const response = await fetch(`${API_BASE}/me/contracts`, {
      headers: authHeaders(),
    });
    if (response.status === 401)
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    const body = await response.json();
    if (!response.ok || !body.success)
      throw new Error(body.message || "Không tải được hợp đồng.");
    myContracts = Array.isArray(body.data) ? body.data : [];
    renderMyContracts();
  } catch (err) {
    list.innerHTML = `<p style="text-align:center;color:#ef4444;padding:16px;">${escapeHtml(err.message || "Lỗi tải danh sách hợp đồng.")}</p>`;
  }
}

function renderMyContracts() {
  const list = document.getElementById("myContractsList");
  if (!myContracts.length) {
    list.innerHTML = `<p style="text-align:center;color:#94a3b8;padding:16px;">HR chưa gửi hợp đồng thực tập cho bạn.</p>`;
    return;
  }
  list.innerHTML = myContracts
    .map((contract) => {
      const confirmed = contract.confirmation_status === "CONFIRMED";
      const busy = confirmingMyContracts.has(Number(contract.id));
      return `
            <article style="padding:16px 4px;border-bottom:1px solid #e2e8f0">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
                <div style="min-width:220px;flex:1">
                  <b>${escapeHtml(contract.title || contract.original_name)}</b>
                  <div style="color:#64748b;margin-top:4px">
                    ${escapeHtml(contract.original_name)} · ${escapeHtml(formatDateOnly(contract.start_date) || "Chưa có ngày bắt đầu")} – ${escapeHtml(formatDateOnly(contract.end_date) || "Chưa có ngày kết thúc")}
                  </div>
                  ${contract.note ? `<small style="display:block;margin-top:4px;color:#64748b">${escapeHtml(contract.note)}</small>` : ""}
                  <div style="margin-top:8px">
                    <span class="badge ${confirmed ? "badge-active" : "badge-pending"}">${confirmed ? "Đã xác nhận" : "Chờ xác nhận"}</span>
                    ${confirmed && contract.confirmed_at ? `<small style="color:#64748b;margin-left:8px">Xác nhận lúc ${escapeHtml(formatDateTime(contract.confirmed_at))}</small>` : ""}
                  </div>
                </div>
                <div class="action-group" style="flex-wrap:wrap;justify-content:flex-end">
                  ${contract.mime_type === "application/pdf" ? `<button class="btn btn-sm btn-outline-primary" onclick="viewMyContract(${Number(contract.id)})"><i class="fa-solid fa-eye"></i> Xem</button>` : ""}
                  <button class="btn btn-sm btn-primary" onclick="downloadMyContract(${Number(contract.id)})"><i class="fa-solid fa-download"></i> Tải xuống</button>
                  ${
                    confirmed
                      ? `<button class="btn btn-sm" disabled><i class="fa-solid fa-check"></i> Đã xác nhận</button>`
                      : `<button class="btn btn-sm btn-success" ${busy ? "disabled" : ""} onclick="confirmMyContract(${Number(contract.id)})"><i class="fa-solid ${busy ? "fa-spinner fa-spin" : "fa-check"}"></i> ${busy ? "Đang xác nhận..." : "Xác nhận hợp đồng"}</button>`
                  }
                </div>
              </div>
            </article>`;
    })
    .join("");
}

async function confirmMyContract(contractId) {
  const contract = myContracts.find(
    (item) => Number(item.id) === Number(contractId),
  );
  if (!contract || contract.confirmation_status !== "PENDING") return;
  if (
    !confirm(
      `Bạn xác nhận đã đọc và đồng ý với hợp đồng "${contract.title || contract.original_name}"?`,
    )
  )
    return;
  confirmingMyContracts.add(Number(contractId));
  renderMyContracts();
  try {
    const response = await fetch(
      `${API_BASE}/me/contracts/${Number(contractId)}/confirm`,
      {
        method: "POST",
        headers: authHeaders(),
      },
    );
    if (response.status === 401)
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    const body = await response.json();
    if (!response.ok || !body.success)
      throw new Error(body.message || "Không xác nhận được hợp đồng.");
    myContracts = myContracts.map((item) =>
      Number(item.id) === Number(contractId) ? body.data : item,
    );
    showToast(body.message || "Đã xác nhận hợp đồng thành công!", "success");
  } catch (err) {
    showToast(err.message || "Không xác nhận được hợp đồng!", "error");
  } finally {
    confirmingMyContracts.delete(Number(contractId));
    renderMyContracts();
  }
}

async function fetchMyContractBlob(contractId) {
  const response = await fetch(
    `${API_BASE}/me/contracts/${Number(contractId)}/download`,
    {
      headers: authHeaders(),
    },
  );
  if (response.status === 401) {
    forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    throw new Error("Phiên đăng nhập đã hết hạn.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || "Không tải được file hợp đồng.");
  }
  return response.blob();
}

async function viewMyContract(contractId) {
  const preview = window.open("about:blank", "_blank");
  if (!preview)
    return showToast(
      "Trình duyệt đã chặn cửa sổ xem file. Hãy cho phép cửa sổ bật lên rồi thử lại.",
      "error",
    );
  preview.opener = null;
  try {
    const blob = await fetchMyContractBlob(contractId);
    const objectUrl = URL.createObjectURL(blob);
    preview.location.href = objectUrl;
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  } catch (err) {
    preview.close();
    showToast(err.message || "Không xem được hợp đồng!", "error");
  }
}

async function downloadMyContract(contractId) {
  try {
    const blob = await fetchMyContractBlob(contractId);
    const contract = myContracts.find(
      (item) => Number(item.id) === Number(contractId),
    );
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = contract?.original_name || "hop-dong";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (err) {
    showToast(err.message || "Không tải được hợp đồng!", "error");
  }
}

function openContracts(id, name, viewOnly = false) {
  contractsInternId = id;
  contractsViewOnly = viewOnly;
  document.getElementById("contractsInternName").textContent = name;
  document.getElementById("contractUploadForm").style.display = viewOnly
    ? "none"
    : "";
  document.getElementById("contractsModal").classList.add("open");
  document.getElementById("contractError").textContent = "";
  // Cần danh sách chương trình để hiện tên chương trình trong từng hợp đồng.
  loadContractPrograms().then(() => loadContracts());
}

async function createScheduleTemplate(internId = contractsInternId) {
  if (
    !internId ||
    !confirm(
      "Tạo các mốc BM02 từ ngày trong hợp đồng đã xác nhận? Nếu đã có mốc, hệ thống sẽ từ chối và giữ nguyên toàn bộ.",
    )
  )
    return;
  try {
    const response = await fetch(
      `${API_BASE}/interns/${Number(internId)}/schedule/template`,
      { method: "POST", headers: authHeaders() },
    );
    const body = await response.json();
    if (!response.ok || !body.success)
      throw new Error(body.message || "Không tạo được kế hoạch.");
    showToast("Đã tạo kế hoạch từ mẫu.", "success");
    if (Number(scheduleManagerInternId) === Number(internId))
      await loadScheduleMilestones();
    else {
      const student = studentsList.find(
        (item) => Number(item.id) === Number(internId),
      );
      closeContracts();
      openScheduleManager(internId, student?.fullName || "");
    }
  } catch (err) {
    showToast(err.message || "Không tạo được kế hoạch.", "error");
  }
}

function buildContractProgramOptions(selectedId) {
  return contractPrograms
    .map(
      (p) =>
        `<option value="${Number(p.id)}"${Number(p.id) === Number(selectedId) ? " selected" : ""}>${escapeHtml(p.name)} — ${escapeHtml(p.department_name || "")}</option>`,
    )
    .join("");
}

function buildContractProgramView(contract) {
  const program = contractPrograms.find(
    (p) => Number(p.id) === Number(contract.program_id),
  );
  const label = contract.program_id
    ? program
      ? `${program.name} — ${program.department_name || ""}`
      : `Chương trình #${contract.program_id}`
    : "Chưa liên kết chương trình";
  const editButton = contractsViewOnly
    ? ""
    : ` <button type="button" class="btn btn-sm btn-outline-primary" onclick="startEditContractProgram(${Number(contract.id)})">Đổi</button>`;
  return `<span style="color:#64748b">Chương trình:</span> <b>${escapeHtml(label)}</b>${editButton}`;
}

function startEditContractProgram(contractId) {
  const contract = contractsData.find(
    (item) => Number(item.id) === Number(contractId),
  );
  const row = document.getElementById(`contractProgramRow-${contractId}`);
  if (!contract || !row) return;
  row.innerHTML = `<select id="contractProgramEdit-${Number(contractId)}" class="form-control" style="display:inline-block;width:auto;max-width:100%"><option value="">Không liên kết chương trình</option>${buildContractProgramOptions(contract.program_id)}</select> <button type="button" class="btn btn-sm btn-primary" onclick="saveContractProgram(${Number(contractId)})">Lưu</button> <button type="button" class="btn btn-sm" onclick="loadContracts()">Hủy</button>`;
}

// Gửi PATCH sửa hợp đồng (chương trình và/hoặc ngày), xong thì tải lại danh sách.
async function patchContract(contractId, payload) {
  const errorBox = document.getElementById("contractError");
  errorBox.textContent = "";
  try {
    const response = await fetch(
      `${API_BASE}/interns/${contractsInternId}/contracts/${contractId}`,
      {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      },
    );
    if (response.status === 401)
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.success)
      throw new Error(body.message || "Không cập nhật được hợp đồng.");
    showToast(
      body.data?.reconfirmation_required
        ? body.message
        : "Đã cập nhật hợp đồng.",
      "success",
    );
    await loadContracts();
  } catch (err) {
    errorBox.textContent = err.message || "Không cập nhật được hợp đồng.";
  }
}

async function saveContractProgram(contractId) {
  const select = document.getElementById(`contractProgramEdit-${contractId}`);
  if (!select) return;
  await patchContract(contractId, {
    program_id: select.value === "" ? null : Number(select.value),
  });
}

function buildContractDatesView(contract) {
  const range = `${formatDateOnly(contract.start_date) || "Chưa có ngày bắt đầu"} – ${formatDateOnly(contract.end_date) || "Chưa có ngày kết thúc"}`;
  const editButton = contractsViewOnly
    ? ""
    : ` <button type="button" class="btn btn-sm btn-outline-primary" onclick="startEditContractDates(${Number(contract.id)})">Sửa</button>`;
  return `<span style="color:#64748b">Thời gian:</span> <b>${escapeHtml(range)}</b>${editButton}`;
}

function startEditContractDates(contractId) {
  const contract = contractsData.find(
    (item) => Number(item.id) === Number(contractId),
  );
  const row = document.getElementById(`contractDatesRow-${contractId}`);
  if (!contract || !row) return;
  const id = Number(contractId);
  const dateInput = (suffix, value) =>
    `<input type="date" id="contract${suffix}Edit-${id}" class="form-control" style="display:inline-block;width:auto" value="${escapeHtml(value || "")}" />`;
  row.innerHTML = `${dateInput("Start", contract.start_date)} – ${dateInput("End", contract.end_date)} <button type="button" class="btn btn-sm btn-primary" onclick="saveContractDates(${id})">Lưu</button> <button type="button" class="btn btn-sm" onclick="loadContracts()">Hủy</button>`;
}

async function saveContractDates(contractId) {
  const startInput = document.getElementById(`contractStartEdit-${contractId}`);
  const endInput = document.getElementById(`contractEndEdit-${contractId}`);
  if (!startInput || !endInput) return;
  const errorBox = document.getElementById("contractError");
  if (!startInput.value || !endInput.value) {
    errorBox.textContent = "Vui lòng nhập đủ ngày bắt đầu và ngày kết thúc.";
    return;
  }
  if (endInput.value < startInput.value) {
    errorBox.textContent = "Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.";
    return;
  }
  const contract = contractsData.find(
    (item) => Number(item.id) === Number(contractId),
  );
  if (
    contract?.confirmation_status === "CONFIRMED" &&
    !confirm(
      "Thực tập sinh đã xác nhận hợp đồng này. Đổi ngày sẽ thay đổi thời gian thực tập hiện hành và có thể làm lịch thực tập không còn khớp. Bạn có chắc chắn muốn đổi?",
    )
  )
    return;
  await patchContract(contractId, {
    start_date: startInput.value,
    end_date: endInput.value,
  });
}

async function loadContractPrograms() {
  const select = document.getElementById("contractProgramId");
  if (!select) return;
  try {
    const response = await fetch(`${API_BASE}/programs`, {
      headers: authHeaders(),
    });
    const body = await response.json();
    if (!response.ok || !body.success) return;
    contractPrograms = body.data || [];
    select.innerHTML =
      `<option value="">Không liên kết chương trình</option>` +
      buildContractProgramOptions("");
  } catch {
    /* Chương trình là trường liên kết tùy chọn. */
  }
}

function closeContracts() {
  document.getElementById("contractsModal").classList.remove("open");
}

async function loadContracts() {
  const list = document.getElementById("contractsList");
  list.innerHTML = "Đang tải danh sách hợp đồng...";

  try {
    const response = await fetch(
      `${API_BASE}/interns/${contractsInternId}/contracts`,
      { headers: authHeaders() },
    );
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.message || "Không tải được hợp đồng.");

    contractsData = body.data;
    if (!body.data.length) {
      list.innerHTML = "<p>Thực tập sinh chưa có hợp đồng nào.</p>";
      return;
    }

    list.innerHTML = body.data
      .map(
        (contract) => `
            <div style="display:flex;justify-content:space-between;gap:10px;padding:10px;border-bottom:1px solid #e2e8f0">
              <div>
                <b>${escapeHtml(contract.title || contract.original_name)}</b>
                <div>${escapeHtml(contract.original_name)}</div>
                <small>${escapeHtml(contract.note || "")}</small>
                <div id="contractDatesRow-${Number(contract.id)}" style="margin-top:6px;font-size:14.5px">${buildContractDatesView(contract)}</div>
                <div id="contractProgramRow-${Number(contract.id)}" style="margin-top:6px;font-size:14.5px">${buildContractProgramView(contract)}</div>
                <div style="margin-top:6px;font-size:13px">
                  <span class="badge ${contract.confirmation_status === "CONFIRMED" ? "badge-active" : "badge-pending"}">${contract.confirmation_status === "CONFIRMED" ? "Đã xác nhận" : "Chờ xác nhận"}</span>
                  ${contract.confirmed_at ? `<span style="color:#64748b;margin-left:6px">Xác nhận lúc ${escapeHtml(formatDateTime(contract.confirmed_at))}</span>` : ""}
                </div>
              </div>
              <div>
                ${contract.mime_type === "application/pdf" ? `<button class="btn btn-sm btn-outline-primary" onclick="downloadContract(${Number(contract.id)}, true)"><i class="fa-solid fa-eye"></i> Xem</button>` : ""}
                <button class="btn btn-sm btn-primary" onclick="downloadContract(${Number(contract.id)}, false, ${escapeHtml(JSON.stringify(contract.original_name))})">Tải xuống</button>
                <button class="btn btn-sm btn-danger" onclick="deleteContract(${Number(contract.id)})">Xóa</button>
              </div>
            </div>
          `,
      )
      .join("");
  } catch (err) {
    list.innerHTML = `<p style="color:#ef4444">${escapeHtml(err.message || "Lỗi tải danh sách hợp đồng.")}</p>`;
  }
}

function uploadContract(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const progress = document.getElementById("contractUploadProgress");
  const progressBar = document.getElementById("contractProgress");
  const progressText = document.getElementById("contractProgressText");
  const errorBox = document.getElementById("contractError");
  errorBox.textContent = "";
  progress.style.display = "block";

  const xhr = new XMLHttpRequest();
  xhr.open("POST", `${API_BASE}/interns/${contractsInternId}/contracts`);
  xhr.setRequestHeader("Authorization", `Bearer ${getAuthToken()}`);
  xhr.upload.onprogress = (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.round((event.loaded / event.total) * 100);
    progressBar.value = percent;
    progressText.textContent = `${percent}%`;
  };
  xhr.onload = () => {
    let body = {};
    try {
      body = JSON.parse(xhr.responseText);
    } catch {
      // Response rỗng hoặc không phải JSON.
    }

    if (xhr.status >= 200 && xhr.status < 300) {
      form.reset();
      loadContracts();
      const student = studentsList.find(
        (item) => Number(item.id) === Number(contractsInternId),
      );
      if (student)
        student.contract_count = (Number(student.contract_count) || 0) + 1;
      renderContractManagement();
    } else {
      errorBox.textContent = body.message || "Tải hợp đồng thất bại.";
    }
    progress.style.display = "none";
  };
  xhr.onerror = () => {
    errorBox.textContent = "Lỗi kết nối khi tải hợp đồng.";
    progress.style.display = "none";
  };
  xhr.send(formData);
}

async function downloadContract(
  contractId,
  inline = false,
  originalName = "hop-dong",
) {
  try {
    const response = await fetch(
      `${API_BASE}/interns/${contractsInternId}/contracts/${contractId}/download${inline ? "?disposition=inline" : ""}`,
      { headers: authHeaders() },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || "Tải file thất bại.");
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    if (inline) {
      window.open(objectUrl, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      return;
    }
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = originalName || "hop-dong";
    link.click();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    document.getElementById("contractError").textContent = err.message;
  }
}

async function deleteContract(contractId) {
  if (!confirm("Bạn có chắc chắn muốn xóa hợp đồng này không?")) return;

  try {
    const response = await fetch(
      `${API_BASE}/interns/${contractsInternId}/contracts/${contractId}`,
      { method: "DELETE", headers: authHeaders() },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || "Xóa hợp đồng thất bại.");
    const student = studentsList.find(
      (item) => Number(item.id) === Number(contractsInternId),
    );
    if (student)
      student.contract_count = Math.max(
        0,
        (Number(student.contract_count) || 1) - 1,
      );
    renderContractManagement();
    await loadContracts();
  } catch (err) {
    document.getElementById("contractError").textContent = err.message;
  }
}
