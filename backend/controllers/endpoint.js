// Bọc một hàm xử lý thành handler Express: trả { success, message, data }, dữ liệu cá nhân không cache,
// lỗi HttpError trả đúng mã, lỗi khác trả 500 và ghi log (không lộ chi tiết cho client).
const { HttpError } = require("../errors");

function sendError(res, err, tag) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ success: false, message: err.message, error: err.message });
  }
  console.error(`[${tag}]`, err);
  const message = "Lỗi server, vui lòng thử lại sau!";
  return res.status(500).json({ success: false, message, error: message });
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
module.exports = { makeEndpoint, sendError };
