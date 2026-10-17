const service = require("../services/completionRate.service");
const { makeEndpoint, sendError } = require("./endpoint");
const endpoint = makeEndpoint("COMPLETION_REPORT");
async function exportCsv(req, res) {
  try {
    const { filename, content } = await service.exportCsv(req.query);
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(content);
  } catch (err) {
    return sendError(res, err, "COMPLETION_REPORT");
  }
}
module.exports = {
  report: endpoint(
    (req) => service.report(req.query),
    "Lấy tỷ lệ hoàn thành thành công!",
  ),
  interns: endpoint(
    (req) => service.interns(req.query),
    "Lấy danh sách thực tập sinh thành công!",
  ),
  exportCsv,
};
