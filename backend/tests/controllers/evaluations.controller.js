const service = require("../services/evaluations.service");
const { HttpError } = require("../errors");

function sendError(res, err) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      success: false,
      message: err.message,
      error: err.message,
    });
  }

  console.error("[EVALUATIONS CONTROLLER]", err);
  return res.status(500).json({
    success: false,
    message: "Lỗi server, vui lòng thử lại sau!",
    error: "Lỗi server, vui lòng thử lại sau!",
  });
}

async function getOverview(req, res) {
  try {
    const data = await service.getMentorOverview(req.user);
    return res.json({
      success: true,
      message: "Lấy tổng quan đánh giá thực tập sinh thành công!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function getEvaluation(req, res) {
  try {
    const data = await service.getEvaluation(req.user, req.params.id);
    return res.json({
      success: true,
      message: data
        ? "Lấy đánh giá thành công!"
        : "Thực tập sinh này chưa được đánh giá!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function saveEvaluation(req, res) {
  try {
    const data = await service.saveEvaluation(
      req.user,
      req.params.id,
      req.body,
    );
    return res.json({
      success: true,
      message: "Đã lưu đánh giá thực tập sinh!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function deleteEvaluation(req, res) {
  try {
    const data = await service.deleteEvaluation(req.user, req.params.id);
    return res.json({
      success: true,
      message: "Đã xóa đánh giá!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = { getOverview, getEvaluation, saveEvaluation, deleteEvaluation };
