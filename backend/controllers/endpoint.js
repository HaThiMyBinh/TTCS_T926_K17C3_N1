// Bọc một hàm xử lý thành handler Express: trả { success, message, data }, dữ liệu cá nhân không cache,
// lỗi HttpError trả đúng mã, lỗi khác trả 500 và ghi log (không lộ chi tiết cho client).
const { HttpError, publicError } = require("../errors");
const { renderXlsx, filenames, MIME } = require("../services/export/xlsx");

function sendError(res, err, tag) {
  const failure = publicError(err, "Lỗi server, vui lòng thử lại sau!", tag);
  return res.status(failure.status).json({
    ...failure.extra,
    success: false,
    message: failure.message,
    error: failure.message,
  });
}
function makeEndpoint(tag) {
  return function endpoint(fn, message, status = 200) {
    return async (req, res) => {
      try {
        const data = await fn(req);
        res.set("Cache-Control", "private, no-store");
        return res.status(status).json({ success: true, message, data });
      } catch (err) {
        return sendError(res, err, tag);
      }
    };
  };
}
function makeXlsxEndpoint(tag, modelForRequest) {
  return async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    try {
      if (
        Object.values(req.query || {}).some(
          (value) => typeof value !== "string",
        )
      ) {
        throw new HttpError(400, "Tham số xuất không hợp lệ hoặc bị lặp!");
      }
      const model = await modelForRequest(req);
      const content = await renderXlsx(model);
      const names = filenames(model);
      res.set("Content-Type", MIME);
      res.set(
        "Content-Disposition",
        `attachment; filename="${names.ascii}"; filename*=UTF-8''${encodeURIComponent(names.unicode).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      );
      return res.send(content);
    } catch (err) {
      return sendError(res, err, tag);
    }
  };
}
module.exports = { makeEndpoint, sendError, makeXlsxEndpoint };
