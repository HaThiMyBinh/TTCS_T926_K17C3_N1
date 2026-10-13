const service = require("../services/allowances.service");
const { HttpError } = require("../errors");

function sendError(res, err) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      success: false,
      message: err.message,
      error: err.message,
    });
  }

  console.error("[ALLOWANCES CONTROLLER]", err);
  return res.status(500).json({
    success: false,
    message: "Lỗi server, vui lòng thử lại sau!",
    error: "Lỗi server, vui lòng thử lại sau!",
  });
}

async function createAllowance(req, res) {
  try {
    const data = await service.createAllowance(req.user, req.body);
    return res.status(201).json({
      success: true,
      message: "Đã ghi nhận phụ cấp cho thực tập sinh!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = { createAllowance };
