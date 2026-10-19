// Nhóm trong chương trình, lịch sử phân công mentor, lịch sử đăng ký chương trình (quy tắc thiết kế 2, 3, 4, 8).
const db = require("../db");
const { HttpError } = require("../errors");

const MAX_BULK = 200;
const SQL_DT = "'%Y-%m-%d %H:%i:%s'";
const { getVietnamToday } = require("../utils/date");
const { mondayOf } = require("../utils/weeks");
// Thời điểm hiện tại dạng giờ Việt Nam (YYYY-MM-DD HH:mm:ss) để so với các cột DATETIME của lịch họp.
function formatSqlVn(date) {
  return new Date(date.getTime() + 7 * 3600000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

const { parseId } = require("../utils/ids");

function pool() {
  return db.getPool();
}

function onlyKeys(body, allowed, message) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !allowed.includes(k))
  )
    throw new HttpError(400, message);
}

function validateGroup(body, { partial = false } = {}) {
  onlyKeys(body, ["name", "description"], "Dữ liệu nhóm không hợp lệ!");
  const value = {};
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== "string")
      throw new HttpError(400, "Tên nhóm phải là văn bản!");
    const name = body.name.trim();
    if (!name || name.length > 150 || /\x00/.test(name))
      throw new HttpError(400, "Tên nhóm bắt buộc, tối đa 150 ký tự!");
    value.name = name;
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== "string")
      throw new HttpError(400, "Mô tả nhóm phải là văn bản!");
    const d = (body.description || "").trim();
    if (d.length > 500)
      throw new HttpError(400, "Mô tả nhóm tối đa 500 ký tự!");
    value.description = d || null;
  }
  return value;
}

function duplicateName(err) {
  if (err && err.code === "ER_DUP_ENTRY")
    return new HttpError(409, "Tên nhóm đã tồn tại trong chương trình này!");
  return err;
}

// Email lời mời/hủy do đồng bộ lịch họp tạo ra: gửi ngay sau khi giao dịch xong, không bao giờ ném lỗi.
function kick(deps = {}) {
  try {
    const dispatch =
      deps.kickMeetingEmails ||
      (() => require("./email/emailQueue").dispatchMeetingJobs());
    Promise.resolve(dispatch()).catch((err) =>
      console.error("[MEETING-OUTBOX]", err.message),
    );
  } catch (err) {
    console.error("[MEETING-OUTBOX]", err.message);
  }
}

// Chạy thử: thực hiện thay đổi trong giao dịch rồi hoàn tác, trả về kết quả để HR xem trước ảnh hưởng (không gửi email).
class DryRunResult extends Error {
  constructor(result) {
    super("dry-run");
    this.result = result;
  }
}
async function runDry(work) {
  try {
    await work();
  } catch (err) {
    if (err instanceof DryRunResult) return err.result;
    throw err;
  }
  throw new Error("Chạy thử không trả kết quả");
}
async function describeMeetings(conn, resync) {
  if (!resync.meetingIds.length) return [];
  const [rows] = await conn.query(
    `SELECT id, title, status, DATE_FORMAT(start_at, ${SQL_DT}) AS startAt FROM meetings WHERE id IN (?) ORDER BY start_at, id`,
    [resync.meetingIds],
  );
  return rows;
}
function parseBool(value, key) {
  if (value !== undefined && typeof value !== "boolean")
    throw new HttpError(400, `Trường ${key} phải là true/false!`);
  return value === true;
}

async function requireProgram(programId) {
  const [rows] = await pool().query(
    "SELECT id, name FROM internship_programs WHERE id=?",
    [programId],
  );
  if (!rows.length)
    throw new HttpError(404, "Không tìm thấy chương trình thực tập!");
  return rows[0];
}

// ---------- Nhóm ----------
async function listGroups(rawProgramId) {
  const programId = parseId(rawProgramId, "Mã chương trình");
  await requireProgram(programId);
  const [groups] = await pool().query(
    `SELECT g.id, g.program_id AS programId, g.name, g.description,
            DATE_FORMAT(g.created_at, ${SQL_DT}) AS createdAt,
            (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id AND gm.left_at IS NULL) AS memberCount
     FROM program_groups g WHERE g.program_id = ? ORDER BY g.name, g.id`,
    [programId],
  );
  return groups.map((g) => ({ ...g, memberCount: Number(g.memberCount) }));
}

async function createGroup(rawProgramId, body, user) {
  const programId = parseId(rawProgramId, "Mã chương trình");
  const value = validateGroup(body);
  await requireProgram(programId);
  try {
    const [result] = await pool().query(
      "INSERT INTO program_groups (program_id, name, description, created_by) VALUES (?,?,?,?)",
      [programId, value.name, value.description ?? null, user && user.id],
    );
    return getGroup(result.insertId);
  } catch (err) {
    throw duplicateName(err);
  }
}

async function getGroup(groupId) {
  const [rows] = await pool().query(
    `SELECT g.id, g.program_id AS programId, g.name, g.description,
            (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id AND gm.left_at IS NULL) AS memberCount
     FROM program_groups g WHERE g.id = ?`,
    [groupId],
  );
  if (!rows.length) throw new HttpError(404, "Không tìm thấy nhóm!");
  return { ...rows[0], memberCount: Number(rows[0].memberCount) };
}

async function updateGroup(rawGroupId, body) {
  const groupId = parseId(rawGroupId, "Mã nhóm");
  const value = validateGroup(body, { partial: true });
  if (!Object.keys(value).length)
    throw new HttpError(400, "Không có thay đổi nào để lưu!");
  const sets = Object.keys(value).map((k) => `${k} = ?`);
  try {
    const [result] = await pool().query(
      `UPDATE program_groups SET ${sets.join(", ")} WHERE id = ?`,
      [...Object.values(value), groupId],
    );
    if (!result.affectedRows) throw new HttpError(404, "Không tìm thấy nhóm!");
  } catch (err) {
    throw duplicateName(err);
  }
  return getGroup(groupId);
}

async function deleteGroup(rawGroupId, deps = {}) {
  const groupId = parseId(rawGroupId, "Mã nhóm");
  await db.withTransaction(async (conn) => {
    const [[group]] = await conn.query(
      "SELECT id FROM program_groups WHERE id=? FOR UPDATE",
      [groupId],
    );
    if (!group) throw new HttpError(404, "Không tìm thấy nhóm!");
    const [[used]] = await conn.query(
      "SELECT COUNT(*) AS n FROM work_schedule_assignments WHERE target_type='GROUP' AND target_value=?",
      [String(groupId)],
    );
    if (Number(used.n))
      throw new HttpError(
        409,
        "Nhóm đang được gán lịch làm việc; hãy gỡ lịch trước khi xóa nhóm!",
      );
    // Lịch họp theo nhóm giữ nguyên người tham dự hiện có nhưng chuyển sang lịch chọn tay.
    await conn.query(
      "UPDATE meetings SET scope_type='INDIVIDUAL', group_id=NULL WHERE group_id=?",
      [groupId],
    );
    await conn.query("DELETE FROM program_groups WHERE id=?", [groupId]);
  });
  kick(deps);
  return null;
}

// ---------- Thành viên nhóm ----------
async function listMembers(rawGroupId, query = {}) {
  const groupId = parseId(rawGroupId, "Mã nhóm");
  if (Object.keys(query).some((k) => k !== "history"))
    throw new HttpError(400, "Tham số không hợp lệ!");
  await getGroup(groupId);
  const history = query.history === "1" || query.history === "true";
  const [rows] = await pool().query(
    `SELECT gm.id, gm.intern_id AS internId, ip.full_name AS fullName, ip.student_code AS studentCode,
            gm.is_primary AS isPrimary,
            DATE_FORMAT(gm.joined_at, ${SQL_DT}) AS joinedAt, DATE_FORMAT(gm.left_at, ${SQL_DT}) AS leftAt
     FROM group_members gm JOIN intern_profiles ip ON ip.id = gm.intern_id
     WHERE gm.group_id = ? ${history ? "" : "AND gm.left_at IS NULL"}
     ORDER BY gm.left_at IS NOT NULL, ip.full_name, gm.id`,
    [groupId],
  );
  return rows.map((r) => ({ ...r, isPrimary: Boolean(r.isPrimary) }));
}

async function addMembers(rawGroupId, body, user, deps = {}) {
  const groupId = parseId(rawGroupId, "Mã nhóm");
  onlyKeys(
    body,
    ["intern_ids", "is_primary", "move", "dry_run"],
    "Dữ liệu thêm thành viên nhóm không hợp lệ!",
  );
  const ids = body.intern_ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_BULK)
    throw new HttpError(
      400,
      `Danh sách thực tập sinh phải có từ 1 đến ${MAX_BULK} người!`,
    );
  if (ids.some((v) => !Number.isSafeInteger(v) || v < 1))
    throw new HttpError(400, "Mã thực tập sinh phải là số nguyên dương!");
  if (new Set(ids).size !== ids.length)
    throw new HttpError(400, "Danh sách thực tập sinh bị trùng!");
  for (const key of ["is_primary", "move"])
    if (body[key] !== undefined && typeof body[key] !== "boolean")
      throw new HttpError(400, `Trường ${key} phải là true/false!`);
  const isPrimary = body.is_primary !== false;
  const move = body.move === true;
  const dry = parseBool(body.dry_run, "dry_run");

  const work = async (conn) => {
    const [[group]] = await conn.query(
      "SELECT id, program_id, name FROM program_groups WHERE id=? FOR UPDATE",
      [groupId],
    );
    if (!group) throw new HttpError(404, "Không tìm thấy nhóm!");
    const programId = Number(group.program_id);
    const [enrolled] = await conn.query(
      "SELECT intern_id FROM program_interns WHERE program_id=? AND intern_id IN (?) FOR UPDATE",
      [programId, ids],
    );
    const have = new Set(enrolled.map((r) => Number(r.intern_id)));
    const missing = ids.filter((id) => !have.has(id));
    if (missing.length)
      throw new HttpError(
        409,
        `Thực tập sinh chưa thuộc chương trình của nhóm: ${missing.join(", ")}!`,
      );
    const [mine] = await conn.query(
      "SELECT id, intern_id, is_primary FROM group_members WHERE group_id=? AND left_at IS NULL AND intern_id IN (?) FOR UPDATE",
      [groupId, ids],
    );
    const same = new Set(
      mine
        .filter((r) => Boolean(r.is_primary) === isPrimary)
        .map((r) => Number(r.intern_id)),
    );
    const toAdd = ids.filter((id) => !same.has(id));
    let moved = 0;
    if (toAdd.length) {
      // Đổi vai trò chính/phụ trong cùng nhóm: đóng dòng cũ rồi mở dòng mới.
      await conn.query("SET @gm_now = NOW(3)");
      await conn.query(
        "UPDATE group_members SET left_at=@gm_now WHERE group_id=? AND left_at IS NULL AND intern_id IN (?)",
        [groupId, toAdd],
      );
      if (isPrimary) {
        const [others] = await conn.query(
          `SELECT gm.intern_id, gm.group_id, g.name FROM group_members gm JOIN program_groups g ON g.id = gm.group_id
           WHERE gm.program_id=? AND gm.is_primary=1 AND gm.left_at IS NULL AND gm.intern_id IN (?) FOR UPDATE`,
          [programId, toAdd],
        );
        if (others.length && !move)
          throw new HttpError(
            409,
            `Thực tập sinh đã có nhóm chính khác trong chương trình: ${others
              .map((o) => o.intern_id)
              .join(", ")}. Gửi move=true để chuyển nhóm hoặc is_primary=false để thêm làm nhóm phụ!`,
          );
        if (others.length) {
          await conn.query(
            "UPDATE group_members SET left_at=@gm_now WHERE program_id=? AND is_primary=1 AND left_at IS NULL AND intern_id IN (?)",
            [programId, toAdd],
          );
          moved = others.length;
          await conn.query(
            "INSERT INTO program_intern_events (program_id,intern_id,event_type,group_id,detail,actor_user_id) VALUES ?",
            [
              others.map((o) => [
                programId,
                o.intern_id,
                "GROUP_LEFT",
                o.group_id,
                `${o.name} (chuyển nhóm)`.slice(0, 200),
                user && user.id ? user.id : null,
              ]),
            ],
          );
        }
      }
      await conn.query(
        "INSERT INTO group_members (group_id, program_id, intern_id, is_primary, assigned_by) VALUES ?",
        [
          toAdd.map((id) => [
            groupId,
            programId,
            id,
            isPrimary ? 1 : 0,
            user && user.id ? user.id : null,
          ]),
        ],
      );
    }
    if (toAdd.length)
      await conn.query(
        "INSERT INTO program_intern_events (program_id,intern_id,event_type,group_id,detail,actor_user_id) VALUES ?",
        [
          toAdd.map((id) => [
            programId,
            id,
            "GROUP_JOINED",
            groupId,
            `${group.name}${isPrimary ? "" : " (nhóm phụ)"}`.slice(0, 200),
            user && user.id ? user.id : null,
          ]),
        ],
      );
    const resync = await db.resyncScopedMeetings(conn, programId);
    const out = {
      added: toAdd.length,
      already: ids.length - toAdd.length,
      moved,
      resync,
    };
    if (dry) throw new DryRunResult({ ...out, meetings: await describeMeetings(conn, resync) });
    return out;
  };
  if (dry) {
    const preview = await runDry(() => db.withProgramMembershipTransaction(work));
    return {
      dryRun: true,
      added: preview.added,
      already: preview.already,
      moved: preview.moved,
      updatedMeetings: preview.resync.meetings,
      cancelledMeetings: preview.resync.cancelled,
      meetings: preview.meetings,
    };
  }
  const result = await db.withProgramMembershipTransaction(work);
  if (result.resync.emails) kick(deps);
  return {
    added: result.added,
    already: result.already,
    moved: result.moved,
    updatedMeetings: result.resync.meetings,
    cancelledMeetings: result.resync.cancelled,
  };
}

async function removeMember(rawGroupId, rawInternId, query = {}, deps = {}, user = null) {
  const groupId = parseId(rawGroupId, "Mã nhóm");
  const internId = parseId(rawInternId, "Mã thực tập sinh");
  if (Object.keys(query).some((k) => k !== "dry_run"))
    throw new HttpError(400, "Tham số không hợp lệ!");
  const dry = query.dry_run === "1" || query.dry_run === "true";
  const work = async (conn) => {
    const [[group]] = await conn.query(
      "SELECT id, program_id, name FROM program_groups WHERE id=? FOR UPDATE",
      [groupId],
    );
    if (!group) throw new HttpError(404, "Không tìm thấy nhóm!");
    const [done] = await conn.query(
      "UPDATE group_members SET left_at=NOW(3) WHERE group_id=? AND intern_id=? AND left_at IS NULL",
      [groupId, internId],
    );
    if (!done.affectedRows)
      throw new HttpError(404, "Thực tập sinh không thuộc nhóm này!");
    await conn.query(
      "INSERT INTO program_intern_events (program_id,intern_id,event_type,group_id,detail,actor_user_id) VALUES (?,?,'GROUP_LEFT',?,?,?)",
      [Number(group.program_id), internId, groupId, group.name.slice(0, 200), user && user.id ? user.id : null],
    );
    const resync = await db.resyncScopedMeetings(conn, Number(group.program_id));
    if (dry)
      throw new DryRunResult({ resync, meetings: await describeMeetings(conn, resync) });
    return resync;
  };
  if (dry) {
    const preview = await runDry(() => db.withTransaction(work));
    return {
      dryRun: true,
      updatedMeetings: preview.resync.meetings,
      cancelledMeetings: preview.resync.cancelled,
      meetings: preview.meetings,
    };
  }
  const result = await db.withTransaction(work);
  if (result.emails) kick(deps);
  return { updatedMeetings: result.meetings, cancelledMeetings: result.cancelled };
}

// Thực tập sinh của chương trình chưa có nhóm chính nào.
async function listUngrouped(rawProgramId) {
  const programId = parseId(rawProgramId, "Mã chương trình");
  await requireProgram(programId);
  const [rows] = await pool().query(
    `SELECT ip.id, ip.full_name AS fullName, ip.student_code AS studentCode
     FROM program_interns pi JOIN intern_profiles ip ON ip.id = pi.intern_id
     WHERE pi.program_id = ?
       AND NOT EXISTS (SELECT 1 FROM group_members gm WHERE gm.program_id = pi.program_id
                         AND gm.intern_id = pi.intern_id AND gm.is_primary = 1 AND gm.left_at IS NULL)
     ORDER BY ip.full_name, ip.id`,
    [programId],
  );
  return rows;
}

// ---------- Lịch sử phân công mentor ----------
function parseAt(raw) {
  if (raw === undefined) return null;
  if (typeof raw !== "string")
    throw new HttpError(400, "Thời điểm tra cứu không hợp lệ!");
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?$/.exec(raw);
  if (!m) throw new HttpError(400, "Thời điểm phải dạng YYYY-MM-DD hoặc YYYY-MM-DD HH:mm:ss!");
  const date = new Date(`${m[1]}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== m[1])
    throw new HttpError(400, "Ngày tra cứu không hợp lệ!");
  const time = m[2] ? (m[2].length === 5 ? `${m[2]}:00` : m[2]) : "00:00:00";
  return `${m[1]} ${time}`;
}

async function mentorHistory(rawInternId, query = {}) {
  const internId = parseId(rawInternId, "Mã thực tập sinh");
  if (Object.keys(query).some((k) => k !== "at"))
    throw new HttpError(400, "Tham số không hợp lệ!");
  const at = parseAt(query.at);
  const [[intern]] = await pool().query(
    "SELECT id FROM intern_profiles WHERE id=?",
    [internId],
  );
  if (!intern) throw new HttpError(404, "Không tìm thấy thực tập sinh!");
  const [rows] = await pool().query(
    `SELECT ma.id, ma.mentor_id AS mentorId, COALESCE(m.full_name, ma.mentor_name) AS mentorName,
            ma.program_id AS programId, p.name AS programName,
            DATE_FORMAT(ma.effective_from, ${SQL_DT}) AS effectiveFrom,
            DATE_FORMAT(ma.effective_to, ${SQL_DT}) AS effectiveTo,
            ma.assigned_by AS assignedBy, ma.note
     FROM mentor_assignments ma
     LEFT JOIN mentors m ON m.id = ma.mentor_id
     LEFT JOIN internship_programs p ON p.id = ma.program_id
     WHERE ma.intern_id = ?
       ${at ? "AND ma.effective_from <= ? AND (ma.effective_to IS NULL OR ma.effective_to > ?)" : ""}
     ORDER BY ma.effective_from DESC, ma.id DESC`,
    at ? [internId, at, at] : [internId],
  );
  const items = rows.map((r) => ({ ...r, isCurrent: r.effectiveTo === null }));
  return at ? { at, assignment: items[0] || null } : { items };
}

// ---------- Lịch sử đăng ký chương trình ----------
async function enrollmentHistory(rawProgramId) {
  const programId = parseId(rawProgramId, "Mã chương trình");
  await requireProgram(programId);
  const [rows] = await pool().query(
    `SELECT e.id, e.intern_id AS internId, ip.full_name AS fullName, e.event_type AS eventType, e.group_id AS groupId, e.detail,
            e.actor_user_id AS actorUserId, DATE_FORMAT(e.created_at, ${SQL_DT}) AS createdAt
     FROM program_intern_events e JOIN intern_profiles ip ON ip.id = e.intern_id
     WHERE e.program_id = ? ORDER BY e.created_at DESC, e.id DESC`,
    [programId],
  );
  return rows;
}

// ---------- Mentor theo nhóm ----------
// Gán một mentor cho mọi thành viên đang hoạt động của nhóm (mỗi người vẫn có lịch sử phân công riêng).
async function assignGroupMentor(rawGroupId, body, user, deps = {}) {
  const groupId = parseId(rawGroupId, "Mã nhóm");
  onlyKeys(body, ["mentor_id", "confirm_warnings"], "Dữ liệu phân công mentor không hợp lệ!");
  const [[group]] = await pool().query(
    "SELECT id, program_id, name FROM program_groups WHERE id=?",
    [groupId],
  );
  if (!group) throw new HttpError(404, "Không tìm thấy nhóm!");
  const [members] = await pool().query(
    "SELECT intern_id FROM group_members WHERE group_id=? AND left_at IS NULL ORDER BY intern_id",
    [groupId],
  );
  if (!members.length)
    throw new HttpError(409, "Nhóm chưa có thành viên để phân công mentor!");
  const programs = require("./programs.service");
  return programs.assignMentor(
    group.program_id,
    {
      mentor_id: body.mentor_id,
      intern_ids: members.map((m) => Number(m.intern_id)),
      ...(body.confirm_warnings !== undefined ? { confirm_warnings: body.confirm_warnings } : {}),
    },
    { ...deps, userId: user && user.id, note: `Gán theo nhóm ${group.name}`.slice(0, 500) },
  );
}

// ---------- Lộ trình thực tập: áp dụng hàng loạt theo phạm vi ----------
// Lộ trình (intern_schedules) vẫn là của từng thực tập sinh; thao tác này SAO CHÉP lộ trình của một người
// cho các thành viên nhóm/chương trình chưa có lộ trình nào (người đã có lộ trình được giữ nguyên).
async function applyRoadmap(kind, rawId, body) {
  const id = parseId(rawId, kind === "group" ? "Mã nhóm" : "Mã chương trình");
  onlyKeys(body, ["source_intern_id"], "Dữ liệu áp dụng lộ trình không hợp lệ!");
  const sourceId = parseId(body && body.source_intern_id, "Mã thực tập sinh nguồn");
  return db.withTransaction(async (conn) => {
    let members;
    if (kind === "group") {
      const [[g]] = await conn.query("SELECT id FROM program_groups WHERE id=? FOR UPDATE", [id]);
      if (!g) throw new HttpError(404, "Không tìm thấy nhóm!");
      [members] = await conn.query(
        "SELECT intern_id FROM group_members WHERE group_id=? AND left_at IS NULL",
        [id],
      );
    } else {
      const [[p]] = await conn.query("SELECT id FROM internship_programs WHERE id=? FOR UPDATE", [id]);
      if (!p) throw new HttpError(404, "Không tìm thấy chương trình thực tập!");
      [members] = await conn.query("SELECT intern_id FROM program_interns WHERE program_id=?", [id]);
    }
    const [[src]] = await conn.query("SELECT COUNT(*) AS n FROM intern_schedules WHERE intern_id=?", [sourceId]);
    if (!Number(src.n))
      throw new HttpError(409, "Thực tập sinh nguồn chưa có lộ trình để áp dụng!");
    const targets = members.map((m) => Number(m.intern_id)).filter((x) => x !== sourceId);
    if (!targets.length) return { applied: 0, skipped: 0, phases: Number(src.n) };
    const [have] = await conn.query(
      "SELECT DISTINCT intern_id FROM intern_schedules WHERE intern_id IN (?)",
      [targets],
    );
    const skip = new Set(have.map((r) => Number(r.intern_id)));
    const todo = targets.filter((t) => !skip.has(t));
    for (const internId of todo)
      await conn.query(
        `INSERT INTO intern_schedules (intern_id, phase_order, title, start_date, end_date, duration_weeks, description, expected_results, status)
         SELECT ?, phase_order, title, start_date, end_date, duration_weeks, description, expected_results, 'NOT_STARTED'
         FROM intern_schedules WHERE intern_id = ?`,
        [internId, sourceId],
      );
    return { applied: todo.length, skipped: skip.size, phases: Number(src.n) };
  });
}

// ---------- Nhóm của tôi (Intern / Mentor) ----------
async function myGroups(user) {
  if (!user || !["Intern", "Mentor"].includes(user.role))
    throw new HttpError(403, "Không có quyền xem nhóm!");
  if (user.role === "Intern") {
    const intern = await db.findInternProfileByEmail(user.email);
    if (!intern) throw new HttpError(403, "Chưa có hồ sơ thực tập sinh!");
    return internGroups(intern);
  }
  const mentor = await db.findMentorByEmail(user.email);
  if (!mentor) throw new HttpError(403, "Chưa có hồ sơ mentor!");
  return mentorGroups(mentor);
}

// Thông tin mentor được phép công khai cho thực tập sinh: tên, email công việc, phòng ban, chuyên môn (không gồm số điện thoại).
const PUBLIC_MENTOR_COLUMNS = "id, full_name AS fullName, email, department, specialization";

// Nhóm của Intern: tổng quan, thành viên (chỉ thông tin học tập cơ bản), mentor chính/hỗ trợ và lịch họp sắp tới.
async function internGroups(intern, now = new Date()) {
  const today = getVietnamToday(now);
  const [rows] = await pool().query(
    `SELECT g.id, g.name, g.description, p.id AS programId, p.name AS programName, p.status AS programStatus,
            DATE_FORMAT(p.start_date, '%Y-%m-%d') AS programStart, DATE_FORMAT(p.end_date, '%Y-%m-%d') AS programEnd,
            gm.is_primary AS isPrimary, DATE_FORMAT(gm.joined_at, ${SQL_DT}) AS joinedAt
     FROM group_members gm JOIN program_groups g ON g.id = gm.group_id
     JOIN internship_programs p ON p.id = g.program_id
     WHERE gm.intern_id = ? AND gm.left_at IS NULL ORDER BY gm.is_primary DESC, g.name`,
    [intern.id],
  );
  if (!rows.length) return [];
  const groupIds = rows.map((r) => r.id);
  let mainMentor = null;
  if (intern.mentorId) {
    const [mentors] = await pool().query(
      `SELECT ${PUBLIC_MENTOR_COLUMNS} FROM mentors WHERE id = ? LIMIT 1`,
      [intern.mentorId],
    );
    mainMentor = mentors[0] || null;
  }
  const [supportRows] = await pool().query(
    `SELECT s.group_id AS groupId, m.id, m.full_name AS fullName, m.email, m.department, m.specialization
     FROM group_support_mentors s JOIN mentors m ON m.id = s.mentor_id
     WHERE s.group_id IN (?) AND (? IS NULL OR m.id <> ?) ORDER BY m.full_name`,
    [groupIds, intern.mentorId || null, intern.mentorId || null],
  );
  const [memberRows] = await pool().query(
    `SELECT gm.group_id AS groupId, ip.id, ip.full_name AS fullName, ip.university, ip.major,
            DATE_FORMAT(gm.joined_at, ${SQL_DT}) AS joinedAt
     FROM group_members gm JOIN intern_profiles ip ON ip.id = gm.intern_id
     WHERE gm.group_id IN (?) AND gm.left_at IS NULL ORDER BY ip.full_name`,
    [groupIds],
  );
  const nowSql = formatSqlVn(now);
  const result = [];
  for (const r of rows) {
    const [meetings] = await pool().query(
      `SELECT m.id, m.title, m.location, m.meeting_link AS meetingLink, u.name AS organizerName,
              DATE_FORMAT(m.start_at, ${SQL_DT}) AS startAt, DATE_FORMAT(m.end_at, ${SQL_DT}) AS endAt
       FROM meetings m JOIN meeting_attendees a ON a.meeting_id = m.id AND a.intern_id = ?
       LEFT JOIN users u ON u.id = m.organizer_user_id
       WHERE m.status = 'SCHEDULED' AND m.end_at >= ?
         AND (m.group_id = ? OR (m.group_id IS NULL AND m.program_id = ?))
       ORDER BY m.start_at, m.id LIMIT 10`,
      [intern.id, nowSql, r.id, r.programId],
    );
    const members = memberRows.filter((m) => Number(m.groupId) === Number(r.id));
    const ended = r.programStatus === "CLOSED" || (r.programEnd && r.programEnd < today);
    result.push({
      id: r.id,
      name: r.name,
      description: r.description || "",
      programId: r.programId,
      programName: r.programName,
      programStart: r.programStart,
      programEnd: r.programEnd,
      status: ended ? "ENDED" : "ACTIVE",
      isPrimary: Boolean(r.isPrimary),
      joinedAt: r.joinedAt,
      memberCount: members.length,
      members: members.map((m) => ({
        id: Number(m.id),
        fullName: m.fullName,
        university: m.university || "",
        major: m.major || "",
        joinedAt: m.joinedAt,
        isSelf: Number(m.id) === Number(intern.id),
      })),
      mentors: {
        main: mainMentor,
        support: supportRows
          .filter((s) => Number(s.groupId) === Number(r.id))
          .map(({ groupId, ...mentor }) => mentor),
      },
      upcomingMeetings: meetings.map((m) => ({ ...m, state: m.startAt <= nowSql ? "ONGOING" : "UPCOMING" })),
    });
  }
  return result;
}

// Nhóm của Mentor: chỉ gồm thực tập sinh do chính mentor này phụ trách (phạm vi quyền hạn được cấp),
// kèm tổng quan nhóm, tiến độ từng thực tập sinh và các lịch họp sắp tới của nhóm.
async function mentorGroups(mentor, now = new Date()) {
  const today = getVietnamToday(now),
    weekStart = mondayOf(today);
  const [rows] = await pool().query(
    `SELECT g.id, g.name, g.description, p.id AS programId, p.name AS programName, p.status AS programStatus,
            DATE_FORMAT(p.start_date, '%Y-%m-%d') AS programStart, DATE_FORMAT(p.end_date, '%Y-%m-%d') AS programEnd,
            ip.id AS internId, ip.full_name AS internName, ip.email AS internEmail, ip.phone AS internPhone,
            ip.student_code AS studentCode, ip.university, ip.major, ip.status AS internStatus,
            gm.is_primary AS isPrimary, DATE_FORMAT(gm.joined_at, ${SQL_DT}) AS joinedAt
     FROM group_members gm JOIN program_groups g ON g.id = gm.group_id
     JOIN internship_programs p ON p.id = g.program_id
     JOIN intern_profiles ip ON ip.id = gm.intern_id
     WHERE ip.mentor_id = ? AND gm.left_at IS NULL ORDER BY p.name, g.name, ip.full_name`,
    [mentor.id],
  );
  const internIds = [...new Set(rows.map((r) => r.internId))];
  const taskBy = new Map(),
    reportBy = new Map(),
    attendanceBy = new Map();
  if (internIds.length) {
    const [tasks] = await pool().query(
      `SELECT intern_id AS internId, COUNT(*) AS total, SUM(status = 'DONE') AS done,
              ROUND(AVG(progress_percent)) AS percent
       FROM intern_tasks WHERE intern_id IN (?) GROUP BY intern_id`,
      [internIds],
    );
    for (const t of tasks)
      taskBy.set(Number(t.internId), {
        total: Number(t.total),
        done: Number(t.done || 0),
        percent: Number(t.percent || 0),
      });
    const [reports] = await pool().query(
      `SELECT intern_id AS internId, is_late AS isLate FROM weekly_reports WHERE intern_id IN (?) AND week_start = ?`,
      [internIds, weekStart],
    );
    for (const r of reports) reportBy.set(Number(r.internId), r);
    const [records] = await pool().query(
      `SELECT intern_id AS internId, DATE_FORMAT(check_in_at, '%H:%i') AS checkIn,
              DATE_FORMAT(check_out_at, '%H:%i') AS checkOut, correction_status AS correctionStatus
       FROM attendance_records WHERE intern_id IN (?) AND work_date = ?`,
      [internIds, today],
    );
    for (const r of records) attendanceBy.set(Number(r.internId), r);
  }
  const byGroup = new Map();
  for (const r of rows) {
    if (!byGroup.has(r.id)) {
      const ended =
        r.programStatus === "CLOSED" || (r.programEnd && r.programEnd < today);
      byGroup.set(r.id, {
        id: r.id,
        name: r.name,
        description: r.description || "",
        programId: r.programId,
        programName: r.programName,
        programStart: r.programStart,
        programEnd: r.programEnd,
        status: ended ? "ENDED" : "ACTIVE",
        mentor: { id: Number(mentor.id), fullName: mentor.full_name || mentor.fullName || "" },
        memberCount: 0,
        interns: [],
        upcomingMeetings: [],
      });
    }
    const id = Number(r.internId),
      task = taskBy.get(id) || { total: 0, done: 0, percent: 0 },
      report = reportBy.get(id),
      record = attendanceBy.get(id);
    const group = byGroup.get(r.id);
    group.memberCount += 1;
    group.interns.push({
      id,
      fullName: r.internName,
      email: r.internEmail,
      phone: r.internPhone || "",
      studentCode: r.studentCode || "",
      university: r.university || "",
      major: r.major || "",
      status: r.internStatus || "",
      isPrimary: Boolean(r.isPrimary),
      startDate: r.joinedAt ? r.joinedAt.slice(0, 10) : null,
      tasks: task,
      weeklyReport: {
        weekStart,
        status: report ? (report.isLate ? "LATE_SUBMITTED" : "SUBMITTED") : "NOT_SUBMITTED",
      },
      attendanceToday: record
        ? {
            status: record.checkOut ? "CHECKED_OUT" : "CHECKED_IN",
            checkIn: record.checkIn,
            checkOut: record.checkOut,
            correctionPending: record.correctionStatus === "PENDING",
          }
        : { status: "NOT_CHECKED_IN" },
    });
  }
  const groups = [...byGroup.values()];
  if (groups.length) {
    const nowSql = formatSqlVn(now);
    for (const group of groups) {
      const ids = group.interns.map((i) => i.id);
      // Cùng phạm vi với lịch họp của mentor: mọi người tham dự đều là thực tập sinh do mentor phụ trách.
      const [meetings] = await pool().query(
        `SELECT DISTINCT m.id, m.title, m.location, m.meeting_link AS meetingLink, m.status,
                DATE_FORMAT(m.start_at, ${SQL_DT}) AS startAt, DATE_FORMAT(m.end_at, ${SQL_DT}) AS endAt
         FROM meetings m JOIN meeting_attendees a ON a.meeting_id = m.id
         WHERE a.intern_id IN (?) AND m.status = 'SCHEDULED' AND m.end_at >= ?
           AND NOT EXISTS (SELECT 1 FROM meeting_attendees x JOIN intern_profiles xp ON xp.id = x.intern_id
                           WHERE x.meeting_id = m.id AND (xp.mentor_id IS NULL OR xp.mentor_id <> ?))
         ORDER BY startAt, m.id LIMIT 5`,
        [ids, nowSql, mentor.id],
      );
      if (!meetings.length) continue;
      const [attendees] = await pool().query(
        `SELECT a.meeting_id AS meetingId, ip.id, ip.full_name AS fullName
         FROM meeting_attendees a JOIN intern_profiles ip ON ip.id = a.intern_id
         WHERE a.meeting_id IN (?) ORDER BY ip.full_name`,
        [meetings.map((m) => m.id)],
      );
      group.upcomingMeetings = meetings.map((m) => ({
        ...m,
        state: m.startAt <= nowSql ? "ONGOING" : "UPCOMING",
        attendees: attendees
          .filter((a) => Number(a.meetingId) === Number(m.id))
          .map((a) => ({ id: Number(a.id), fullName: a.fullName })),
      }));
    }
  }
  return groups;
}

module.exports = {
  internGroups,
  mentorGroups,
  assignGroupMentor,
  applyRoadmap,
  myGroups,
  parseId,
  validateGroup,
  parseAt,
  listGroups,
  createGroup,
  getGroup,
  updateGroup,
  deleteGroup,
  listMembers,
  addMembers,
  removeMember,
  listUngrouped,
  mentorHistory,
  enrollmentHistory,
};
