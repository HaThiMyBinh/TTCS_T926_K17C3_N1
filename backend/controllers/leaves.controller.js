const service = require("../services/leaves.service");
const { HttpError } = require("../errors");
function sendError(res, err) {
  if (err instanceof HttpError)
    return res.status(err.status).json({
      success: false,
      message: err.message,
      error: err.message,
    });
  console.error("[LEAVES]", err);
  return res.status(500).json({
    success: false,
    message: "Lỗi server, vui lòng thử lại sau!",
    error: "Lỗi server, vui lòng thử lại sau!",
  });
}
function endpoint(fn, message, status = 200) {
  return async (req, res) => {
    try {
      const data = await fn(req);
      res.set("Cache-Control", "private, no-store");
      return res.status(status).json({ success: true, message, data });
    } catch (err) {
      return sendError(res, err);
    }
  };
}
module.exports = {
  create: endpoint(
    (req) => service.createLeave(req.user, req.body),
    "Đã gửi đơn xin nghỉ, vui lòng chờ duyệt!",
    201,
  ),
  mine: endpoint(
    (req) => service.listMyLeaves(req.user, req.query),
    "Lấy danh sách đơn nghỉ của bạn thành công!",
  ),
  cancel: endpoint(
    (req) => service.cancelLeave(req.user, req.params.id),
    "Đã hủy đơn xin nghỉ!",
  ),
  list: endpoint(
    (req) => service.listLeaves(req.user, req.query),
    "Lấy danh sách đơn nghỉ thành công!",
  ),
  pending: endpoint(
    (req) => service.listPendingLeaves(req.user, req.query),
    "Lấy danh sách đơn nghỉ chờ duyệt thành công!",
  ),
  review: endpoint(
    (req) => service.reviewLeave(req.user, req.params.id, req.body),
    "Đã xử lý đơn xin nghỉ!",
  ),
};
