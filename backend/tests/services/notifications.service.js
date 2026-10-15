// Thông báo trong app (chuông): mỗi dòng thuộc về một tài khoản; chỉ chủ sở hữu mới đọc/đánh dấu được.
const db = require("../db");
const { HttpError } = require("../errors");

function parseId(value) {
  if (!/^[1-9]\d*$/.test(String(value))) throw new HttpError(400, "ID thông báo không hợp lệ!");
  return Number(value);
}
async function list(user) {
  const [items, unread] = await Promise.all([db.listNotifications(user.id), db.countUnreadNotifications(user.id)]);
  return { unread, items };
}
async function markRead(user, rawId) {
  if (!(await db.markNotificationRead(parseId(rawId), user.id))) throw new HttpError(404, "Không tìm thấy thông báo!");
  return null;
}
async function markAllRead(user) {
  return { updated: await db.markAllNotificationsRead(user.id) };
}
// Tạo thông báo cho nhiều tài khoản; không bao giờ ném lỗi để không làm hỏng nghiệp vụ chính.
async function pushSafe(userIds, payload) {
  try {
    return await db.createNotifications(userIds, payload);
  } catch (err) {
    console.error("[NOTIFY] Không tạo được thông báo:", err.message);
    return 0;
  }
}
module.exports = { list, markRead, markAllRead, pushSafe };
