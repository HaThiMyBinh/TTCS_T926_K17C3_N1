function normalizedName(value) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("vi") : "";
}

function resolveUniqueMentorId(name, mentors) {
  const target = normalizedName(name);
  if (!target || !Array.isArray(mentors)) return null;

  const matches = mentors.filter((mentor) => {
    const fullName = mentor?.fullName ?? mentor?.full_name;
    return normalizedName(fullName) === target;
  });
  if (matches.length !== 1) return null;

  const id = Number(matches[0].id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Chuông trong app khi HR đổi phân công mentor: báo mentor mới, mentor cũ và chính thực tập sinh.
// Không bao giờ ném lỗi để không làm hỏng việc phân công. `deps` dùng cho test.
async function notifyMentorAssignment(
  { before, internId, mentorId, mentorName },
  deps = {},
) {
  try {
    const db = deps.db || require("../db");
    const push = deps.pushSafe || require("./notifications.service").pushSafe;
    const oldId = before && before.mentorId ? Number(before.mentorId) : null;
    const newId = mentorId == null ? null : Number(mentorId);
    if (oldId === newId) return 0; // không đổi gì thì không báo
    const intern = before || (await db.findInternProfileById(internId));
    if (!intern) return 0;
    const name = intern.fullName || "thực tập sinh";
    let sent = 0;
    if (newId) {
      sent += await push([await db.findMentorUserId(newId)], {
        type: "MENTOR_ASSIGNED",
        title: "Bạn được phân công thực tập sinh mới",
        message: `HR phân công bạn hướng dẫn ${name}.`,
        targetTab: "tab-my-interns",
        refId: internId,
      });
    }
    if (oldId) {
      sent += await push([await db.findMentorUserId(oldId)], {
        type: "MENTOR_UNASSIGNED",
        title: "Thay đổi phân công thực tập sinh",
        message: `Bạn không còn phụ trách ${name}.`,
        targetTab: "tab-my-interns",
        refId: internId,
      });
    }
    const owner = intern.email ? await db.findUserByEmail(intern.email) : null;
    if (owner) {
      sent += await push([owner.id], {
        type: newId ? "MENTOR_ASSIGNED_TO_ME" : "MENTOR_REMOVED_FROM_ME",
        title: newId
          ? "Bạn đã có mentor hướng dẫn"
          : "Phân công mentor đã được gỡ",
        message: newId
          ? `Mentor ${mentorName || ""} được phân công hướng dẫn bạn.`.replace(
              "  ",
              " ",
            )
          : "Bạn hiện chưa có mentor phụ trách.",
        refId: internId,
      });
    }
    return sent;
  } catch (err) {
    console.error("[MENTOR] Không tạo được thông báo phân công:", err.message);
    return 0;
  }
}

// Phân công theo chương trình: gộp thông báo cho mentor (một thông báo / mentor), mỗi thực tập sinh nhận riêng.
async function notifyProgramMentorAssignment(
  { program, mentorId, mentorName, changed },
  deps = {},
) {
  try {
    if (!changed || !changed.length) return 0;
    const db = deps.db || require("../db");
    const push = deps.pushSafe || require("./notifications.service").pushSafe;
    const where =
      program && program.name ? ` (chương trình ${program.name})` : "";
    let sent = 0;
    if (mentorId) {
      sent += await push([await db.findMentorUserId(mentorId)], {
        type: "MENTOR_ASSIGNED",
        title: "Bạn được phân công thực tập sinh mới",
        message:
          `HR phân công bạn hướng dẫn ${changed.length} thực tập sinh${where}.`.slice(
            0,
            500,
          ),
        targetTab: "tab-my-interns",
      });
    }
    const lost = new Map(); // mentor cũ -> số thực tập sinh bị chuyển đi
    for (const m of changed)
      if (m.mentorId)
        lost.set(Number(m.mentorId), (lost.get(Number(m.mentorId)) || 0) + 1);
    for (const [oldId, count] of lost) {
      sent += await push([await db.findMentorUserId(oldId)], {
        type: "MENTOR_UNASSIGNED",
        title: "Thay đổi phân công thực tập sinh",
        message:
          `Bạn không còn phụ trách ${count} thực tập sinh${where}.`.slice(
            0,
            500,
          ),
        targetTab: "tab-my-interns",
      });
    }
    for (const m of changed) {
      const owner = m.email ? await db.findUserByEmail(m.email) : null;
      if (!owner) continue;
      sent += await push([owner.id], {
        type: mentorId ? "MENTOR_ASSIGNED_TO_ME" : "MENTOR_REMOVED_FROM_ME",
        title: mentorId
          ? "Bạn đã có mentor hướng dẫn"
          : "Phân công mentor đã được gỡ",
        message: mentorId
          ? `Mentor ${mentorName || ""} được phân công hướng dẫn bạn.`.replace(
              "  ",
              " ",
            )
          : "Bạn hiện chưa có mentor phụ trách.",
        refId: m.id,
      });
    }
    return sent;
  } catch (err) {
    console.error(
      "[MENTOR] Không tạo được thông báo phân công theo chương trình:",
      err.message,
    );
    return 0;
  }
}

module.exports = {
  resolveUniqueMentorId,
  notifyMentorAssignment,
  notifyProgramMentorAssignment,
};
