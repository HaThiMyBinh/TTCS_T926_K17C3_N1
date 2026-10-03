const service = require("../services/contracts.service");
const { HttpError } = require("../errors");

function sendError(res, err) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      success: false,
      message: err.message,
      error: err.message,
    });
  }

  console.error("[CONTRACTS CONTROLLER]", err);
  return res.status(500).json({
    success: false,
    message: "Lỗi server, vui lòng thử lại sau!",
    error: "Lỗi server, vui lòng thử lại sau!",
  });
}

async function list(req, res) {
  try {
    const data = await service.list(req.params.id);
    return res.json({
      success: true,
      message: "Lấy danh sách hợp đồng thành công!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function listMine(req, res) {
  try {
    const data = await service.listForIntern(req.user);
    return res.json({ success: true, message: "Lấy danh sách hợp đồng thành công!", data });
  } catch (err) {
    return sendError(res, err);
  }
}

async function confirmMine(req, res) {
  try {
    const data = await service.confirmForIntern(req.user, req.params.contractId);
    return res.json({ success: true, message: "Bạn đã xác nhận hợp đồng thành công!", data });
  } catch (err) {
    return sendError(res, err);
  }
}

async function upload(req, res) {
  try {
    const data = await service.upload(req.params.id, req.user, {
      file: req.file,
      ...req.body,
    });
    return res.status(201).json({
      success: true,
      message: "Tải lên hợp đồng thành công!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function download(req, res) {
  try {
    const file = await service.getDownload(
      req.params.id,
      req.params.contractId,
    );

    return sendContractFile(req, res, file);
  } catch (err) {
    return sendError(res, err);
  }
}

async function downloadMine(req, res) {
  try {
    const file = await service.getDownloadForIntern(req.user, req.params.contractId);
    return sendContractFile(req, res, file);
  } catch (err) {
    return sendError(res, err);
  }
}

function sendContractFile(req, res, file) {
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");

  const onSendError = (err) => {
    if (err && !res.headersSent) {
      if (err.code === "ENOENT") {
        return sendError(
          res,
          new HttpError(404, "File hợp đồng không còn trên máy chủ. Vui lòng liên hệ HR để được hỗ trợ!"),
        );
      }
      sendError(res, new HttpError(500, "Lỗi khi truyền file về trình duyệt!"));
    }
  };

  const canDisplayInline = req.query.disposition === "inline" && file.mimeType === "application/pdf";
  if (canDisplayInline) {
    const asciiName = file.originalName.replace(/[^ -~]|["\\]/g, "_");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    );
    return res.sendFile(file.filePath, onSendError);
  }
  return res.download(file.filePath, file.originalName, onSendError);
}

async function remove(req, res) {
  try {
    await service.remove(req.params.id, req.params.contractId);
    return res.json({
      success: true,
      message: "Đã xóa hợp đồng!",
      data: null,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = { list, listMine, upload, download, downloadMine, confirmMine, remove, sendError };
