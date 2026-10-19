// Hồ sơ mentor / thực tập sinh của người đang đăng nhập + kiểm tra quyền theo phân công.
// Dùng chung cho tasks, weeklyReports, evaluations (trước đây mỗi service tự chép một bản).
const db = require("../db");
const { HttpError } = require("../errors");

async function requireInternProfile(user) {
  const intern = user?.email
    ? await db.findInternProfileByEmail(user.email)
    : null;
  if (!intern) {
    throw new HttpError(404, "Tài khoản chưa có hồ sơ thực tập sinh!");
  }
  return intern;
}

// purpose: vế cuối của thông báo, VD "giao nhiệm vụ" -> "...hồ sơ mentor để giao nhiệm vụ!".
async function requireMentorProfile(user, purpose) {
  const mentor =
    user?.role === "Mentor" && user.email
      ? await db.findMentorByEmail(user.email)
      : null;
  if (!mentor) {
    throw new HttpError(403, `Tài khoản chưa có hồ sơ mentor để ${purpose}!`);
  }
  return mentor;
}

// action: VD "xem báo cáo" -> "Bạn chỉ được xem báo cáo của thực tập sinh được phân công cho mình!".
function assertInternBelongsToMentor(mentor, internMentorId, action) {
  if (!internMentorId || Number(internMentorId) !== Number(mentor.id)) {
    throw new HttpError(
      403,
      `Bạn chỉ được ${action} của thực tập sinh được phân công cho mình!`,
    );
  }
}

module.exports = {
  requireInternProfile,
  requireMentorProfile,
  assertInternBelongsToMentor,
};
