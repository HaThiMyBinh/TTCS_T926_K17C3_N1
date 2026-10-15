const service = require("../services/documents.service");
const { HttpError } = require("../errors");

function sendError(res, err) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      success: false,
      message: err.message,
      error: err.message,
    });
  }
  console.error("[DOCUMENTS CONTROLLER]", err);
  return res.status(500).json({
    success: false,
    message: "Lỗi server, vui lòng thử lại sau!",
    error: "Lỗi server, vui lòng thử lại sau!",
  });
}

// GET /api/applications/me/documents
async function getMyDocuments(req, res) {
  try {
    const data = await service.listMyDocuments(req.user);
    res.json({
      success: true,
      message: "Lấy danh sách tài liệu thành công!",
      data,
    });
  } catch (err) {
    sendError(res, err);
  }
}

// POST /api/applications/me/documents
async function uploadMyDocument(req, res) {
  try {
    const { doc_type } = req.body || {};
    const result = await service.uploadDocument(req.user, {
      file: req.file,
      docType: doc_type,
    });
    res.status(200).json({
      success: true,
      message: result.message,
      data: result.document,
      progress: result.progress,
    });
  } catch (err) {
    sendError(res, err);
  }
}

// GET /api/applications/:id/documents/:docId/download
async function downloadDocument(req, res) {
  try {
    const { id, docId } = req.params;
    const { filePath, originalName, mimeType } = await service.downloadDocument(
      req.user,
      { applicationId: id, docId },
    );

    // Không cho trình duyệt đoán kiểu nội dung và không cache tài liệu cá nhân
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

    // ?disposition=inline: chỉ PDF được xem trực tiếp; DOC/DOCX luôn tải về (attachment)
    if (req.query.disposition === "inline" && mimeType === "application/pdf") {
      const ascii = originalName.replace(/[^\x20-\x7e]|["\\]/g, "_");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(originalName)}`,
      );
      return res.sendFile(filePath, onDone);
    }
    res.download(filePath, originalName, onDone);
  } catch (err) {
    sendError(res, err);
  }
}

// GET /api/applications/:id/documents (HR)
async function listApplicationDocuments(req, res) {
  try {
    const data = await service.listApplicationDocuments(req.params.id);
    res.json({
      success: true,
      message: "Lấy tài liệu hồ sơ thành công!",
      ...data,
    });
  } catch (err) {
    sendError(res, err);
  }
}

// DELETE /api/applications/me/documents/:docId
async function deleteMyDocument(req, res) {
  try {
    const { docId } = req.params;
    const result = await service.deleteMyDocument(req.user, docId);
    res.json({
      success: true,
      message: result.message,
      progress: result.progress,
    });
  } catch (err) {
    sendError(res, err);
  }
}

module.exports = {
  getMyDocuments,
  uploadMyDocument,
  downloadDocument,
  listApplicationDocuments,
  deleteMyDocument,
  sendError,
};
