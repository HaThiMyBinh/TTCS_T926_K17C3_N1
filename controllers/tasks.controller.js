const service = require("../services/tasks.service");
const { HttpError } = require("../errors");

function sendError(res, err) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      success: false,
      message: err.message,
      error: err.message,
    });
  }

  console.error("[TASKS CONTROLLER]", err);
  return res.status(500).json({
    success: false,
    message: "Lỗi server, vui lòng thử lại sau!",
    error: "Lỗi server, vui lòng thử lại sau!",
  });
}

async function createTask(req, res) {
  try {
    const data = await service.createTask(req.user, req.body);
    return res.status(201).json({
      success: true,
      message: "Đã giao nhiệm vụ cho thực tập sinh!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function listTasks(req, res) {
  try {
    const data = await service.listTasksForMentor(req.user, req.query);
    return res.json({
      success: true,
      message: "Lấy danh sách nhiệm vụ thành công!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function updateTask(req, res) {
  try {
    const data = await service.updateTask(req.user, req.params.id, req.body);
    return res.json({
      success: true,
      message: "Đã cập nhật nhiệm vụ!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function deleteTask(req, res) {
  try {
    const data = await service.deleteTask(req.user, req.params.id);
    return res.json({
      success: true,
      message: "Đã xóa nhiệm vụ!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function getMyTasks(req, res) {
  try {
    const data = await service.listTasksForInternUser(req.user);
    return res.json({
      success: true,
      message: "Lấy nhiệm vụ của tôi thành công!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = { createTask, listTasks, updateTask, deleteTask, getMyTasks };
