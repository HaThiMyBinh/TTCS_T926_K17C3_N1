// Tiện ích SQL dùng chung.

// Escape ký tự đặc biệt của mẫu LIKE (% _ \ và chính ký tự escape). Câu SQL đi kèm phải khai báo
// cùng ký tự: mặc định "\" (ESCAPE '\\'), hoặc "=" (ESCAPE '=').
function escapeLike(value, escapeChar = "\\") {
  const special = new Set(["\\", "%", "_", escapeChar]);
  return Array.from(String(value))
    .map((ch) => (special.has(ch) ? escapeChar + ch : ch))
    .join("");
}

module.exports = { escapeLike };
