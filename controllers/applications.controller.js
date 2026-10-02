const service = require("../services/applications.service");
const { HttpError } = require("../errors");

function sendError(res, err) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  console.error("[APPLICATIONS]", err);
  return res
    .status(500)
    .json({ success: false, message: "Lỗi server, vui lòng thử lại sau!" });
}

async function list(req, res) {
  try {
    const data = await service.listApplications(req.user);
    res.json({ success: true, message: "Lấy danh sách hồ sơ thành công!", data });
  } catch (err) {
    sendError(res, err);
  }
}

async function updateStatus(req, res) {
  try {
    const { status, rejection_reason, require_documents } = req.body || {};
    const result = await service.changeStatus(
      { id: req.params.id, status, rejection_reason, require_documents },
      req.user,
    );
    res.json({ success: true, message: result.message, data: result.data });
  } catch (err) {
    sendError(res, err);
  }
}

module.exports = { list, updateStatus };
