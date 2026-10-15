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

  console.error("[ALLOWANCES]", err);
  return res.status(500).json({
    success: false,
    message: "Lỗi server, vui lòng thử lại sau!",
    error: "Lỗi server, vui lòng thử lại sau!",
  });
}

async function overview(req, res) {
  try {
    const data = await service.overview(req.query);
    return res.json({ success: true, message: "Lấy tổng quan phụ cấp thành công!", data });
  } catch (err) {
    return sendError(res, err);
  }
}

async function list(req, res) {
  try {
    const data = await service.listForIntern(req.params.id);
    return res.json({ success: true, message: "Lấy danh sách phụ cấp thành công!", data });
  } catch (err) {
    return sendError(res, err);
  }
}

async function create(req, res) {
  try {
    const data = await service.create(req.user, req.params.id, req.body);
    return res.status(201).json({ success: true, message: "Đã thêm khoản phụ cấp!", data });
  } catch (err) {
    return sendError(res, err);
  }
}

async function update(req, res) {
  try {
    const data = await service.update(req.user, req.params.id, req.params.allowanceId, req.body);
    return res.json({ success: true, message: "Đã cập nhật khoản phụ cấp!", data });
  } catch (err) {
    return sendError(res, err);
  }
}

async function remove(req, res) {
  try {
    const data = await service.remove(req.params.id, req.params.allowanceId);
    return res.json({ success: true, message: "Đã xóa khoản phụ cấp!", data });
  } catch (err) {
    return sendError(res, err);
  }
}

async function listMine(req, res) {
  try {
    const data = await service.listMine(req.user, req.query);
    return res.json({ success: true, message: "Lấy lịch sử phụ cấp thành công!", data });
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = { overview, list, create, update, remove, listMine };
