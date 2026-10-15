function trimOrDefault(value, fallback = "") {
  return value ? String(value).trim() : fallback;
}
module.exports = { trimOrDefault };
