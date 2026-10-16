const service = require("../services/internSchoolStats.service");
const { HttpError } = require("../errors");

function sendError(res, err) {
  if (err instanceof HttpError) {
    return res
      .status(err.status)
      .json({ success: false, message: err.message, error: err.message });
  }
  console.error("[INTERN SCHOOL STATS CONTROLLER]", err);
  const message = "Lỗi server, vui lòng thử lại sau!";
  return res.status(500).json({ success: false, message, error: message });
}

// GET /api/interns/stats/school?university=&major=
async function getSchoolStats(req, res) {
  try {
    const data = await service.getSchoolStatsReport(req.query);
    return res.json({
      success: true,
      message: "Lấy thống kê thực tập sinh theo trường/ngành thành công!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = { getSchoolStats };
