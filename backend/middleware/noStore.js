// Dữ liệu cá nhân/tiền bạc: không để trình duyệt hoặc proxy lưu cache.
const NO_STORE = "private, no-store";

function noStore(req, res, next) {
  res.set("Cache-Control", NO_STORE);
  next();
}

module.exports = { NO_STORE, noStore };
