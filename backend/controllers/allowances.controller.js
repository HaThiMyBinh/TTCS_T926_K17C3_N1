const { sendError } = require("./endpoint");
const service = require("../services/allowances.service");

async function overview(req, res) {
  try {
    const data = await service.overview(req.query);
    return res.json({
      success: true,
      message: "Lấy tổng quan phụ cấp thành công!",
      data,
    });
  } catch (err) {
    return sendError(res, err, "ALLOWANCES");
  }
}

async function list(req, res) {
  try {
    const data = await service.listForIntern(req.params.id);
    return res.json({
      success: true,
      message: "Lấy danh sách phụ cấp thành công!",
      data,
    });
  } catch (err) {
    return sendError(res, err, "ALLOWANCES");
  }
}

async function create(req, res) {
  try {
    const data = await service.create(req.user, req.params.id, req.body);
    return res
      .status(201)
      .json({ success: true, message: "Đã thêm khoản phụ cấp!", data });
  } catch (err) {
    return sendError(res, err, "ALLOWANCES");
  }
}

async function update(req, res) {
  try {
    const data = await service.update(
      req.user,
      req.params.id,
      req.params.allowanceId,
      req.body,
    );
    return res.json({
      success: true,
      message: "Đã cập nhật khoản phụ cấp!",
      data,
    });
  } catch (err) {
    return sendError(res, err, "ALLOWANCES");
  }
}

async function remove(req, res) {
  try {
    const data = await service.remove(req.params.id, req.params.allowanceId);
    return res.json({ success: true, message: "Đã xóa khoản phụ cấp!", data });
  } catch (err) {
    return sendError(res, err, "ALLOWANCES");
  }
}

async function listMine(req, res) {
  try {
    const data = await service.listMine(req.user, req.query);
    return res.json({
      success: true,
      message: "Lấy lịch sử phụ cấp thành công!",
      data,
    });
  } catch (err) {
    return sendError(res, err, "ALLOWANCES");
  }
}

module.exports = { overview, list, create, update, remove, listMine };
