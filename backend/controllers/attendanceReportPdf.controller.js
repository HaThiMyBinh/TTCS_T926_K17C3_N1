const service = require("../services/attendanceReportPdf.service");
const { sendError } = require("./endpoint");

async function exportPdf(req, res) {
  try {
    const { filename, content } = await service.exportPdf(req.query);

    res.set("Cache-Control", "private, no-store");
    res.set("Content-Type", "application/pdf");

    res.set(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );

    return res.send(content);
  } catch (err) {
    return sendError(res, err, "ATTENDANCE_REPORT_PDF");
  }
}

module.exports = {
  exportPdf,
};