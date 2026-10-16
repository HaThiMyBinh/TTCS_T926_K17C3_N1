const service = require("../services/internOriginReport.service");
const { makeEndpoint, sendError } = require("./endpoint");
const endpoint = makeEndpoint("REPORT");

async function exportCsv(req, res) {
  try {
    const { filename, content } = await service.exportCsv(req.query);
    res.set("Cache-Control", "private, no-store");
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(`\uFEFF${content}`);
  } catch (err) {
    return sendError(res, err, "REPORT");
  }
}

module.exports = {
  report: endpoint(
    (req) => service.report(req.query),
    "Lấy thống kê thực tập sinh theo trường / ngành thành công!",
  ),
  interns: endpoint(
    (req) => service.interns(req.query),
    "Lấy danh sách thực tập sinh thành công!",
  ),
  exportCsv,
};
