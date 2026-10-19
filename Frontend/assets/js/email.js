// được cập nhật theo giá trị server trả về (meta.maxAttempts)

// 1. Tải cấu hình SMTP hiện tại
async function loadEmailConfig() {
  if (currentRole !== "Admin") return;
  const pillEl = document.getElementById("smtpStatusPill");
  try {
    const res = await fetch(`${API_BASE}/email/config`, {
      headers: authHeaders(),
    });
    if (res.status === 401) {
      forceLogout();
      return;
    }
    const body = await res.json();
    if (!res.ok || !body.success) throw new Error(body.message);

    const cfg = body.data || {};
    document.getElementById("smtpHost").value = cfg.host || "";
    document.getElementById("smtpPort").value = cfg.port || 587;
    document.getElementById("smtpSecure").value = cfg.secure ? "true" : "false";
    document.getElementById("smtpUser").value = cfg.user || "";
    document.getElementById("smtpFromName").value = cfg.fromName || "";
    document.getElementById("smtpFromEmail").value = cfg.fromEmail || "";
    document.getElementById("smtpPass").value = "";

    const pwdNotice = document.getElementById("pwdNoticeLabel");
    if (cfg.hasPassword) {
      pwdNotice.innerHTML = `(<i class="fa-solid fa-lock" style="color: #16a34a"></i> Đã lưu mật khẩu)`;
      document.getElementById("smtpPass").placeholder =
        "•••••••• (Nhập mới nếu muốn thay đổi)";
    } else {
      pwdNotice.innerHTML = `(<span style="color: #dc2626">Chưa có mật khẩu</span>)`;
      document.getElementById("smtpPass").placeholder =
        "Nhập mật khẩu ứng dụng 16 ký tự";
    }

    if (cfg.configured) {
      pillEl.innerHTML = `<span class="badge badge-sent"><i class="fa-solid fa-circle-check"></i> Đã cấu hình SMTP</span>`;
    } else {
      pillEl.innerHTML = `<span class="badge badge-failed"><i class="fa-solid fa-circle-xmark"></i> Chưa hoàn tất cấu hình</span>`;
    }
  } catch (err) {
    pillEl.innerHTML = `<span class="badge badge-failed">Lỗi kết nối</span>`;
    showToast(err.message || "Không thể tải cấu hình email!", "error");
  }
}

// 2. Lưu cấu hình SMTP
async function handleSaveEmailConfig(e) {
  e.preventDefault();
  const alertEl = document.getElementById("emailConfigAlert");
  const btn = document.getElementById("btnSaveConfig");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...`;

  const host = document.getElementById("smtpHost").value.trim();
  const port = Number(document.getElementById("smtpPort").value);
  const secure = document.getElementById("smtpSecure").value === "true";
  const user = document.getElementById("smtpUser").value.trim();
  const pass = document.getElementById("smtpPass").value.trim();
  const fromName = document.getElementById("smtpFromName").value.trim();
  const fromEmail = document.getElementById("smtpFromEmail").value.trim();

  const payload = { host, port, secure, user, fromName, fromEmail };
  if (pass) payload.pass = pass;

  try {
    const res = await fetch(`${API_BASE}/email/config`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok || !body.success) throw new Error(body.message);

    showAlert(alertEl, body.message, "success");
    showToast(body.message, "success");
    await loadEmailConfig();
  } catch (err) {
    showAlert(alertEl, err.message || "Lỗi lưu cấu hình!", "danger");
    showToast(err.message || "Không thể lưu cấu hình SMTP!", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Lưu Cấu Hình SMTP`;
  }
}

// 3. Gửi email thử nghiệm SMTP
async function handleTestEmailConfig(e) {
  e.preventDefault();
  const alertEl = document.getElementById("testEmailAlert");
  const btn = document.getElementById("btnSendTest");
  const to = document.getElementById("testEmailTo").value.trim();
  if (!to) return;

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang gửi thử...`;

  try {
    const res = await fetch(`${API_BASE}/email/config/test`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ to }),
    });
    const body = await res.json();
    if (!res.ok || !body.success) throw new Error(body.message);

    showAlert(alertEl, body.message, "success");
    showToast(body.message, "success");
  } catch (err) {
    showAlert(alertEl, err.message || "Gửi thử thất bại!", "danger");
    showToast(err.message || "Gửi thử nghiệm thất bại!", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Gửi Email Thử Nghiệm`;
  }
}

// 4. Tải danh sách nhật ký gửi email
async function loadEmailLogs(page = 1) {
  currentPageEmailLogs = page;
  const tbody = document.getElementById("emailLogsTableBody");
  const status = document.getElementById("logFilterStatus")
    ? document.getElementById("logFilterStatus").value
    : "";
  const type = document.getElementById("logFilterType")
    ? document.getElementById("logFilterType").value
    : "";
  const search = document.getElementById("logFilterSearch")
    ? document.getElementById("logFilterSearch").value.trim()
    : "";

  const queryParams = new URLSearchParams({ page, pageSize: 15 });
  if (status) queryParams.set("status", status);
  if (type) queryParams.set("type", type);
  if (search) queryParams.set("search", search);

  try {
    const res = await fetch(
      `${API_BASE}/email/logs?${queryParams.toString()}`,
      {
        headers: authHeaders(),
      },
    );
    if (res.status === 401) {
      forceLogout();
      return;
    }
    if (res.status === 403) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #dc2626; padding: 24px">Bạn không có quyền xem nhật ký email!</td></tr>`;
      return;
    }
    const body = await res.json();
    if (!res.ok || !body.success) throw new Error(body.message);

    const logs = body.data || [];
    if (body.meta && body.meta.maxAttempts) {
      emailMaxAttempts = body.meta.maxAttempts;
    }
    const total = body.pagination ? body.pagination.total : logs.length;
    const pageSize = body.pagination ? body.pagination.pageSize : 15;
    totalPagesEmailLogs = Math.max(1, Math.ceil(total / pageSize));

    // Cập nhật thanh phân trang
    document.getElementById("emailLogsPagingText").innerText =
      `Hiển thị ${logs.length} / ${total} bản ghi (Trang ${page}/${totalPagesEmailLogs})`;
    document.getElementById("btnPrevEmailLogs").disabled = page <= 1;
    document.getElementById("btnNextEmailLogs").disabled =
      page >= totalPagesEmailLogs;

    // Cập nhật thống kê nhanh
    renderEmailLogsStats(logs, total);

    // Render bảng
    renderEmailLogsTable(logs);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #dc2626; padding: 24px">Lỗi khi tải nhật ký email: ${escapeHtml(err.message)}</td></tr>`;
    showToast("Không thể tải nhật ký email!", "error");
  }
}

function renderEmailLogsStats(logs, total) {
  document.getElementById("statTotalEmailLogs").innerText = total;
  const sent = logs.filter((l) => l.status === "SENT").length;
  const retrying = logs.filter((l) => l.status === "RETRYING").length;
  const failed = logs.filter((l) => l.status === "FAILED").length;
  document.getElementById("statSentEmailLogs").innerText = sent;
  document.getElementById("statRetryingEmailLogs").innerText = retrying;
  document.getElementById("statFailedEmailLogs").innerText = failed;
}

function renderEmailLogsTable(logs) {
  const tbody = document.getElementById("emailLogsTableBody");
  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #94a3b8; padding: 32px">Không tìm thấy bản ghi nhật ký email nào phù hợp.</td></tr>`;
    return;
  }

  const typeLabels = {
    MEETING_INVITE: {
      label: "Mời họp",
      cls: "badge-approved",
      icon: "fa-calendar-check",
    },
    MEETING_UPDATED: {
      label: "Cập nhật lịch họp",
      cls: "badge-pending",
      icon: "fa-calendar-days",
    },
    MEETING_CANCELLED: {
      label: "Hủy / đổi người tham dự",
      cls: "badge-rejected",
      icon: "fa-calendar-xmark",
    },
    MEETING_REMINDER: {
      label: "Nhắc lịch họp",
      cls: "badge-pending",
      icon: "fa-bell",
    },
    APPROVED: {
      label: "Duyệt trúng tuyển",
      cls: "badge-approved",
      icon: "fa-circle-check",
    },
    REJECTED: {
      label: "Từ chối hồ sơ",
      cls: "badge-rejected",
      icon: "fa-circle-xmark",
    },
  };

  const statusLabels = {
    SENT: { label: "Đã gửi", cls: "badge-sent", icon: "fa-check" },
    RETRYING: {
      label: "Đang thử lại",
      cls: "badge-retrying",
      icon: "fa-rotate",
    },
    FAILED: {
      label: "Thất bại",
      cls: "badge-failed",
      icon: "fa-triangle-exclamation",
    },
    PENDING: {
      label: "Chờ gửi",
      cls: "badge-pending",
      icon: "fa-hourglass-start",
    },
  };

  tbody.innerHTML = logs
    .map((log) => {
      const typeUi = (Object.hasOwn(typeLabels, log.emailType)
        ? typeLabels[log.emailType]
        : null) || {
        label: log.emailType,
        cls: "badge-test",
        icon: "fa-envelope",
      };
      const statusUi = (Object.hasOwn(statusLabels, log.status)
        ? statusLabels[log.status]
        : null) || {
        label: log.status,
        cls: "badge-pending",
        icon: "fa-circle",
      };
      const canRetry = log.status === "FAILED" || log.status === "RETRYING";

      let timeOrError = "-";
      if (log.status === "SENT" && log.sentAt) {
        timeOrError = `<span style="color: #16a34a; font-size: 14px;"><i class="fa-solid fa-clock"></i> ${new Date(log.sentAt).toLocaleString("vi-VN", { timeZone: VN_TIME_ZONE })}</span>`;
      } else if (log.errorMessage) {
        timeOrError = `<span class="log-err-msg" title="${escapeHtml(log.errorMessage)}" data-error="${escapeHtml(log.errorMessage)}" onclick="showToast('Chi tiết lỗi: ' + this.dataset.error, 'error')"><i class="fa-solid fa-circle-exclamation"></i> ${escapeHtml(log.errorMessage)}</span>`;
      } else if (log.createdAt) {
        timeOrError = `<span style="color: #64748b; font-size: 14px;">${new Date(log.createdAt).toLocaleString("vi-VN", { timeZone: VN_TIME_ZONE })}</span>`;
      }

      const actionHtml = canRetry
        ? `<button class="btn btn-sm btn-primary" onclick="handleRetryEmailLog(${Number(log.id)})" title="Gửi lại ngay lập tức"><i class="fa-solid fa-rotate-right"></i> Gửi lại</button>`
        : `<span style="color: #94a3b8; font-size: 14.5px;">—</span>`;

      return `
            <tr>
              <td><b>#${log.id}</b></td>
              <td>
                <div style="font-weight: 600; color: var(--slate-900);">${escapeHtml(log.recipientName || "—")}</div>
                <div style="font-size: 13px; color: var(--slate-600);">${escapeHtml(log.recipientEmail)}</div>
              </td>
              <td><span class="badge ${typeUi.cls}"><i class="fa-solid ${typeUi.icon}"></i> ${escapeHtml(typeUi.label)}</span></td>
              <td style="font-size: 14.5px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(log.subject)}">${escapeHtml(log.subject)}</td>
              <td><span class="badge ${statusUi.cls}"><i class="fa-solid ${statusUi.icon}"></i> ${escapeHtml(statusUi.label)}</span></td>
              <td align="center"><span style="font-weight: 700; color: #475569;">${log.attempts || 0}/${emailMaxAttempts}</span></td>
              <td>${timeOrError}</td>
              <td align="center">${actionHtml}</td>
            </tr>
          `;
    })
    .join("");
}

function changeEmailLogsPage(delta) {
  const targetPage = currentPageEmailLogs + delta;
  if (targetPage >= 1 && targetPage <= totalPagesEmailLogs) {
    loadEmailLogs(targetPage);
  }
}

async function handleRetryEmailLog(id) {
  if (!confirm(`Bạn có chắc muốn gửi lại email #${id} ngay bây giờ không?`))
    return;
  try {
    const res = await fetch(`${API_BASE}/email/logs/${id}/retry`, {
      method: "POST",
      headers: authHeaders(),
    });
    const body = await res.json();
    if (!res.ok || !body.success) throw new Error(body.message);

    showToast("Đã kích hoạt gửi lại email thành công!", "success");
    setTimeout(() => loadEmailLogs(currentPageEmailLogs), 1000);
  } catch (err) {
    showToast(err.message || "Gửi lại email thất bại!", "error");
  }
}
