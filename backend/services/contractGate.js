// Điều kiện trình tự: thực tập sinh phải có ít nhất 1 hợp đồng đã xác nhận thì mới được
// giao nhiệm vụ, nộp báo cáo tuần và đánh giá tổng kết.
const db = require("../db");
const { HttpError } = require("../errors");

async function assertHasConfirmedContract(internId, message) {
  if (!(await db.hasConfirmedContract(internId))) {
    throw new HttpError(409, message);
  }
}

module.exports = { assertHasConfirmedContract };
