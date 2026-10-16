const service = require("../services/finalReports.service");
const { makeEndpoint, sendError } = require("./endpoint");
const endpoint = makeEndpoint("FINALREPORTS");
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
      return sendError(res, err, "FINALREPORTS");
    }
  },
};
