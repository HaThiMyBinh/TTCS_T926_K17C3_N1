const service = require("../services/weeklyReports.service");
const { HttpError } = require("../errors");

function sendError(res, err) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      success: false,
      message: err.message,
      error: err.message,
    });
  }

  console.error("[WEEKLY REPORTS CONTROLLER]", err);
  return res.status(500).json({
    success: false,
    message: "Lỗi server, vui lòng thử lại sau!",
    error: "Lỗi server, vui lòng thử lại sau!",
  });
}

async function submitMyReport(req, res) {
  try {
    const data = await service.submitMyReport(req.user, req.body);
    return res.json({
      success: true,
      message: "Đã nộp báo cáo tuần!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function listMyReports(req, res) {
  try {
    const data = await service.listMyReports(req.user);
    return res.json({
      success: true,
      message: "Lấy danh sách báo cáo tuần thành công!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function getMyStatus(req, res) {
  try {
    const data = await service.getMyStatus(req.user);
    return res.json({
      success: true,
      message: "Lấy trạng thái nộp báo cáo tuần thành công!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function uploadMyReportAttachment(req, res) {
  try {
    const data = await service.uploadMyReportAttachment(
      req.user,
      req.params.id,
      req.file,
    );
    return res.status(201).json({
      success: true,
      message: "Đã đính kèm file vào báo cáo!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function deleteMyReportAttachment(req, res) {
  try {
    const data = await service.deleteMyReportAttachment(
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

// GET /weekly-reports/:id/attachments/:attachmentId/download
async function downloadReportAttachment(req, res) {
  try {
    const { filePath, originalName, mimeType } =
      await service.getReportAttachmentForDownload(
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

async function listReportsForMentor(req, res) {
  try {
    const data = await service.listReportsForMentor(req.user, req.query);
    return res.json({
      success: true,
      message: "Lấy báo cáo tuần thành công!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function getMentorOverview(req, res) {
  try {
    const data = await service.getMentorOverview(req.user, req.query);
    return res.json({
      success: true,
      message: "Lấy tổng quan nộp báo cáo tuần thành công!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function submitFeedback(req, res) {
  try {
    const data = await service.submitFeedback(
      req.user,
      req.params.id,
      req.body,
    );
    return res.json({
      success: true,
      message: "Đã lưu phản hồi cho thực tập sinh!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function deleteFeedback(req, res) {
  try {
    const data = await service.deleteFeedback(req.user, req.params.id);
    return res.json({
      success: true,
      message: "Đã xóa phản hồi!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = {
  submitMyReport,
  listMyReports,
  getMyStatus,
  uploadMyReportAttachment,
  deleteMyReportAttachment,
  downloadReportAttachment,
  listReportsForMentor,
  getMentorOverview,
  submitFeedback,
  deleteFeedback,
};
