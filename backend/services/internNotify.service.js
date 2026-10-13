// Thông báo trong app cho thực tập sinh về lịch trình (mốc lịch, nhiệm vụ, lịch làm việc, ngày nghỉ).
// Mọi hàm đều "best-effort": không bao giờ ném lỗi để không làm hỏng nghiệp vụ chính.
const db = require("../db");

function viDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(ymd || "");
}

// Gửi cùng một thông báo cho nhiều thực tập sinh (theo mã hồ sơ); trả về số thông báo được tạo.
async function toInterns(internIds, payload, deps = {}) {
  try {
    const store = deps.db || db;
    const push = deps.pushSafe || require("./notifications.service").pushSafe;
    const ids = [...new Set(internIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
    if (!ids.length) return 0;
    const rows = await store.findUserIdsByInternIds(ids);
    return await push(rows.map((r) => r.userId), payload);
  } catch (err) {
    console.error("[INTERN-NOTIFY] Không tạo được thông báo:", err.message);
    return 0;
  }
}

// Mốc lịch thực tập của một người thay đổi.
function scheduleChanged(internId, message, deps) {
  return toInterns([internId], {
    type: "SCHEDULE_CHANGED", title: "Lịch thực tập có cập nhật",
    message: String(message).slice(0, 500), targetTab: "tab-my-schedule", refId: internId,
  }, deps);
}

module.exports = { viDate, toInterns, scheduleChanged };
