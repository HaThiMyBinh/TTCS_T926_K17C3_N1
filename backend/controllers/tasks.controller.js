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

async function updateMyTaskProgress(req, res) {
  try {
    const data = await service.updateMyTaskProgress(
      req.user,
      req.params.id,
      req.body,
    );
    return res.json({
      success: true,
      message: "Đã cập nhật tiến độ công việc!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function uploadMyTaskAttachment(req, res) {
  try {
    const data = await service.uploadMyTaskAttachment(
      req.user,
      req.params.id,
      req.file,
    );
    return res.status(201).json({
      success: true,
      message: "Đã đính kèm file vào nhiệm vụ!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function deleteMyTaskAttachment(req, res) {
  try {
    const data = await service.deleteMyTaskAttachment(
      req.user,
      req.params.id,
      req.params.attachmentId,
    );
    return res.json({
      success: true,
      message: "Đã xóa tệp đính kèm!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

// GET /tasks/:id/attachments/:attachmentId/download (Intern chủ nhiệm vụ hoặc Mentor phụ trách)
async function downloadTaskAttachment(req, res) {
  try {
    const { filePath, originalName, mimeType } =
      await service.getTaskAttachmentForDownload(
        req.user,
        req.params.id,
        req.params.attachmentId,
      );

    res.setHeader("Content-Type", mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");

    const onDone = (err) => {
      if (err && !res.headersSent) {
        sendError(
          res,
          new HttpError(500, "Lỗi khi truyền file về trình duyệt!"),
        );
      }
    };

    // ?disposition=inline: chỉ ảnh/PDF được xem trực tiếp; loại khác luôn tải về.
    if (
      req.query.disposition === "inline" &&
      service.INLINE_MIME_TYPES.includes(mimeType)
    ) {
      const ascii = originalName.replace(/[^\x20-\x7e]|["\\]/g, "_");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(originalName)}`,
      );
      return res.sendFile(filePath, onDone);
    }
    return res.download(filePath, originalName, onDone);
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = {
  createTask,
  listTasks,
  updateTask,
  deleteTask,
  getMyTasks,
  updateMyTaskProgress,
  uploadMyTaskAttachment,
  deleteMyTaskAttachment,
  downloadTaskAttachment,
};
