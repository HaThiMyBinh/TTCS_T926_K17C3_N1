const db = require("../db");
const { HttpError } = require("../errors");
const { parseId } = require("./programs.service");
const { getVietnamToday } = require("../utils/date");
const STATUSES = ["IN_PROGRESS", "COMPLETED", "PAUSED", "NOT_COMPLETED"];
function validateResult(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (key) => !["completion_status", "note"].includes(key),
    )
  )
    throw new HttpError(400, "Dữ liệu kết quả không hợp lệ!");
  if (!STATUSES.includes(body.completion_status))
    throw new HttpError(400, "Trạng thái kết quả không hợp lệ!");
  if (body.note != null && typeof body.note !== "string")
    throw new HttpError(400, "Ghi chú phải là văn bản!");
  const note = (body.note || "").trim();
  if (note.length > 500) throw new HttpError(400, "Ghi chú tối đa 500 ký tự!");
  if (body.completion_status === "NOT_COMPLETED" && !note)
    throw new HttpError(400, "Cần ghi lý do không hoàn thành!");
  return { status: body.completion_status, note };
}
async function save(programId, internId, body, user) {
  const values = validateResult(body);
  const result = await db.setProgramCompletion(
    parseId(programId),
    parseId(internId),
    values,
    user.id,
    getVietnamToday(),
  );
  if (result.outcome === "NOT_FOUND")
    throw new HttpError(404, "Không tìm thấy thành viên trong chương trình!");
  if (result.outcome === "OVERLAP")
    throw new HttpError(
      409,
      "Cần xử lý lịch trùng/chưa rõ của dữ liệu cũ trước khi chốt kết quả!",
    );
  if (result.outcome === "FINALIZED")
    throw new HttpError(409, "Kết quả đã chốt, không thể ghi đè lịch sử!");
  if (result.outcome === "NOT_STARTED")
    throw new HttpError(
      409,
      "Chỉ chốt khi chương trình có đủ lịch, đã bắt đầu và ở trạng thái ONGOING/CLOSED!",
    );
  return { already: result.already, completionStatus: values.status };
}
module.exports = { STATUSES, validateResult, save };
