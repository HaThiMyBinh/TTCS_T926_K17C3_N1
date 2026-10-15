const service = require("../services/supportRequests.service");
const { makeEndpoint } = require("./endpoint");
const endpoint = makeEndpoint("SUPPORT_REQUESTS");
module.exports = {
  mine: endpoint(
    (req) => service.mine(req.user, req.query),
    "Lay danh sach yeu cau ho tro thanh cong!"
  ),
};
