const { sendError } = require("./endpoint");
const service = require("../services/applications.service");

async function list(req, res) {
  try {
    const data = await service.listApplications(req.user);
    res.json({
      success: true,
      message: "Lấy danh sách hồ sơ thành công!",
      data,
    });
  } catch (err) {
    sendError(res, err, "APPLICATIONS");
  }
}

async function updateStatus(req, res) {
  try {
    const { status, rejection_reason } = req.body || {};
    const result = await service.changeStatus(
      { id: req.params.id, status, rejection_reason },
      req.user,
    );
    res.json({ success: true, message: result.message, data: result.data });
  } catch (err) {
    sendError(res, err, "APPLICATIONS");
  }
}

module.exports = { list, updateStatus };
