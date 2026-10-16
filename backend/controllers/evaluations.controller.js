const { sendError } = require("./endpoint");
const service = require("../services/evaluations.service");

async function getOverview(req, res) {
  try {
    const data = await service.getMentorOverview(req.user);
    return res.json({
      success: true,
      message: "Lấy tổng quan đánh giá thực tập sinh thành công!",
      data,
    });
  } catch (err) {
    return sendError(res, err, "EVALUATIONS");
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
    return sendError(res, err, "EVALUATIONS");
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
    return sendError(res, err, "EVALUATIONS");
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
    return sendError(res, err, "EVALUATIONS");
  }
}

module.exports = {
  getOverview,
  getEvaluation,
  saveEvaluation,
  deleteEvaluation,
};
