const service = require("../services/attendanceReport.service");
const { makeEndpoint, sendError } = require("./endpoint");
const endpoint = makeEndpoint("ATTENDANCE_REPORT");

async function exportCsv(req, res) {
  try {
    const { filename, content } = await service.exportCsv(req.query);
    res.set("Cache-Control", "private, no-store");
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(`\uFEFF${content}`);
  } catch (err) {
    return sendError(res, err, "ATTENDANCE_REPORT");
  }
}
module.exports = {
  report: endpoint((req) => service.report(req.query), "Lấy báo cáo chuyên cần thành công!"),
  detail: endpoint((req) => service.detail(req.params.id, req.query), "Lấy chi tiết chuyên cần thành công!"),
  exportCsv,
};
