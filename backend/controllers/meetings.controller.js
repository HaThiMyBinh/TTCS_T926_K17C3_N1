const service = require("../services/meetings.service");
const { makeEndpoint } = require("../utils/endpoint");
const endpoint = makeEndpoint("MEETINGS");
module.exports = {
  list: endpoint(
    (req) => service.list(req.user, req.query),
    "Lấy lịch họp thành công!",
  ),
  detail: endpoint(
    (req) => service.detail(req.user, req.params.id),
    "Lấy chi tiết cuộc họp thành công!",
  ),
  options: endpoint(
    (req) => service.options(req.user, req.query),
    "Lấy người tham dự thành công!",
  ),
  create: endpoint(
    (req) => service.save(req.user, null, req.body),
    "Đã tạo lịch họp và xếp hàng email!",
    201,
  ),
  update: endpoint(
    (req) => service.save(req.user, req.params.id, req.body),
    "Đã cập nhật lịch họp!",
  ),
  cancel: endpoint(
    (req) => service.save(req.user, req.params.id, req.body, true),
    "Đã hủy lịch họp!",
  ),
  retry: endpoint(
    (req) => service.retry(req.user, req.params.id, req.params.logId),
    "Đã yêu cầu gửi lại email!",
  ),
};
