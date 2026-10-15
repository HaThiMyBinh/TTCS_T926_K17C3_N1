const service = require("../services/attendance.service");
const { HttpError } = require("../errors");

function sendError(res, err) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      success: false,
      message: err.message,
      error: err.message,
    });
  }

  console.error("[ATTENDANCE CONTROLLER]", err);
  return res.status(500).json({
    success: false,
    message: "Lỗi server, vui lòng thử lại sau!",
    error: "Lỗi server, vui lòng thử lại sau!",
  });
}

async function checkIn(req, res) {
  try {
    const data = await service.checkIn(req.user);
    const message = data.is_late
      ? "Check-in thành công (đi muộn)!"
      : "Check-in thành công!";
    return res.status(201).json({ success: true, message, data });
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = { checkIn };
