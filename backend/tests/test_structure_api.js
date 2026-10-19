// Kiểm thử đầu-cuối 4 hạng mục cấu trúc: nhóm trong chương trình, lịch sử phân công mentor,
// lịch họp theo phạm vi (chương trình/nhóm) + ngoại lệ, phạm vi GROUP của lịch làm việc.
// Cần backend đang chạy + MySQL; tự tạo và tự dọn dữ liệu (tiền tố struct_test_).
const assert = require("assert");
const mysql = require("mysql2/promise");
const { BASE_URL, loginAs, readDbConfig } = require("./test_helpers");
const { VIETNAM_UTC_OFFSET } = require("../utils/date");

let passed = 0;
function ok(name) {
  passed += 1;
  console.log(`[PASS] ${name}`);
}

async function api(path, role, method = "GET", body) {
  const headers = {};
  if (role) headers.Authorization = `Bearer ${await loginAs(role)}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    /* body rỗng */
  }
  return { status: response.status, body: json, data: json && json.data };
}

const week = Array.from({ length: 7 }, (_, i) => ({
  weekday: i + 1,
  is_working: i < 5,
  start_time: null,
  end_time: null,
}));
const pad = (n) => String(n).padStart(2, "0");
function dayOffset(days) {
  const d = new Date(Date.now() + 7 * 3600000 + days * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function meetingTime(daysAhead, hour) {
  return `${dayOffset(daysAhead)}T${pad(hour)}:00:00+07:00`;
}

async function main() {
  // Phần kiểm tra phân giải lịch gọi thẳng service nên cần kết nối DB riêng cho tiến trình test.
  const appDb = require("../db");
  await appDb.initDatabase();
  const prefix = `struct_test_${Date.now()}`;
  const conn = await mysql.createConnection(readDbConfig());
  await conn.query("SET time_zone = ?", [VIETNAM_UTC_OFFSET]);
  const ids = { interns: [], mentors: [], programs: [], schedules: [] };
  const mkIntern = async (n) => {
    const [r] = await conn.query(
      "INSERT INTO intern_profiles (student_code, full_name, email, phone, university, major, mentor_name, status) VALUES ('', ?, ?, '', 'ĐH Test', '', '', 'Đang thực tập')",
      [`${prefix}_I${n}`, `${prefix}_i${n}@example.test`],
    );
    ids.interns.push(r.insertId);
    return r.insertId;
  };
  const mkMentor = async (n) => {
    const [r] = await conn.query(
      "INSERT INTO mentors (full_name, email) VALUES (?, ?)",
      [`${prefix}_M${n}`, `${prefix}_m${n}@example.test`],
    );
    ids.mentors.push(r.insertId);
    return r.insertId;
  };
  const dbRows = async (sql, params) => (await conn.query(sql, params))[0];

  try {
    const [[{ id: departmentId }]] = await conn.query(
      "SELECT id FROM departments ORDER BY id LIMIT 1",
    );
    const i1 = await mkIntern(1);
    const i2 = await mkIntern(2);
    const i3 = await mkIntern(3);
    const i4 = await mkIntern(4);
    const outsider = await mkIntern(9);
    const outsiderMember = await mkIntern(5);
    const m1 = await mkMentor(1);
    const m2 = await mkMentor(2);

    const program = await api("/programs", "HR", "POST", {
      name: `${prefix}_P`,
      department_id: departmentId,
      start_date: dayOffset(30),
      end_date: dayOffset(120),
      status: "OPEN",
    });
    assert.equal(program.status, 201, JSON.stringify(program.body));
    const programId = program.data.id;
    ids.programs.push(programId);

    // Thêm 4 thực tập sinh vào chương trình (outsider không vào)
    const added = await api(`/programs/${programId}/interns`, "HR", "POST", {
      intern_ids: [i1, i2, i3, i4, outsiderMember],
    });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    ok("Thêm thực tập sinh vào chương trình");

    // ---------- Quy tắc 8: lịch sử đăng ký chương trình ----------
    let history = await api(`/programs/${programId}/enrollment-history`, "HR");
    assert.equal(history.status, 200);
    assert.equal(
      history.data.filter((e) => e.eventType === "ADDED").length,
      5,
    );
    ok("Lịch sử đăng ký ghi 4 sự kiện ADDED");

    // ---------- Quy tắc 2: nhóm thuộc chương trình ----------
    assert.equal(
      (await api(`/programs/${programId}/groups`, null)).status,
      401,
    );
    assert.equal(
      (await api(`/programs/${programId}/groups`, "Mentor", "POST", { name: "x" }))
        .status,
      403,
    );
    ok("Tạo nhóm yêu cầu đăng nhập và quyền HR");
    const gA = await api(`/programs/${programId}/groups`, "HR", "POST", {
      name: `${prefix}_A`,
      description: "Nhóm A",
    });
    assert.equal(gA.status, 201, JSON.stringify(gA.body));
    const gB = await api(`/programs/${programId}/groups`, "HR", "POST", {
      name: `${prefix}_B`,
    });
    assert.equal(gB.status, 201);
    const groupA = gA.data.id;
    const groupB = gB.data.id;
    assert.equal(
      (await api(`/programs/${programId}/groups`, "HR", "POST", { name: `${prefix}_A` }))
        .status,
      409,
    );
    for (const bad of [{}, { name: "" }, { name: "x", extra: 1 }, { name: "a".repeat(151) }])
      assert.equal(
        (await api(`/programs/${programId}/groups`, "HR", "POST", bad)).status,
        400,
      );
    assert.equal(
      (await api(`/programs/99999999/groups`, "HR", "POST", { name: "x" })).status,
      404,
    );
    const listed = await api(`/programs/${programId}/groups`, "Admin");
    assert.equal(listed.status, 200);
    assert.equal(listed.data.length, 2);
    ok("Một chương trình có nhiều nhóm; kiểm tra trùng tên/dữ liệu sai");

    // ---------- Quy tắc 3: nhóm chính ----------
    const stranger = await api(`/groups/${groupA}/members`, "HR", "POST", {
      intern_ids: [outsider],
    });
    assert.equal(stranger.status, 409);
    ok("Không thêm vào nhóm người chưa thuộc chương trình");

    const addA = await api(`/groups/${groupA}/members`, "HR", "POST", {
      intern_ids: [i1, i2, i3],
    });
    assert.equal(addA.status, 200, JSON.stringify(addA.body));
    assert.equal(addA.data.added, 3);
    const again = await api(`/groups/${groupA}/members`, "HR", "POST", {
      intern_ids: [i1],
    });
    assert.equal(again.data.already, 1);
    ok("Thêm thành viên nhóm, thêm lặp không nhân đôi");

    const clash = await api(`/groups/${groupB}/members`, "HR", "POST", {
      intern_ids: [i1],
    });
    assert.equal(clash.status, 409);
    ok("Mỗi thực tập sinh chỉ một nhóm chính (từ chối nhóm chính thứ hai)");

    const duplicate = await conn
      .query(
        "INSERT INTO group_members (group_id, program_id, intern_id, is_primary) VALUES (?,?,?,1)",
        [groupB, programId, i1],
      )
      .then(
        () => null,
        (e) => e.code,
      );
    assert.equal(duplicate, "ER_DUP_ENTRY");
    ok("CSDL tự chặn hai nhóm chính đang hiệu lực");

    const sideGroup = await api(`/groups/${groupB}/members`, "HR", "POST", {
      intern_ids: [i1],
      is_primary: false,
    });
    assert.equal(sideGroup.status, 200);
    ok("Cho phép nhóm phụ khi nghiệp vụ cần");

    const moved = await api(`/groups/${groupB}/members`, "HR", "POST", {
      intern_ids: [i2],
      move: true,
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.data.moved, 1);
    const membersA = await api(`/groups/${groupA}/members?history=1`, "HR");
    const i2InA = membersA.data.find((m) => m.internId === i2);
    assert.ok(i2InA && i2InA.leftAt, "dòng cũ ở nhóm A phải được đóng lại, không xóa");
    ok("Chuyển nhóm giữ lịch sử (left_at) thay vì xóa");

    const ungrouped = await api(`/programs/${programId}/ungrouped-interns`, "HR");
    assert.deepEqual(
      ungrouped.data.map((x) => x.id).sort((a, b) => a - b),
      [i4, outsiderMember].sort((a, b) => a - b),
    );
    ok("Danh sách thực tập sinh chưa có nhóm");

    // ---------- Quy tắc 4: lịch sử mentor ----------
    let hist = await api(`/interns/${i1}/mentor-history`, "HR");
    assert.equal(hist.status, 200);
    assert.deepEqual(hist.data.items, []);
    const set1 = await api(`/interns/${i1}/mentor`, "HR", "PUT", {
      mentor_id: m1,
      confirm_warnings: true,
    });
    assert.equal(set1.status, 200, JSON.stringify(set1.body));
    await new Promise((r) => setTimeout(r, 2100));
    const afterSet = Date.now();
    await new Promise((r) => setTimeout(r, 2100));
    const set2 = await api(`/interns/${i1}/mentor`, "HR", "PUT", {
      mentor_id: m2,
      confirm_warnings: true,
    });
    assert.equal(set2.status, 200, JSON.stringify(set2.body));
    hist = await api(`/interns/${i1}/mentor-history`, "HR");
    assert.equal(hist.data.items.length, 2);
    assert.equal(hist.data.items[0].mentorId, m2);
    assert.equal(hist.data.items[0].isCurrent, true);
    assert.equal(hist.data.items[1].mentorId, m1);
    assert.ok(hist.data.items[1].effectiveTo, "mentor cũ phải được đóng hiệu lực");
    ok("Đổi mentor giữ lịch sử có thời gian hiệu lực");

    const midLocal = new Date(afterSet + 7 * 3600000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    const atMid = await api(
      `/interns/${i1}/mentor-history?at=${encodeURIComponent(midLocal)}`,
      "HR",
    );
    assert.equal(atMid.status, 200);
    assert.equal(
      atMid.data.assignment && atMid.data.assignment.mentorId,
      m1,
      `at=${midLocal} items=${JSON.stringify(hist.data.items)}`,
    );
    const atNow = await api(`/interns/${i1}/mentor-history?at=${dayOffset(1)}`, "HR");
    assert.equal(atNow.data.assignment.mentorId, m2);
    assert.equal(
      (await api(`/interns/${i1}/mentor-history?at=not-a-date`, "HR")).status,
      400,
    );
    assert.equal((await api(`/interns/${i1}/mentor-history?x=1`, "HR")).status, 400);
    assert.equal((await api(`/interns/99999999/mentor-history`, "HR")).status, 404);
    ok("Tra cứu mentor tại một thời điểm");

    const same = await api(`/interns/${i1}/mentor`, "HR", "PUT", {
      mentor_id: m2,
      confirm_warnings: true,
    });
    assert.equal(same.status, 200);
    hist = await api(`/interns/${i1}/mentor-history`, "HR");
    assert.equal(hist.data.items.length, 2);
    ok("Gán lại cùng mentor không tạo dòng lịch sử mới");

    const viaProgram = await api(`/programs/${programId}/mentor`, "HR", "PUT", {
      mentor_id: m1,
      intern_ids: [i2, i3],
      confirm_warnings: true,
    });
    assert.equal(viaProgram.status, 200, JSON.stringify(viaProgram.body));
    hist = await api(`/interns/${i2}/mentor-history`, "HR");
    assert.equal(hist.data.items.length, 1);
    assert.equal(hist.data.items[0].programId, programId);
    ok("Phân công mentor theo chương trình ghi kèm chương trình");

    const open = await dbRows(
      "SELECT COUNT(*) n FROM mentor_assignments WHERE intern_id=? AND effective_to IS NULL",
      [i1],
    );
    assert.equal(Number(open[0].n), 1);
    const dupOpen = await conn
      .query(
        "INSERT INTO mentor_assignments (intern_id, mentor_id) VALUES (?, ?)",
        [i1, m1],
      )
      .then(
        () => null,
        (e) => e.code,
      );
    assert.equal(dupOpen, "ER_DUP_ENTRY");
    ok("CSDL chỉ cho một phân công mentor đang mở cho mỗi thực tập sinh");

    const unset = await api(`/interns/${i1}/mentor`, "HR", "PUT", { mentor_id: null });
    assert.equal(unset.status, 200);
    hist = await api(`/interns/${i1}/mentor-history`, "HR");
    assert.ok(hist.data.items.every((x) => !x.isCurrent));
    const cache = await dbRows("SELECT mentor_id FROM intern_profiles WHERE id=?", [i1]);
    assert.equal(cache[0].mentor_id, null);
    ok("Gỡ mentor đóng phân công; mentor_id hiện tại khớp lịch sử");

    // xóa mentor: lịch sử còn, mentor_id về NULL
    await mkMentor(3).then(async (m3) => {
      await api(`/interns/${i4}/mentor`, "HR", "PUT", {
        mentor_id: m3,
        confirm_warnings: true,
      });
      await conn.query("DELETE FROM mentors WHERE id=?", [m3]);
      const rows = await dbRows(
        "SELECT mentor_id, mentor_name, effective_to FROM mentor_assignments WHERE intern_id=?",
        [i4],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].mentor_id, null);
      assert.ok(rows[0].mentor_name, "giữ tên mentor đã xóa trong lịch sử");
    });
    ok("Xóa mentor vẫn giữ tên trong lịch sử phân công");

    // ---------- Quy tắc 5 + 7: lịch họp theo phạm vi ----------
    const base = {
      title: `${prefix}_họp`,
      start_at: meetingTime(40, 9),
      end_at: meetingTime(40, 10),
      program_id: programId,
    };
    const manual = await api("/meetings", "HR", "POST", {
      ...base,
      attendee_ids: [i1],
      title: `${prefix}_manual`,
    });
    assert.equal(manual.status, 201, JSON.stringify(manual.body));
    assert.equal(manual.data.meeting.scopeType, "INDIVIDUAL");
    ok("Lịch chọn tay (cá nhân) vẫn hoạt động như cũ");

    for (const bad of [
      { ...base, scope_type: "GROUP", attendee_ids: [i1] },
      { ...base, scope_type: "GROUP" },
      { ...base, scope_type: "PROGRAM", group_id: groupA },
      { ...base, scope_type: "PROGRAM", include_ids: [i1] },
      { ...base, scope_type: "NOPE" },
      { ...base, scope_type: "GROUP", group_id: groupA, include_ids: [i1], exclude_ids: [i1] },
      { ...base, attendee_ids: [i1], include_ids: [i2] },
      { ...base, scope_type: "GROUP", group_id: groupA, program_id: null },
    ])
      assert.equal((await api("/meetings", "HR", "POST", bad)).status, 400);
    const wrongProgram = await api("/meetings", "HR", "POST", {
      ...base,
      scope_type: "GROUP",
      group_id: 99999999,
    });
    assert.equal(wrongProgram.status, 400);
    ok("Từ chối cấu hình phạm vi lịch không hợp lệ");

    const groupMeeting = await api("/meetings", "HR", "POST", {
      ...base,
      title: `${prefix}_group`,
      scope_type: "GROUP",
      group_id: groupA,
    });
    assert.equal(groupMeeting.status, 201, JSON.stringify(groupMeeting.body));
    const gm = groupMeeting.data.meeting;
    assert.equal(gm.scopeType, "GROUP");
    assert.equal(gm.groupId, groupA);
    // Nhóm A hiện có i1, i3 (i2 đã chuyển sang B)
    assert.deepEqual(
      gm.attendees.map((a) => a.id).sort((a, b) => a - b),
      [i1, i3],
    );
    ok("Lịch theo nhóm tự lấy người từ thành viên nhóm");

    const withExceptions = await api("/meetings", "HR", "POST", {
      ...base,
      title: `${prefix}_exc`,
      scope_type: "GROUP",
      group_id: groupA,
      include_ids: [i4],
      exclude_ids: [i3],
    });
    assert.equal(withExceptions.status, 201, JSON.stringify(withExceptions.body));
    assert.deepEqual(
      withExceptions.data.meeting.attendees.map((a) => a.id).sort((a, b) => a - b),
      [i1, i4],
    );
    assert.deepEqual(withExceptions.data.meeting.includeIds, [i4]);
    assert.deepEqual(withExceptions.data.meeting.excludeIds, [i3]);
    const overrides = await dbRows(
      "SELECT intern_id, participation FROM schedule_participants WHERE meeting_id=? ORDER BY intern_id",
      [withExceptions.data.meeting.id],
    );
    assert.equal(overrides.length, 2);
    const outsiderInclude = await api("/meetings", "HR", "POST", {
      ...base,
      scope_type: "GROUP",
      group_id: groupA,
      include_ids: [outsider],
    });
    assert.equal(outsiderInclude.status, 400);
    ok("schedule_participants lưu ngoại lệ INCLUDE/EXCLUDE; người ngoài chương trình bị từ chối");

    const programMeeting = await api("/meetings", "HR", "POST", {
      ...base,
      title: `${prefix}_prog`,
      scope_type: "PROGRAM",
      exclude_ids: [i4],
    });
    assert.equal(programMeeting.status, 201, JSON.stringify(programMeeting.body));
    const pm = programMeeting.data.meeting;
    assert.deepEqual(
      pm.attendees.map((a) => a.id).sort((a, b) => a - b),
      [i1, i2, i3, outsiderMember].sort((a, b) => a - b),
    );
    ok("Lịch theo chương trình lấy toàn bộ thành viên trừ ngoại lệ");

    // ---------- Quy tắc 8: thay đổi thành viên cập nhật lịch tương lai ----------
    const before = await api(`/meetings/${gm.id}`, "HR");
    const seq0 = before.data.sequence;
    const join = await api(`/groups/${groupA}/members`, "HR", "POST", {
      intern_ids: [i4],
    });
    assert.equal(join.status, 200, JSON.stringify(join.body));
    assert.ok(join.data.updatedMeetings >= 1);
    const afterJoin = await api(`/meetings/${gm.id}`, "HR");
    assert.deepEqual(
      afterJoin.data.attendees.map((a) => a.id).sort((a, b) => a - b),
      [i1, i3, i4],
    );
    assert.equal(afterJoin.data.sequence, seq0 + 1);
    const invites = await dbRows(
      "SELECT COUNT(*) n FROM email_logs WHERE meeting_id=? AND intern_id=? AND email_type='MEETING_INVITE'",
      [gm.id, i4],
    );
    assert.equal(Number(invites[0].n), 1);
    ok("Thêm vào nhóm: lịch tương lai tự thêm người, tăng sequence, tạo lời mời");

    const excludedStays = await api(`/meetings/${withExceptions.data.meeting.id}`, "HR");
    assert.ok(
      !excludedStays.data.attendees.some((a) => a.id === i3),
      "người bị EXCLUDE không được quay lại khi đồng bộ",
    );
    ok("Ngoại lệ EXCLUDE được giữ khi đồng bộ lại");

    const leave = await api(`/groups/${groupA}/members/${i3}`, "HR", "DELETE");
    assert.equal(leave.status, 200, JSON.stringify(leave.body));
    const afterLeave = await api(`/meetings/${gm.id}`, "HR");
    assert.ok(!afterLeave.data.attendees.some((a) => a.id === i3));
    const cancelMail = await dbRows(
      "SELECT COUNT(*) n FROM email_logs WHERE meeting_id=? AND intern_id=? AND email_type='MEETING_CANCELLED'",
      [gm.id, i3],
    );
    assert.equal(Number(cancelMail[0].n), 1);
    assert.equal(
      (await api(`/groups/${groupA}/members/${i3}`, "HR", "DELETE")).status,
      404,
    );
    ok("Rời nhóm: bị gỡ khỏi lịch tương lai và nhận thông báo hủy");

    const removed = await api(`/programs/${programId}/interns/${i2}`, "HR", "DELETE");
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    const pmAfter = await api(`/meetings/${pm.id}`, "HR");
    assert.ok(!pmAfter.data.attendees.some((a) => a.id === i2));
    history = await api(`/programs/${programId}/enrollment-history`, "HR");
    assert.ok(
      history.data.some((e) => e.eventType === "REMOVED" && e.internId === i2),
    );
    const gmGone = await dbRows(
      "SELECT COUNT(*) n FROM group_members WHERE program_id=? AND intern_id=?",
      [programId, i2],
    );
    assert.equal(Number(gmGone[0].n), 0);
    ok("Gỡ khỏi chương trình: lịch chương trình cập nhật, ghi sự kiện REMOVED, nhóm tự dọn");

    // lịch hết người tự hủy
    const lone = await api(`/programs/${programId}/groups`, "HR", "POST", {
      name: `${prefix}_lone`,
    });
    await api(`/groups/${lone.data.id}/members`, "HR", "POST", {
      intern_ids: [i1],
      is_primary: false,
    });
    const loneMeeting = await api("/meetings", "HR", "POST", {
      ...base,
      title: `${prefix}_lone`,
      scope_type: "GROUP",
      group_id: lone.data.id,
    });
    assert.equal(loneMeeting.status, 201, JSON.stringify(loneMeeting.body));
    await api(`/groups/${lone.data.id}/members/${i1}`, "HR", "DELETE");
    const loneAfter = await api(`/meetings/${loneMeeting.data.meeting.id}`, "HR");
    assert.equal(loneAfter.data.status, "CANCELLED");
    ok("Lịch theo nhóm hết thành viên tự hủy");

    // xóa nhóm: lịch chuyển về chọn tay
    const delGroup = await api(`/groups/${lone.data.id}`, "HR", "DELETE");
    assert.equal(delGroup.status, 200);
    const loneFinal = await api(`/meetings/${loneMeeting.data.meeting.id}`, "HR");
    assert.equal(loneFinal.data.scopeType, "INDIVIDUAL");
    ok("Xóa nhóm chuyển lịch liên quan về lịch chọn tay, không mất dữ liệu");

    // ---------- Xem trước ảnh hưởng (dry run) ----------
    const dryMeeting = await api("/meetings", "HR", "POST", {
      ...base,
      title: `${prefix}_dry`,
      scope_type: "GROUP",
      group_id: groupA,
    });
    assert.equal(dryMeeting.status, 201, JSON.stringify(dryMeeting.body));
    const dryBefore = await dbRows("SELECT COUNT(*) n FROM group_members WHERE group_id=? AND left_at IS NULL", [groupA]);
    const dryAdd = await api(`/groups/${groupA}/members`, "HR", "POST", {
      intern_ids: [outsiderMember],
      dry_run: true,
    });
    assert.equal(dryAdd.status, 200, JSON.stringify(dryAdd.body));
    assert.equal(dryAdd.data.dryRun, true);
    assert.equal(dryAdd.data.added, 1);
    assert.ok(dryAdd.data.meetings.some((m) => m.title === `${prefix}_dry`));
    const dryAfter = await dbRows("SELECT COUNT(*) n FROM group_members WHERE group_id=? AND left_at IS NULL", [groupA]);
    assert.equal(Number(dryAfter[0].n), Number(dryBefore[0].n));
    const dryAttendees = await dbRows("SELECT COUNT(*) n FROM meeting_attendees WHERE meeting_id=?", [dryMeeting.data.meeting.id]);
    assert.equal(Number(dryAttendees[0].n), dryMeeting.data.meeting.attendees.length);
    const dryMail = await dbRows("SELECT COUNT(*) n FROM email_logs WHERE meeting_id=? AND intern_id=?", [dryMeeting.data.meeting.id, outsiderMember]);
    assert.equal(Number(dryMail[0].n), 0);
    const dryLeave = await api(`/groups/${groupA}/members/${i1}?dry_run=1`, "HR", "DELETE");
    assert.equal(dryLeave.status, 200, JSON.stringify(dryLeave.body));
    assert.equal(dryLeave.data.dryRun, true);
    assert.ok(dryLeave.data.updatedMeetings >= 1);
    const stillMember = await dbRows("SELECT COUNT(*) n FROM group_members WHERE group_id=? AND intern_id=? AND left_at IS NULL", [groupA, i1]);
    assert.equal(Number(stillMember[0].n), 1);
    ok("Xem trước ảnh hưởng (dry run) không thay đổi dữ liệu và không tạo email");

    // ---------- Mentor theo nhóm ----------
    const gm1 = await api(`/groups/${groupA}/mentor`, "HR", "PUT", { mentor_id: m1, confirm_warnings: true });
    assert.equal(gm1.status, 200, JSON.stringify(gm1.body));
    assert.ok(gm1.data.updated >= 1);
    const members = await dbRows("SELECT intern_id FROM group_members WHERE group_id=? AND left_at IS NULL", [groupA]);
    for (const { intern_id } of members) {
      const h = await api(`/interns/${intern_id}/mentor-history`, "HR");
      const cur = h.data.items.find((x) => x.isCurrent);
      assert.equal(cur.mentorId, m1);
      assert.match(cur.note || "", /Gán theo nhóm/);
    }
    assert.equal((await api(`/groups/${lone.data.id}/mentor`, "HR", "PUT", { mentor_id: m1 })).status, 404);
    const emptyG = await api(`/programs/${programId}/groups`, "HR", "POST", { name: `${prefix}_empty` });
    assert.equal((await api(`/groups/${emptyG.data.id}/mentor`, "HR", "PUT", { mentor_id: m1 })).status, 409);
    assert.equal((await api(`/groups/${groupA}/mentor`, "HR", "PUT", { mentor_id: m1, x: 1 })).status, 400);
    assert.equal((await api(`/groups/${groupA}/mentor`, "Mentor", "PUT", { mentor_id: m1 })).status, 403);
    ok("Gán mentor cho cả nhóm ghi lịch sử từng người kèm ghi chú nhóm");

    // ---------- Lộ trình áp dụng theo phạm vi ----------
    await conn.query(
      "INSERT INTO intern_schedules (intern_id, phase_order, title, status) VALUES (?,1,'Giai đoạn 1','COMPLETED'),(?,2,'Giai đoạn 2','IN_PROGRESS')",
      [i1, i1],
    );
    const applyG = await api(`/groups/${groupA}/roadmap`, "HR", "POST", { source_intern_id: i1 });
    assert.equal(applyG.status, 200, JSON.stringify(applyG.body));
    assert.ok(applyG.data.applied >= 1);
    const copied = await dbRows("SELECT status, COUNT(*) n FROM intern_schedules WHERE intern_id=? GROUP BY status", [i4]);
    assert.deepEqual(copied.map((r) => [r.status, Number(r.n)]), [["NOT_STARTED", 2]]);
    assert.equal((await api(`/programs/${programId}/roadmap`, "HR", "POST", { source_intern_id: i3 })).status, 409);
    const again2 = await api(`/groups/${groupA}/roadmap`, "HR", "POST", { source_intern_id: i1 });
    assert.equal(again2.data.applied, 0);
    assert.ok(again2.data.skipped >= 1);
    const applyP = await api(`/programs/${programId}/roadmap`, "HR", "POST", { source_intern_id: i1 });
    assert.equal(applyP.status, 200, JSON.stringify(applyP.body));
    const viaProgram2 = await dbRows("SELECT COUNT(*) n FROM intern_schedules WHERE intern_id=?", [outsiderMember]);
    assert.equal(Number(viaProgram2[0].n), 2);
    assert.equal((await api(`/programs/${programId}/roadmap`, "HR", "POST", {})).status, 400);
    ok("Áp dụng lộ trình cho nhóm/chương trình: sao chép cho người chưa có, giữ nguyên người đã có");

    // ---------- Nhóm của tôi ----------
    const appSvc = require("../services/structure.service");
    const mine = await appSvc.myGroups({ role: "Intern", email: `${prefix}_i1@example.test` });
    assert.ok(mine.some((g) => g.id === groupA && g.isPrimary));
    const mentorView = await appSvc.myGroups({ role: "Mentor", email: `${prefix}_m1@example.test` });
    assert.ok(mentorView.some((g) => g.id === groupA && g.interns.some((x) => x.id === i1)));
    assert.equal((await api("/me/groups", "HR")).status, 403);
    assert.equal((await api("/me/groups", "Intern")).status, 200);
    ok("Intern và Mentor xem được nhóm của mình");

    // ---------- Lịch sử nhóm không mất khi gỡ khỏi chương trình ----------
    const histBefore = await api(`/programs/${programId}/enrollment-history`, "HR");
    assert.ok(histBefore.data.some((e) => e.eventType === "GROUP_JOINED" && e.detail));
    const rm3 = await api(`/programs/${programId}/interns/${i4}`, "HR", "DELETE");
    assert.equal(rm3.status, 200, JSON.stringify(rm3.body));
    const histAfter = await api(`/programs/${programId}/enrollment-history`, "HR");
    assert.ok(
      histAfter.data.some((e) => e.eventType === "GROUP_LEFT" && e.internId === i4 && /gỡ khỏi chương trình/.test(e.detail)),
      "gỡ khỏi chương trình phải ghi sự kiện rời nhóm",
    );
    ok("Biến động nhóm được lưu trong lịch sử, kể cả khi gỡ khỏi chương trình");

    // ---------- Báo cáo chuyên cần theo nhóm ----------
    const rep = await api(
      `/attendance/report?from=${dayOffset(31)}&to=${dayOffset(40)}&scope_type=GROUP&scope_value=${groupA}`,
      "HR",
    );
    assert.equal(rep.status, 200, JSON.stringify(rep.body));
    assert.equal(
      (await api(`/attendance/report?from=${dayOffset(31)}&to=${dayOffset(40)}&scope_type=GROUP&scope_value=abc`, "HR")).status,
      400,
    );
    ok("Báo cáo chuyên cần chấp nhận phạm vi nhóm (logic lọc có unit test riêng)");

    // ---------- Đồng thời ----------
    const gC = await api(`/programs/${programId}/groups`, "HR", "POST", { name: `${prefix}_C` });
    const gD = await api(`/programs/${programId}/groups`, "HR", "POST", { name: `${prefix}_D` });
    const racers = await Promise.all([
      api(`/groups/${gC.data.id}/members`, "HR", "POST", { intern_ids: [outsiderMember] }),
      api(`/groups/${gD.data.id}/members`, "HR", "POST", { intern_ids: [outsiderMember] }),
    ]);
    assert.deepEqual(racers.map((r) => r.status).sort(), [200, 409], JSON.stringify(racers.map((r) => r.body)));
    const primaries = await dbRows(
      "SELECT COUNT(*) n FROM group_members WHERE program_id=? AND intern_id=? AND is_primary=1 AND left_at IS NULL",
      [programId, outsiderMember],
    );
    assert.equal(Number(primaries[0].n), 1);
    // Hai HTTP request phải cùng thành công; không chấp nhận deadlock bị ẩn thành 500.
    const m3 = await mkMentor(3);
    const m4 = await mkMentor(4);
    const mentorPairs = [
      [m1, m2],
      [m2, m3],
      [m3, m4],
      [m4, m1],
    ];
    let mentorRaceRequests = 0;
    let mentorRace500s = 0;
    try {
      for (let round = 0; round < 20; round += 1) {
        const pair = mentorPairs[round % mentorPairs.length];
        const mentorRace = await Promise.all(
          pair.map((mentorId) =>
            api(`/interns/${i3}/mentor`, "HR", "PUT", {
              mentor_id: mentorId,
            }),
          ),
        );
        mentorRaceRequests += mentorRace.length;
        mentorRace500s += mentorRace.filter((r) => r.status === 500).length;
        assert.deepEqual(
          mentorRace.map((r) => r.status),
          [200, 200],
          `vòng ${round + 1}: ${JSON.stringify(mentorRace)}`,
        );
        const openRows = await dbRows(
          "SELECT mentor_id FROM mentor_assignments WHERE intern_id=? AND effective_to IS NULL",
          [i3],
        );
        assert.equal(openRows.length, 1, `vòng ${round + 1}: một dòng mở`);
        const finalMentor = await dbRows(
          "SELECT mentor_id FROM intern_profiles WHERE id=?",
          [i3],
        );
        assert.equal(finalMentor[0].mentor_id, openRows[0].mentor_id);
        assert.ok(pair.includes(Number(finalMentor[0].mentor_id)));
      }
    } finally {
      console.log(
        `[MENTOR-RACE] end ${Date.now()}; ${mentorRaceRequests} HTTP requests; ${mentorRace500s} HTTP 500`,
      );
    }
    ok("Đồng thời: chỉ một nhóm chính thắng; mentor_id khớp phân công đang mở");

    // updateStudent ghi lại mọi cột nên phải khóa dòng; chạy đua với gán mentor không được làm lệch hai nơi.
    const {
      findMentorAssignmentDrift,
    } = require("../migrations/structureMigration");
    for (let round = 0; round < 8; round += 1) {
      const target = round % 2 === 0 ? m1 : m2;
      const results = await Promise.allSettled([
        appDb.assignInternMentor(i3, target, {}),
        appDb.updateStudent(i3, {
          phone: `09${String(round).padStart(8, "0")}`,
        }),
        appDb.assignInternMentor(i3, target === m1 ? m2 : m1, {}),
      ]);
      // deadlock được InnoDB chọn nạn nhân là chấp nhận được (giao dịch bị hủy trọn vẹn); lỗi khác thì không
      for (const r of results)
        if (r.status === "rejected")
          assert.equal(
            r.reason && r.reason.code,
            "ER_LOCK_DEADLOCK",
            String(r.reason),
          );
      const drift = await findMentorAssignmentDrift(conn);
      assert.deepEqual(
        drift.filter((d) => d.internId === i3),
        [],
        `vòng ${round}: intern_profiles.mentor_id lệch mentor_assignments`,
      );
    }
    ok(
      "Chạy đua updateStudent với gán mentor: mentor_id luôn khớp phân công đang mở",
    );

    // Quét toàn bộ CSDL: sau mọi thao tác ở trên không được còn thực tập sinh nào bị lệch.
    const allDrift = await findMentorAssignmentDrift(conn);
    assert.deepEqual(
      allDrift,
      [],
      `Lệch mentor_id/mentor_assignments: ${JSON.stringify(allDrift.slice(0, 10))}`,
    );
    ok(
      "Quét toàn bộ: intern_profiles.mentor_id khớp mentor_assignments cho mọi thực tập sinh",
    );

    // Đồng bộ sau backfill: mentor_id được nối từ mentor_name phải sinh phân công đang mở.
    const backfillName = `${prefix}_M1`;
    await conn.query(
      "UPDATE intern_profiles SET mentor_id=NULL, mentor_name=? WHERE id=?",
      [backfillName, i4],
    );
    await conn.query(
      "UPDATE mentor_assignments SET effective_to=NOW(3) WHERE intern_id=? AND effective_to IS NULL",
      [i4],
    );
    await appDb.backfillInternMentorIds();
    const {
      reconcileMentorHistory,
    } = require("../migrations/structureMigration");
    const staleBefore = (await findMentorAssignmentDrift(conn)).filter(
      (d) => d.internId === i4,
    );
    assert.equal(
      staleBefore.length,
      1,
      "backfill một mình để lại lệch (đúng như thiết kế, cần reconcile)",
    );
    const synced = await reconcileMentorHistory(appDb.getPool());
    assert.deepEqual(synced.after, []);
    const openAfter = await dbRows(
      "SELECT mentor_id FROM mentor_assignments WHERE intern_id=? AND effective_to IS NULL",
      [i4],
    );
    assert.equal(openAfter.length, 1);
    assert.equal(openAfter[0].mentor_id, m1);
    ok(
      "Backfill + reconcileMentorHistory: mentor nối từ tên có phân công đang mở",
    );

    // ---------- Phạm vi GROUP của lịch làm việc ----------
    const service = require("../services/workSchedules.service");
    const scheduleRules = require("../services/scheduleRules.service");
    const scheduleName = `${prefix}_sched`;
    const sched = await api("/work-schedules", "HR", "POST", {
      name: scheduleName,
      mode: "FLEXIBLE",
      min_daily_minutes: 240,
      days: week,
    });
    assert.equal(sched.status, 201, JSON.stringify(sched.body));
    ids.schedules.push(sched.data.id);
    const assign = await api("/work-schedules/assignments", "HR", "POST", {
      schedule_id: sched.data.id,
      target_type: "GROUP",
      target_value: String(groupA),
      effective_from: dayOffset(30),
    });
    assert.equal(assign.status, 201, JSON.stringify(assign.body));
    const probeDate = dayOffset(35);
    const viaGroup = await scheduleRules.resolveScheduleForIntern(i1, probeDate);
    assert.equal(viaGroup.source.type, "GROUP");
    assert.equal(viaGroup.schedule.id, sched.data.id);
    assert.match(viaGroup.source.label, /Nhóm thực tập/);
    ok("Lịch làm việc gán cho nhóm được áp dụng cho thành viên nhóm");

    const notMember = await scheduleRules.resolveScheduleForIntern(i2, probeDate);
    assert.notEqual(notMember.source.type, "GROUP");
    ok("Người ngoài nhóm không bị ảnh hưởng");

    const preview = await api(
      `/work-schedules/preview?target_type=GROUP&target_value=${groupA}`,
      "HR",
    );
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    ok("Xem trước ảnh hưởng của lịch gán cho nhóm");

    const meetingOptsHr = await api("/meetings/options", "HR");
    assert.ok(Array.isArray(meetingOptsHr.data.groups));
    assert.ok(meetingOptsHr.data.groups.some((g) => g.id === groupA));
    const meetingOptsMentor = await api("/meetings/options", "Mentor");
    assert.equal(meetingOptsMentor.status, 200);
    assert.equal(meetingOptsMentor.data.groups, undefined);
    ok("Chỉ HR nhận danh sách nhóm để tạo lịch theo phạm vi (mentor thì không)");

    const opts = await api("/work-schedules/options", "HR");
    assert.ok(opts.data.groups.some((g) => g.id === groupA));
    const blockDelete = await api(`/groups/${groupA}`, "HR", "DELETE");
    assert.equal(blockDelete.status, 409);
    ok("Không xóa nhóm đang được gán lịch làm việc");

    // INTERN ưu tiên cao hơn GROUP
    const sched2 = await api("/work-schedules", "HR", "POST", {
      name: `${scheduleName}_2`,
      mode: "FLEXIBLE",
      min_daily_minutes: 120,
      days: week,
    });
    ids.schedules.push(sched2.data.id);
    const personal = await api("/work-schedules/assignments", "HR", "POST", {
      schedule_id: sched2.data.id,
      target_type: "INTERN",
      target_value: String(i1),
      effective_from: dayOffset(30),
    });
    assert.equal(personal.status, 201, JSON.stringify(personal.body));
    const prioritized = await scheduleRules.resolveScheduleForIntern(i1, probeDate);
    assert.equal(prioritized.source.type, "INTERN");
    ok("Thứ tự ưu tiên: cá nhân > nhóm > chương trình");
    void service;
  } finally {
    // dọn dữ liệu
    const groupRows = ids.programs.length
      ? (await conn.query("SELECT id FROM program_groups WHERE program_id IN (?)", [ids.programs]))[0]
      : [];
    const targets = [
      ...groupRows.map((g) => String(g.id)),
      ...ids.interns.map(String),
    ];
    if (targets.length)
      await conn.query(
        "DELETE FROM work_schedule_assignments WHERE target_type IN ('GROUP','INTERN') AND target_value IN (?)",
        [targets],
      );
    await conn.query("DELETE FROM meetings WHERE title LIKE ?", [`${prefix}%`]);
    if (ids.schedules.length)
      await conn.query("DELETE FROM work_schedules WHERE id IN (?)", [ids.schedules]);
    if (ids.programs.length)
      await conn.query("DELETE FROM internship_programs WHERE id IN (?)", [ids.programs]);
    if (ids.interns.length)
      await conn.query("DELETE FROM intern_profiles WHERE id IN (?)", [ids.interns]);
    if (ids.mentors.length)
      await conn.query("DELETE FROM mentors WHERE id IN (?)", [ids.mentors]);
    await conn.end();
    await appDb.closePool();
  }
  console.log(`\nSTRUCTURE API: ${passed} PASS`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
