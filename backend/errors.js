// errors.js - Lỗi nghiệp vụ có mã HTTP, dùng chung cho các service / controller
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Trả lỗi route theo status nghiệp vụ nếu có, còn lại log và dùng thông báo an toàn.
function sendRouteError(res, err, fallbackMessage) {
  if (Number.isInteger(err?.status)) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  return res.status(500).json({ error: fallbackMessage });
}

module.exports = { HttpError, sendRouteError };
