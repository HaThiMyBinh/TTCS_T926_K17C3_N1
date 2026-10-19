// =========================================================================
//  TẠO TÀI KHOẢN & QUẢN LÝ DANH SÁCH USERS
// =========================================================================
async function loadUsers() {
  // Không gọi API quản lý tài khoản nếu vai trò hiện tại không có quyền.
  if (!getRolePermissions(currentRole).includes("MANAGE_USERS")) {
    usersList = [];
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/users`, {
      headers: authHeaders(),
    });
    if (res.status === 401)
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    usersList = await res.json();
    renderUserTable();
    updateStats();
  } catch (err) {
    console.error("Lỗi tải users:", err);
  }
}

function updateStats() {
  const total = usersList.length;
  const hr = usersList.filter((u) => u.role === "HR").length;
  const mentor = usersList.filter((u) => u.role === "Mentor").length;
  const intern = usersList.filter((u) => u.role === "Intern").length;

  document.getElementById("statTotalUsers").innerText = total;
  document.getElementById("statHrUsers").innerText = hr;
  document.getElementById("statMentorUsers").innerText = mentor;
  document.getElementById("statInternUsers").innerText = intern;
}

function renderUserTable() {
  const tbody = document.getElementById("userTableBody");
  const search = (document.getElementById("userSearchInput").value || "")
    .toLowerCase()
    .trim();
  const roleFilter = document.getElementById("userRoleFilter").value;

  const filtered = usersList.filter((u) => {
    const matchSearch =
      (u.name && u.name.toLowerCase().includes(search)) ||
      (u.email && u.email.toLowerCase().includes(search));
    const matchRole = roleFilter === "ALL" || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 24px;">Không tìm thấy người dùng nào phù hợp</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((u) => {
      let roleBadge = "badge-intern";
      if (u.role === "Admin") roleBadge = "badge-admin";
      else if (u.role === "HR") roleBadge = "badge-hr";
      else if (u.role === "Mentor") roleBadge = "badge-mentor";

      const createdDate = u.createdAt
        ? new Date(u.createdAt).toLocaleDateString("vi-VN", {
            timeZone: VN_TIME_ZONE,
          })
        : "N/A";

      return `
          <tr>
            <td style="font-family: monospace; font-size: 13px; color: #64748b;">${Number(u.id)}</td>
            <td><b>${escapeHtml(u.name)}</b></td>
            <td>${escapeHtml(u.email)}</td>
            <td><span class="badge ${roleBadge}">${escapeHtml(u.role)}</span></td>
            <td><span class="badge badge-active">${escapeHtml(u.status || "ACTIVE")}</span></td>
            <td style="font-size: 14px; color: #64748b;">${createdDate}</td>
            <td align="center">
              <button class="btn btn-sm btn-danger" onclick="deleteUser(${Number(u.id)}, ${escapeHtml(JSON.stringify(u.email))})">
                <i class="fa-solid fa-trash"></i>
              </button>
            </td>
          </tr>
        `;
    })
    .join("");
}

// TẠO TÀI KHOẢN (POST /api/users)
async function handleCreateUser(e) {
  e.preventDefault();
  const name = document.getElementById("newUserName").value.trim();
  const email = document.getElementById("newUserEmail").value.trim();
  const password = document.getElementById("newUserPassword").value;
  const role = document.getElementById("newUserRole").value;
  const alertBox = document.getElementById("createUserAlert");
  const btn = document.getElementById("btnCreateUser");

  // Validate dữ liệu
  if (password.length < 6) {
    showAlert(alertBox, "Mật khẩu phải từ 6 ký tự trở lên!", "error");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang xử lý...`;

  try {
    const res = await fetch(`${API_BASE}/users`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name, email, password, role }),
    });
    const data = await res.json();

    if (res.ok) {
      showAlert(alertBox, data.message, "success");
      document.getElementById("createUserForm").reset();
      await loadUsers();
    } else {
      showAlert(alertBox, data.error || "Tạo tài khoản thất bại!", "error");
    }
  } catch (err) {
    showAlert(alertBox, " Không thể kết nối tới Backend!", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-plus"></i> Tạo tài khoản`;
  }
}

async function deleteUser(id, email) {
  if (!confirm(`Bạn có chắc muốn xóa tài khoản "${email}" không?`)) return;
  try {
    const res = await fetch(`${API_BASE}/users/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (res.ok) {
      await loadUsers();
      showToast("Đã xóa tài khoản.", "success");
    } else {
      showToast(await readErrorMessage(res, "Lỗi khi xóa tài khoản!"), "error");
    }
  } catch (err) {
    showToast("Không thể kết nối Backend!", "error");
  }
}

// =========================================================================
//  QUẢN LÝ PHÂN QUYỀN CHI TIẾT (RBAC MATRIX)
// =========================================================================
async function loadPermissions() {
  try {
    const res = await fetch(`${API_BASE}/permissions`, {
      headers: authHeaders(),
    });
    if (res.status === 401)
      return forceLogout("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!");
    permissionsMap = await res.json();
    renderPermissionsMatrix();
  } catch (err) {
    console.error("Lỗi đọc ma trận quyền:", err);
  }
}

function renderPermissionsMatrix() {
  const tbody = document.getElementById("permMatrixBody");
  const roles = ["HR", "Mentor", "Intern"];

  tbody.innerHTML = PERMISSIONS_DEF.map((p) => {
    return `
          <tr>
            <td><b><i class="fa-solid ${p.icon}" style="margin-right: 8px; color: var(--primary);"></i>${p.name}</b></td>
            <td style="font-family: monospace; font-size: 13px; color: #64748b;">${p.code}</td>
            ${roles
              .map((r) => {
                const isChecked = (permissionsMap[r] || []).includes(p.code);
                return `
                <td>
                  <input type="checkbox" class="toggle-checkbox" id="perm_${r}_${p.code}" ${isChecked ? "checked" : ""} />
                </td>
              `;
              })
              .join("")}
          </tr>
        `;
  }).join("");
}

async function savePermissions() {
  const roles = ["HR", "Mentor", "Intern"];
  const alertBox = document.getElementById("permAlert");

  try {
    for (const role of roles) {
      const selectedPerms = [];
      PERMISSIONS_DEF.forEach((p) => {
        const cb = document.getElementById(`perm_${role}_${p.code}`);
        if (cb && cb.checked) {
          selectedPerms.push(p.code);
        }
      });

      await fetch(`${API_BASE}/permissions/update`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ role, permissions: selectedPerms }),
      });

      permissionsMap[role] = selectedPerms;
    }

    showAlert(
      alertBox,
      "🎉 Đã lưu cấu hình phân quyền thành công! Menu các vai trò đã được cập nhật.",
      "success",
    );
    updateRoleContext(); // Cập nhật lại Menu ngay lập tức
  } catch (err) {
    showAlert(alertBox, " Lỗi khi lưu cấu hình phân quyền!", "error");
  }
}
