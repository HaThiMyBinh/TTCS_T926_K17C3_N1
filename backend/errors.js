// errors.js - Lỗi nghiệp vụ có mã HTTP, dùng chung cho các service / controller
class HttpError extends Error {
  // extra: dữ liệu kèm theo lỗi (ví dụ { code, warnings }) để client xử lý tiếp.
  constructor(status, message, extra = null) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Trả lỗi route theo status nghiệp vụ nếu có, còn lại log và dùng thông báo an toàn.
function sendRouteError(res, err, fallbackMessage) {
  if (Number.isInteger(err?.status)) {
    return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  }
  console.error(err);
  return res.status(500).json({ error: fallbackMessage });
}

module.exports = { HttpError, sendRouteError };
