const service = require("../services/notifications.service");
const { makeEndpoint } = require("../utils/endpoint");
const endpoint = makeEndpoint("NOTIFY");

module.exports = {
  list: endpoint((req) => service.list(req.user), "Lấy thông báo thành công!"),
  markRead: endpoint(
    (req) => service.markRead(req.user, req.params.id),
    "Đã đánh dấu đã đọc!",
  ),
  markAllRead: endpoint(
    (req) => service.markAllRead(req.user),
    "Đã đánh dấu tất cả đã đọc!",
  ),
};
