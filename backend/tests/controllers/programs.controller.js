const service = require("../services/programs.service");
const { HttpError } = require("../errors");

function sendError(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error("[PROGRAMS]", err);

  const message =
    status === 500 ? "Lỗi server, vui lòng thử lại sau!" : err.message;
  return res.status(status).json({
    success: false,
    message,
    error: message,
  });
}

async function run(res, work, message, status = 200) {
  try {
    return res.status(status).json({
      success: true,
      message,
      data: await work(),
    });
  } catch (err) {
    return sendError(res, err);
  }
}

function departments(req, res) {
  return run(
    res,
    () => service.departments(),
    "Lấy danh sách phòng ban thành công!",
  );
}

function addDepartment(req, res) {
  return run(
    res,
    () => service.addDepartment(req.body),
    "Thêm phòng ban thành công!",
    201,
  );
}

async function removeDepartment(req, res) {
  try {
    await service.removeDepartment(req.params.id);
    return res.json({
      success: true,
      message: "Đã xóa phòng ban!",
      data: null,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

function list(req, res) {
  return run(
    res,
    () => service.list(req.query),
    "Lấy danh sách chương trình thành công!",
  );
}

function get(req, res) {
  return run(
    res,
    () => service.get(req.params.id),
    "Lấy chương trình thành công!",
  );
}

function interns(req, res) {
  return run(
    res,
    () => service.listInterns(req.params.id),
    "Lấy thực tập sinh của chương trình thành công!",
  );
}

function availableInterns(req, res) {
  return run(res, () => service.listAvailableInterns(req.params.id), "Lấy thực tập sinh chưa thuộc chương trình thành công!");
}

function addInterns(req, res) {
  return run(res, () => service.addInterns(req.params.id, req.body, req.user), "Đã thêm thực tập sinh vào chương trình!", 201);
}

function removeIntern(req, res) {
  return run(res, () => service.removeIntern(req.params.id, req.params.internId), "Đã gỡ thực tập sinh khỏi chương trình!");
}

function assignMentor(req, res) {
  return run(
    res,
    () => service.assignMentor(req.params.id, req.body),
    "Cập nhật phân công mentor cho chương trình thành công!",
  );
}

function create(req, res) {
  return run(
    res,
    () => service.create(req.body, req.user),
    "Tạo chương trình thực tập thành công!",
    201,
  );
}

function update(req, res) {
  return run(
    res,
    () => service.update(req.params.id, req.body),
    "Cập nhật chương trình thành công!",
  );
}

async function remove(req, res) {
  try {
    await service.remove(req.params.id);
    return res.json({
      success: true,
      message: "Đã xóa chương trình thực tập!",
      data: null,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = {
  departments,
  addDepartment,
  removeDepartment,
  list,
  get,
  interns,
  availableInterns,
  addInterns,
  removeIntern,
  assignMentor,
  create,
  update,
  remove,
};
