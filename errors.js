// errors.js - Lỗi nghiệp vụ có mã HTTP, dùng chung cho các service / controller
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { HttpError };
