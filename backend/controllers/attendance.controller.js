const service = require("../services/attendance.service");
const { HttpError } = require("../errors");
function sendError(res, err) {
  if (err instanceof HttpError)
    return res.status(err.status).json({
      success: false,
      message: err.message,
      error: err.message,
    });
  console.error("[ATTENDANCE]", err);
  return res.status(500).json({
    success: false,
    message: "Lỗi server, vui lòng thử lại sau!",
    error: "Lỗi server, vui lòng thử lại sau!",
  });
}
function endpoint(fn, message) {
  return async (req, res) => {
    try {
      const data = await fn(req);
      res.set("Cache-Control", "private, no-store");
      return res.json({
        success: true,
        message,
        data,
      });
    } catch (err) {
      return sendError(res, err);
    }
  };
}
module.exports = {
  today: endpoint(
    (req) => service.getToday(req.user),
    "Lấy trạng thái chấm công hôm nay thành công!",
  ),
  history: endpoint(
    (req) => service.getHistory(req.user, req.query),
    "Lấy lịch sử chấm công thành công!",
  ),
  checkIn: endpoint(
    (req) => service.checkIn(req.user, req.body),
    "Check-in thành công!",
  ),
  checkOut: endpoint(
    (req) => service.checkOut(req.user, req.body),
    "Check-out thành công!",
  ),
  requestCorrection: endpoint(
    (req) => service.requestCorrection(req.user, req.params.id, req.body),
    "Đã gửi đề nghị bổ sung check-out, vui lòng chờ duyệt!",
  ),
  internAttendance: endpoint(
    (req) => service.getInternAttendance(req.user, req.params.id, req.query),
    "Lấy chấm công của thực tập sinh thành công!",
  ),
  pendingCorrections: endpoint(
    (req) => service.listPendingCorrections(req.user),
    "Lấy danh sách đề nghị bổ sung chờ duyệt thành công!",
  ),
  reviewCorrection: endpoint(
    (req) => service.reviewCorrection(req.user, req.params.id, req.body),
    "Đã xử lý đề nghị bổ sung check-out!",
  ),
};
