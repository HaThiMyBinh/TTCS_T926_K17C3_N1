const service = require("../services/leaves.service");
const { makeEndpoint } = require("./endpoint");
const endpoint = makeEndpoint("LEAVE");

module.exports = {
  mine: endpoint((req) => service.mine(req.user), "Lấy đơn nghỉ của bạn thành công!"),
  submit: endpoint((req) => service.submit(req.user, req.body), "Đã gửi đơn nghỉ!", 201),
  cancel: endpoint((req) => service.cancel(req.user, req.params.id), "Đã hủy đơn nghỉ!"),
  pending: endpoint((req) => service.pending(req.user), "Lấy đơn nghỉ chờ duyệt thành công!"),
  list: endpoint((req) => service.list(req.query), "Lấy danh sách đơn nghỉ thành công!"),
  review: endpoint((req) => service.review(req.user, req.params.id, req.body), "Đã xử lý đơn nghỉ!"),
};
