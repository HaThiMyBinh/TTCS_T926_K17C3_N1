const service = require("../services/attendance.service");
const { makeEndpoint } = require("./endpoint");
const endpoint = makeEndpoint("ATTENDANCE");
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
