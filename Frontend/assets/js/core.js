const API_BASE = "/api";

// Mọi ngày/giờ hiển thị và "hôm nay" đều theo giờ Việt Nam, không phụ thuộc múi giờ trình duyệt.
const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";
const vnPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: VN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

// =========================================================================
// XÁC THỰC (JWT)
// =========================================================================
function getAuthToken() {
  return sessionStorage.getItem("authToken") || "";
}

// Trả về headers có kèm Authorization Bearer token, dùng cho mọi request
// gọi tới API cần đăng nhập.
function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${getAuthToken()}`, ...extra };
}

// Xóa phiên đăng nhập & quay lại trang login (dùng khi logout hoặc khi
// token hết hạn / không hợp lệ).
function forceLogout(message) {
  sessionStorage.removeItem("currentUser");
  sessionStorage.removeItem("authToken");
  // Trang đăng nhập sẽ hiển thị thông báo này (toast sẽ mất khi chuyển trang).
  if (message) sessionStorage.setItem("flashMessage", message);
  window.location.href = "login.html";
}

// =========================================================================
//  TIỆN ÍCH CHUNG (escape HTML, ngày giờ VN, toast, định dạng)
// =========================================================================
function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[ch],
  );
}

function getVietnamParts(value = new Date()) {
  return Object.fromEntries(
    vnPartsFormatter
      .formatToParts(value)
      .map(({ type, value: part }) => [type, part]),
  );
}

// Ngày hiện tại theo giờ Việt Nam, dạng YYYY-MM-DD.
function getVietnamToday() {
  const p = getVietnamParts();
  return `${p.year}-${p.month}-${p.day}`;
}

// Đọc thông điệp lỗi từ phản hồi API; dùng mặc định nếu body không phải JSON.
async function readErrorMessage(res, fallback) {
  try {
    const body = await res.json();
    return body.error || body.message || fallback;
  } catch (err) {
    return fallback;
  }
}

function showToast(message, type = "success") {
  const box = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  const icon =
    type === "error"
      ? "fa-circle-exclamation"
      : type === "info"
        ? "fa-circle-info"
        : "fa-circle-check";
  el.innerHTML = `<i class="fa-solid ${icon}"></i><span></span>`;
  el.querySelector("span").textContent = message;
  box.appendChild(el);
  // Lỗi cần thời gian đọc lâu hơn thông báo thành công.
  setTimeout(() => el.remove(), type === "error" ? 7000 : 4000);
}

function formatFileSize(bytes) {
  const size = Number(bytes);
  if (isNaN(size) || size <= 0) return "0 B";
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
  return (size / (1024 * 1024)).toFixed(2) + " MB";
}

function formatDateTime(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const p = getVietnamParts(d);
  return `${p.hour}:${p.minute} ${p.day}/${p.month}/${p.year}`;
}

function formatDateOnly(dateValue) {
  if (!dateValue) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue));
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return String(dateValue);
  const p = getVietnamParts(date);
  return `${p.day}/${p.month}/${p.year}`;
}
