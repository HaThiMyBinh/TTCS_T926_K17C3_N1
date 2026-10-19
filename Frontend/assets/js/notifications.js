function startNotificationPolling() {
  if (notifTimer) return;
  loadNotifications();
  notifTimer = setInterval(() => {
    if (!document.hidden) loadNotifications();
  }, 45000);
}
function notifTimeAgo(sql) {
  const t = Date.parse(String(sql).replace(" ", "T") + "+07:00");
  if (!t) return "";
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (m < 1) return "Vừa xong";
  if (m < 60) return `${m} phút trước`;
  if (m < 1440) return `${Math.floor(m / 60)} giờ trước`;
  return `${Math.floor(m / 1440)} ngày trước`;
}
async function loadNotifications() {
  const result = await wrRequest("/notifications");
  if (!result || !result.res.ok) return;
  const data = (result.body && result.body.data) || {
    unread: 0,
    items: [],
  };
  if (!notifFirstLoad && data.unread > notifUnread)
    showToast("Bạn có thông báo mới.", "info");
  notifFirstLoad = false;
  notifUnread = data.unread;
  const badge = document.getElementById("notifBadge");
  badge.innerText = data.unread > 99 ? "99+" : String(data.unread);
  badge.classList.toggle("show", data.unread > 0);
  const list = document.getElementById("notifList");
  list.innerHTML = data.items.length
    ? data.items
        .map(
          (n) =>
            `<button class="notif-item ${n.isRead ? "" : "unread"}" onclick="openNotification(${Number(n.id)}, '${escapeHtml(n.targetTab || "")}')"><strong>${escapeHtml(n.title)}</strong><span>${escapeHtml(n.message)}</span><small>${escapeHtml(notifTimeAgo(n.createdAt))}</small></button>`,
        )
        .join("")
    : '<div class="notif-empty">Chưa có thông báo nào.</div>';
}
function toggleNotifications(event) {
  event.stopPropagation();
  document.getElementById("userMenuDropdown").classList.remove("open");
  const dd = document.getElementById("notifDropdown");
  dd.classList.toggle("open");
  if (dd.classList.contains("open")) loadNotifications();
}
async function openNotification(id, tab) {
  document.getElementById("notifDropdown").classList.remove("open");
  await wrRequest(`/notifications/${id}/read`, { method: "POST" });
  if (tab && document.getElementById(tab)) switchTab(tab);
  loadNotifications();
}
async function markAllNotificationsRead() {
  await wrRequest("/notifications/read-all", { method: "POST" });
  loadNotifications();
}
