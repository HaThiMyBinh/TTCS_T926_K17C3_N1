const service = require("../services/reportExport.service");
const { sendError } = require("./endpoint");

// GET /api/reports/export/excel?from=&to=&scope_type=&scope_value=&university=&major=
async function exportExcel(req, res) {
  try {
    const { filename, contentType, buffer } = await service.exportExcel(req.query);
    res.set("Cache-Control", "private, no-store");
    res.set("Content-Type", contentType);
    res.set("Content-Disposition", `attachment; filename="${filename}"`);
    res.set("Content-Length", String(buffer.length));
    return res.send(buffer);
  } catch (err) {
    return sendError(res, err, "REPORT_EXPORT");
  }
}

module.exports = { exportExcel };
