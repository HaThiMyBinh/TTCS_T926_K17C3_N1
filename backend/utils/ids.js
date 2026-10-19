// Phân tích ID dạng số nguyên dương từ tham số URL/body (nguồn DUY NHẤT cho mọi service).
const { HttpError } = require("../errors");

// Trả về số nguyên dương an toàn, hoặc ném HttpError(400, message).
function parseId(raw, message = "ID không hợp lệ!") {
  const text = String(raw ?? "");
  const id = Number(text);
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(id)) {
    throw new HttpError(400, message);
  }
  return id;
}

// Như parseId nhưng tự dựng thông báo "<label> không hợp lệ!".
function parseLabeledId(raw, label) {
  return parseId(raw, `${label} không hợp lệ!`);
}

module.exports = { parseId, parseLabeledId };
