const service = require("../services/mentorWorkload.service");
const { HttpError } = require("../errors");

function sendError(res, err) {
  if (err instanceof HttpError) {
    return res
      .status(err.status)
      .json({ success: false, message: err.message, error: err.message });
  }
  console.error("[MENTOR WORKLOAD CONTROLLER]", err);
  const message = "Lỗi server, vui lòng thử lại sau!";
  return res.status(500).json({ success: false, message, error: message });
}

// GET /api/mentors/workload
async function getWorkload(req, res) {
  try {
    const data = await service.getWorkloadReport();
    return res.json({
      success: true,
      message: "Lấy khối lượng công việc của mentor thành công!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

// GET /api/mentors/:id/interns
async function getMentorInterns(req, res) {
  try {
    const data = await service.getMentorInterns(req.params.id, req.query);
    return res.json({
      success: true,
      message: "Lấy danh sách thực tập sinh của mentor thành công!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = { getWorkload, getMentorInterns };
