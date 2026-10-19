const service = require("../services/internOriginReport.service");
const { NO_STORE } = require("../middleware/noStore");
const { makeEndpoint, sendError, makeXlsxEndpoint } = require("../utils/endpoint");
const endpoint = makeEndpoint("REPORT");

async function exportCsv(req, res) {
  try {
    const { filename, content } = await service.exportCsv(req.query);
    res.set("Cache-Control", NO_STORE);
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(`\uFEFF${content}`);
  } catch (err) {
    return sendError(res, err, "REPORT");
  }
}

module.exports = {
  xlsx: makeXlsxEndpoint("INTERNORIGINREPORT", (req) =>
    service.exportXlsx(req.query),
  ),
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
