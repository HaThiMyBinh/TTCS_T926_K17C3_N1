const service = require("../services/finalReports.service");
const { HttpError } = require("../errors");
function sendError(res, err) {
  if (err instanceof HttpError)
    return res.status(err.status).json({
      success: false,
      message: err.message,
      error: err.message,
      ...(err.code ? { code: err.code, details: err.details } : {}),
    });
  console.error("[FINAL REPORTS]", err);
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
  preview: endpoint(
    (req) => service.preview(req.query),
    "Xem trước báo cáo thành công!",
  ),
  list: endpoint(
    (req) => service.list(req.query),
    "Lấy danh sách báo cáo thành công!",
  ),
  create: endpoint(
    (req) => service.create(req.user, req.body),
    "Tạo bản nháp báo cáo thành công!",
  ),
  detail: endpoint(
    (req) => service.detail(req.params.id),
    "Lấy chi tiết báo cáo thành công!",
  ),
  update: endpoint(
    (req) => service.update(req.params.id, req.body),
    "Cập nhật báo cáo thành công!",
  ),
  finalize: endpoint(
    (req) => service.finalize(req.params.id, req.user, req.body),
    "Chốt báo cáo thành công!",
  ),
  send: endpoint(
    (req) => service.sendByEmail(req.params.id, req.body, req.user),
    "Đã gửi báo cáo qua email!",
  ),
  recipients: endpoint(
    (req) => service.listRecipients(req.query),
    "Lấy danh sách người nhận thành công!",
  ),
  removeRecipient: endpoint(
    (req) => service.removeRecipient(req.params.id),
    "Đã xóa người nhận khỏi danh sách gợi ý!",
  ),
  remove: endpoint(
    (req) => service.remove(req.params.id),
    "Xóa bản nháp thành công!",
  ),
  csv: async (req, res) => {
    try {
      const result = await service.exportCsv(req.params.id);
      res.set("Cache-Control", "private, no-store");
      res.set("Content-Type", "text/csv; charset=utf-8");
      res.set(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
      );
      return res.send(result.content);
    } catch (err) {
      return sendError(res, err);
    }
  },
};
