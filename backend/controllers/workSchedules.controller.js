const service = require("../services/workSchedules.service");
const { HttpError } = require("../errors");

function sendError(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error("[WORK SCHEDULES]", err);

  const message =
    status === 500 ? "Lỗi server, vui lòng thử lại sau!" : err.message;
  return res.status(status).json({ success: false, message, error: message });
}

async function run(res, work, message, status = 200) {
  try {
    return res
      .status(status)
      .json({ success: true, message, data: await work() });
  } catch (err) {
    return sendError(res, err);
  }
}

const list = (req, res) =>
  run(
    res,
    () => service.list(req.query),
    "Lấy danh sách lịch làm việc thành công!",
  );

const get = (req, res) =>
  run(
    res,
    () => service.get(req.params.id),
    "Lấy lịch làm việc thành công!",
  );

const create = (req, res) =>
  run(
    res,
    () => service.create(req.body, req.user),
    "Tạo lịch làm việc thành công!",
    201,
  );

const update = (req, res) =>
  run(
    res,
    () => service.update(req.params.id, req.body),
    "Cập nhật lịch làm việc thành công!",
  );

async function remove(req, res) {
  try {
    await service.remove(req.params.id);
    return res.json({
      success: true,
      message: "Đã xóa lịch làm việc!",
      data: null,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = { list, get, create, update, remove };
