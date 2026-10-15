const service = require("../services/supportRequests.service");
const { makeEndpoint } = require("./endpoint");
const endpoint = makeEndpoint("SUPPORT");

module.exports = {
  create: endpoint(
    (req) => service.createSupportRequest(req.user, req.body),
    "Đã gửi yêu cầu hỗ trợ! Yêu cầu đang ở trạng thái chờ xử lý.",
    201,
  ),
};
