// Quản lý nhóm trong chương trình, lịch sử đăng ký chương trình và lịch sử phân công mentor (chỉ HR chỉnh sửa).
// Dùng lại programRequest/escapeHtml/setText từ programs.js, core.js, work-scope.js.
let pgProgramId = null,
  pgGroupId = null,
  pgGroups = [],
  pgMembers = [],
  pgProgramInterns = [];

function pgJson(body, method = "POST") {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
function pgFormat(value) {
  return value ? String(value).slice(0, 16).replace("T", " ") : "—";
}
const PG_EVENT = {
  ADDED: "Thêm vào chương trình",
  REMOVED: "Gỡ khỏi chương trình",
  GROUP_JOINED: "Vào nhóm",
  GROUP_LEFT: "Rời nhóm",
};
function pgEventLabel(e) {
  const base = PG_EVENT[e.eventType] || e.eventType;
  return e.detail ? `${base}: ${e.detail}` : base;
}
// Mô tả ngắn các lịch họp bị ảnh hưởng từ kết quả xem trước (dry run).
function pgImpactText(r) {
  if (!r.updatedMeetings) return "";
  const names = (r.meetings || [])
    .slice(0, 5)
    .map((m) => `• ${m.title}${m.status === "CANCELLED" ? " (sẽ bị hủy vì hết người)" : ""} – ${m.startAt}`)
    .join("\n");
  return `Thay đổi này sẽ cập nhật ${r.updatedMeetings} lịch họp chưa diễn ra (gửi lời mời/thông báo hủy cho người liên quan):\n${names}${r.meetings.length > 5 ? "\n…" : ""}\n\n`;
}
function pgGroup() {
  return pgGroups.find((g) => Number(g.id) === Number(pgGroupId)) || null;
}

async function programGroupOpen(programId) {
  pgProgramId = Number(programId);
  pgGroupId = null;
  const program = programItems.find((p) => Number(p.id) === pgProgramId);
  setText("pgTitle", `Nhóm – ${program ? program.name : ""}`);
  setText("pgError", "");
  setText("pgResult", "");
  document.getElementById("pgNewName").value = "";
  document.getElementById("pgMembersPanel").style.display = "none";
  document.getElementById("programGroupModal").style.display = "flex";
  await programGroupReload();
}
function programGroupClose() {
  document.getElementById("programGroupModal").style.display = "none";
}

async function programGroupReload() {
  try {
    const [groups, ungrouped, history] = await Promise.all([
      programRequest(`/programs/${pgProgramId}/groups`),
      programRequest(`/programs/${pgProgramId}/ungrouped-interns`),
      programRequest(`/programs/${pgProgramId}/enrollment-history`),
    ]);
    pgGroups = groups;
    document.getElementById("pgRows").innerHTML = groups.length
      ? groups
          .map(
            (g) => `<tr>
              <td>${escapeHtml(g.name)}${g.description ? `<span class="fr-sub">${escapeHtml(g.description)}</span>` : ""}</td>
              <td>${Number(g.memberCount)}</td>
              <td><div class="program-actions">
                <button class="btn btn-sm btn-soft" onclick="programGroupMembers(${Number(g.id)})">Thành viên</button>
                <button class="btn btn-sm btn-soft-gray" onclick="programGroupRename(${Number(g.id)})">Đổi tên</button>
                <button class="btn btn-sm btn-soft-danger" onclick="programGroupDelete(${Number(g.id)})">Xóa</button>
              </div></td></tr>`,
          )
          .join("")
      : '<tr><td colspan="3">Chương trình chưa có nhóm. Nhập tên ở trên để tạo nhóm đầu tiên.</td></tr>';
    setText(
      "pgUngrouped",
      ungrouped.length
        ? `${ungrouped.length} thực tập sinh chưa có nhóm chính: ${ungrouped
            .slice(0, 8)
            .map((i) => i.fullName)
            .join(", ")}${ungrouped.length > 8 ? "…" : ""}`
        : "",
    );
    document.getElementById("pgHistory").innerHTML = history.length
      ? history
          .map(
            (e) =>
              `<tr><td>${escapeHtml(pgFormat(e.createdAt))}</td><td>${escapeHtml(e.fullName)}</td><td>${escapeHtml(pgEventLabel(e))}</td></tr>`,
          )
          .join("")
      : '<tr><td colspan="3">Chưa có sự kiện.</td></tr>';
    if (pgGroupId && !pgGroup()) {
      pgGroupId = null;
      document.getElementById("pgMembersPanel").style.display = "none";
    }
  } catch (err) {
    setText("pgError", err.message);
  }
}

async function programGroupCreate() {
  const input = document.getElementById("pgNewName");
  setText("pgError", "");
  setText("pgResult", "");
  try {
    await programRequest(
      `/programs/${pgProgramId}/groups`,
      pgJson({ name: input.value }),
    );
    input.value = "";
    await programGroupReload();
  } catch (err) {
    setText("pgError", err.message);
  }
}
async function programGroupRename(id) {
  const group = pgGroups.find((g) => Number(g.id) === Number(id));
  const name = prompt("Tên nhóm mới:", group ? group.name : "");
  if (name === null) return;
  setText("pgError", "");
  try {
    await programRequest(`/groups/${Number(id)}`, pgJson({ name }, "PUT"));
    await programGroupReload();
  } catch (err) {
    setText("pgError", err.message);
  }
}
async function programGroupDelete(id) {
  const group = pgGroups.find((g) => Number(g.id) === Number(id));
  if (
    !confirm(
      `Xóa nhóm "${group ? group.name : ""}"? Các lịch họp theo nhóm này sẽ chuyển sang lịch chọn tay (giữ nguyên người tham dự).`,
    )
  )
    return;
  setText("pgError", "");
  try {
    await programRequest(`/groups/${Number(id)}`, { method: "DELETE" });
    if (Number(pgGroupId) === Number(id)) pgGroupId = null;
    document.getElementById("pgMembersPanel").style.display = "none";
    await programGroupReload();
  } catch (err) {
    setText("pgError", err.message);
  }
}

async function programGroupMembers(id) {
  pgGroupId = Number(id);
  setText("pgError", "");
  setText("pgResult", "");
  document.getElementById("pgMembersPanel").style.display = "";
  const group = pgGroup();
  setText("pgMembersTitle", `Thành viên nhóm: ${group ? group.name : ""}`);
  document.getElementById("pgPrimary").checked = true;
  document.getElementById("pgMove").checked = false;
  await programGroupLoadMentors();
  await programGroupMembersReload();
}
async function programGroupLoadMentors() {
  const select = document.getElementById("pgMentor");
  try {
    const res = await fetch(`${API_BASE}/mentors`, { headers: authHeaders() }).then(
      (r) => r.json().catch(() => []),
    );
    const allMentors = Array.isArray(res) ? res : [];
    // Chỉ hiện mentor thuộc cùng phòng ban với chương trình.
    const program = programItems.find((p) => Number(p.id) === pgProgramId);
    const normDept = (v) => String(v || "").trim().toLowerCase();
    const programDept = normDept(program?.department_name);
    const mentors = allMentors.filter(
      (m) => normDept(m.department) === programDept,
    );
    if (!mentors.length)
      setText(
        "pgError",
        `Chưa có mentor nào thuộc phòng ban "${program?.department_name || ""}". Hãy thêm mentor vào phòng ban này trước khi phân công.`,
      );
    select.innerHTML =
      '<option value="">-- Gỡ mentor của cả nhóm --</option>' +
      mentors
        .map(
          (m) =>
            `<option value="${Number(m.id)}">${escapeHtml(m.fullName)}${m.department ? ` (${escapeHtml(m.department)})` : ""}</option>`,
        )
        .join("");
    select.value = "";
  } catch (err) {
    setText("pgError", err.message);
  }
}
async function programGroupAssignMentor() {
  const value = document.getElementById("pgMentor").value;
  setText("pgError", "");
  setText("pgResult", "");
  if (!pgMembers.length)
    return setText("pgError", "Nhóm chưa có thành viên để phân công mentor.");
  try {
    const send = (confirmed) =>
      programRequest(
        `/groups/${pgGroupId}/mentor`,
        pgJson(
          {
            mentor_id: value ? Number(value) : null,
            ...(confirmed ? { confirm_warnings: true } : {}),
          },
          "PUT",
        ),
      );
    let result;
    try {
      result = await send(false);
    } catch (err) {
      if (err.code !== "NEEDS_CONFIRMATION" || !confirmAssignmentWarnings(err.warnings))
        throw err;
      result = await send(true);
    }
    setText(
      "pgResult",
      result.updated
        ? `Đã cập nhật mentor cho ${result.updated} thực tập sinh${result.unchanged ? ` (${result.unchanged} người không đổi)` : ""}.`
        : "Không có thay đổi nào.",
    );
  } catch (err) {
    setText("pgError", err.message);
  }
}
async function programGroupApplyRoadmap(kind) {
  const source = Number(document.getElementById("pgRoadmapSource").value);
  setText("pgError", "");
  setText("pgResult", "");
  if (!source) return setText("pgError", "Chọn thực tập sinh có lộ trình để sao chép.");
  const where = kind === "group" ? "cả nhóm" : "cả chương trình";
  if (!confirm(`Sao chép lộ trình của người này cho ${where}? Người đã có lộ trình sẽ được giữ nguyên.`))
    return;
  try {
    const r = await programRequest(
      kind === "group" ? `/groups/${pgGroupId}/roadmap` : `/programs/${pgProgramId}/roadmap`,
      pgJson({ source_intern_id: source }),
    );
    setText(
      "pgResult",
      `Đã áp dụng lộ trình (${r.phases} giai đoạn) cho ${r.applied} người; ${r.skipped} người đã có lộ trình được giữ nguyên.`,
    );
  } catch (err) {
    setText("pgError", err.message);
  }
}
async function programGroupMembersReload() {
  try {
    [pgMembers, pgProgramInterns] = await Promise.all([
      programRequest(`/groups/${pgGroupId}/members`),
      programRequest(`/programs/${pgProgramId}/interns`),
    ]);
  } catch (err) {
    pgMembers = [];
    pgProgramInterns = [];
    setText("pgError", err.message);
  }
  document.getElementById("pgMemberRows").innerHTML = pgMembers.length
    ? pgMembers
        .map(
          (m) => `<tr><td>${escapeHtml(m.fullName)}<span class="fr-sub">${escapeHtml(m.studentCode || "")}</span></td>
            <td>${m.isPrimary ? "Nhóm chính" : "Nhóm phụ"}</td>
            <td>${escapeHtml(pgFormat(m.joinedAt))}</td>
            <td><button class="btn btn-sm btn-danger" onclick="programGroupLeave(${Number(m.internId)})">Rời nhóm</button></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="4">Nhóm chưa có thành viên.</td></tr>';
  document.getElementById("pgRoadmapSource").innerHTML =
    '<option value="">-- Chọn thực tập sinh nguồn --</option>' +
    pgProgramInterns
      .map((i) => `<option value="${Number(i.id)}">${escapeHtml(i.fullName)}</option>`)
      .join("");
  const inGroup = new Set(pgMembers.map((m) => Number(m.internId)));
  const candidates = pgProgramInterns.filter((i) => !inGroup.has(Number(i.id)));
  document.getElementById("pgCandidates").innerHTML = candidates.length
    ? candidates
        .map(
          (i) =>
            `<label class="meeting-checks-item" style="display:block"><input type="checkbox" class="pg-check" value="${Number(i.id)}" /> ${escapeHtml(i.fullName)}<span class="fr-sub">${escapeHtml(i.studentCode || "")}</span></label>`,
        )
        .join("")
    : "";
}
async function programGroupAddMembers() {
  const ids = [...document.querySelectorAll("#pgCandidates .pg-check:checked")].map(
    (c) => Number(c.value),
  );
  setText("pgError", "");
  setText("pgResult", "");
  if (!ids.length) return setText("pgError", "Chọn ít nhất một thực tập sinh.");
  try {
    const payload = {
      intern_ids: ids,
      is_primary: document.getElementById("pgPrimary").checked,
      move: document.getElementById("pgMove").checked,
    };
    const preview = await programRequest(
      `/groups/${pgGroupId}/members`,
      pgJson({ ...payload, dry_run: true }),
    );
    const impact = pgImpactText(preview);
    if (impact && !confirm(`${impact}Tiếp tục thêm ${ids.length} người vào nhóm?`))
      return;
    const r = await programRequest(`/groups/${pgGroupId}/members`, pgJson(payload));
    setText(
      "pgResult",
      `Đã thêm ${r.added} người${r.moved ? ` (chuyển ${r.moved} người từ nhóm chính cũ)` : ""}.${r.updatedMeetings ? ` Đã cập nhật ${r.updatedMeetings} lịch họp chưa diễn ra${r.cancelledMeetings ? `, hủy ${r.cancelledMeetings} lịch hết người` : ""}.` : ""}`,
    );
    await Promise.all([programGroupReload(), programGroupMembersReload()]);
  } catch (err) {
    setText("pgError", err.message);
  }
}
async function programGroupLeave(internId) {
  setText("pgError", "");
  setText("pgResult", "");
  try {
    const preview = await programRequest(
      `/groups/${pgGroupId}/members/${Number(internId)}?dry_run=1`,
      { method: "DELETE" },
    );
    if (
      !confirm(
        `${pgImpactText(preview)}Cho thực tập sinh này rời nhóm? Lịch sử vẫn được giữ lại.`,
      )
    )
      return;
    const r = await programRequest(
      `/groups/${pgGroupId}/members/${Number(internId)}`,
      { method: "DELETE" },
    );
    if (r && r.updatedMeetings)
      setText("pgResult", `Đã cập nhật ${r.updatedMeetings} lịch họp chưa diễn ra.`);
    await Promise.all([programGroupReload(), programGroupMembersReload()]);
  } catch (err) {
    setText("pgError", err.message);
  }
}

// ---------- Lịch sử phân công mentor ----------
async function internMentorHistoryOpen(internId, name) {
  setText("mhTitle", `Lịch sử mentor – ${name || ""}`);
  setText("mhError", "");
  document.getElementById("mhRows").innerHTML =
    '<tr><td colspan="4">Đang tải...</td></tr>';
  document.getElementById("mentorHistoryModal").style.display = "flex";
  try {
    const { items } = await programRequest(
      `/interns/${Number(internId)}/mentor-history`,
    );
    document.getElementById("mhRows").innerHTML = items.length
      ? items
          .map(
            (a) => `<tr><td>${escapeHtml(a.mentorName || "Mentor đã bị xóa")}${a.isCurrent ? ' <span class="program-status">Hiện tại</span>' : ""}</td>
              <td>${escapeHtml(pgFormat(a.effectiveFrom))}</td>
              <td>${escapeHtml(a.effectiveTo ? pgFormat(a.effectiveTo) : "Đang hiệu lực")}</td>
              <td>${escapeHtml(a.programName || "—")}</td></tr>`,
          )
          .join("")
      : '<tr><td colspan="4">Chưa có phân công mentor nào.</td></tr>';
  } catch (err) {
    setText("mhError", err.message);
    document.getElementById("mhRows").innerHTML = "";
  }
}
function internMentorHistoryClose() {
  document.getElementById("mentorHistoryModal").style.display = "none";
}

// ---------- Nhóm của tôi (Intern / Mentor) ----------
async function loadMyGroups() {
  internGroupSchedule = undefined;
  const box = document.getElementById("myGroupsPage");
  box.innerHTML = '<p class="fr-hint">Đang tải...</p>';
  try {
    const groups = await programRequest("/me/groups");
    if (!groups.length) {
      box.innerHTML =
        '<p class="fr-hint">Hiện chưa có nhóm nào. Bộ phận nhân sự sẽ xếp nhóm cho thực tập sinh trong chương trình.</p>';
      return;
    }
    const isIntern = typeof currentRole !== "undefined" && currentRole === "Intern";
    if (isIntern) internGroupsData = groups;
    else mentorGroupsData = groups;
    box.innerHTML = groups
      .map((g) =>
        isIntern
          ? internGroupCard(g)
          : mentorGroupCard(g),
      )
      .join("");
    if (isIntern) for (const g of groups) internGroupTab(g.id, "overview");
  } catch (err) {
    box.innerHTML = `<p class="text-danger">${escapeHtml(err.message)}</p>`;
  }
}

// ---------- Nhóm của tôi: giao diện Mentor ----------
let mentorGroupsData = [];
const MG_WEEKLY = {
  SUBMITTED: ["Đã nộp", "ar-b-present"],
  LATE_SUBMITTED: ["Nộp trễ", "ar-b-pending"],
  NOT_SUBMITTED: ["Chưa nộp tuần này", "ar-b-absent"],
};
function mgFindGroup(id) {
  return mentorGroupsData.find((g) => Number(g.id) === Number(id));
}
function mgDateRange(g) {
  const from = g.programStart ? pgFormat(g.programStart) : "chưa đặt";
  const to = g.programEnd ? pgFormat(g.programEnd) : "chưa đặt";
  return `${from} – ${to}`;
}
function mgMeetingTime(m) {
  const day = pgFormat(m.startAt.slice(0, 10)),
    start = m.startAt.slice(11, 16),
    end = m.endAt.slice(11, 16);
  return `${day}, ${start}–${end}`;
}
function mgAttendanceCell(i, ended) {
  if (ended) return "—";
  const a = i.attendanceToday || {};
  if (a.status === "CHECKED_OUT")
    return pill(`Đã check-out ${a.checkOut}`, "ar-b-present");
  if (a.status === "CHECKED_IN")
    return pill(`Đã check-in ${a.checkIn}`, "ar-b-pending") +
      (a.correctionPending ? '<span class="fr-sub">Có yêu cầu sửa giờ</span>' : "");
  return pill("Chưa check-in hôm nay", "ar-b-muted");
}
function mgInternRow(g, i) {
  const ended = g.status === "ENDED",
    weekly = MG_WEEKLY[i.weeklyReport?.status] || MG_WEEKLY.NOT_SUBMITTED;
  return `<tr>
    <td><b>${escapeHtml(i.fullName)}</b><span class="fr-sub">${escapeHtml(i.email)}</span></td>
    <td>${i.startDate ? escapeHtml(pgFormat(i.startDate)) : "—"}</td>
    <td>${ended ? "—" : pill(weekly[0], weekly[1])}</td>
    <td>${mgAttendanceCell(i, ended)}</td>
    <td><button class="btn btn-sm btn-outline-primary" onclick="mentorGroupProfile(${Number(g.id)}, ${Number(i.id)})">Xem hồ sơ</button></td>
  </tr>`;
}
function mgMeetingRow(m) {
  const state =
    m.state === "ONGOING"
      ? pill("Đang diễn ra", "ar-b-present")
      : pill("Sắp diễn ra", "ar-b-pending");
  const names = m.attendees.map((a) => escapeHtml(a.fullName)).join(", ");
  return `<tr>
    <td>${escapeHtml(mgMeetingTime(m))}</td>
    <td><b>${escapeHtml(m.title)}</b>${m.location ? `<span class="fr-sub">${escapeHtml(m.location)}</span>` : ""}</td>
    <td>${names || "—"}</td>
    <td>${state}</td>
    <td><button class="btn btn-sm btn-outline-primary" onclick="mentorGroupOpenMeeting(${Number(m.id)})">Xem lịch</button></td>
  </tr>`;
}
function mentorGroupCard(g) {
  const ended = g.status === "ENDED",
    status = ended
      ? pill("Đã kết thúc", "ar-b-muted")
      : pill("Đang hoạt động", "ar-b-present"),
    table = g.interns.length
      ? `<div class="table-container"><table><thead><tr><th>Thực tập sinh</th><th>Ngày bắt đầu</th><th>Báo cáo tuần</th><th>Chấm công hôm nay</th><th></th></tr></thead><tbody>${g.interns.map((i) => mgInternRow(g, i)).join("")}</tbody></table></div>`
      : '<p class="fr-hint">Nhóm chưa có thực tập sinh do bạn phụ trách.</p>',
    meetings = g.upcomingMeetings.length
      ? `<div class="table-container"><table><thead><tr><th>Thời gian</th><th>Nội dung</th><th>Người tham gia</th><th>Trạng thái</th><th></th></tr></thead><tbody>${g.upcomingMeetings.map(mgMeetingRow).join("")}</tbody></table></div>`
      : '<p class="fr-hint">Chưa có lịch sắp tới cho nhóm này.</p>';
  return `<div class="card" style="margin-bottom:16px" id="mgGroup${Number(g.id)}">
    <div class="card-header" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between">
      <h3 style="margin:0">${escapeHtml(g.name)} ${status}</h3>
      <button class="btn btn-sm btn-outline-primary" id="mgToggle${Number(g.id)}" onclick="mentorGroupToggleDetail(${Number(g.id)})">Xem chi tiết nhóm</button>
    </div>
    <div class="card-body">
      <div class="fr-hint" style="margin-bottom:12px">Chương trình: <b>${escapeHtml(g.programName)}</b> · Mentor phụ trách: <b>${escapeHtml(g.mentor?.fullName || "")}</b> · Số thành viên: <b>${Number(g.memberCount)}</b> · Thời gian chương trình: <b>${escapeHtml(mgDateRange(g))}</b></div>
      <div id="mgDetail${Number(g.id)}" style="display:none;margin-bottom:14px"></div>
      <h4 style="margin:0 0 8px">Thực tập sinh trong nhóm</h4>
      ${table}
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin:18px 0 8px">
        <h4 style="margin:0">Lịch làm việc của nhóm</h4>
        <div>
          <button class="btn btn-sm btn-outline-primary" onclick="mentorGroupViewMeetings()">Xem lịch</button>
          <button class="btn btn-sm btn-primary" ${ended || !g.interns.length ? "disabled title=\"Nhóm đã kết thúc hoặc chưa có thực tập sinh\"" : ""} onclick="mentorGroupCreateMeeting(${Number(g.id)})">Tạo lịch nhóm</button>
        </div>
      </div>
      ${meetings}
      <p class="fr-hint" style="margin-top:8px">Bạn chỉ tạo và chỉnh sửa được lịch với thực tập sinh do bạn phụ trách.</p>
    </div>
  </div>`;
}
function mentorGroupToggleDetail(id) {
  const g = mgFindGroup(id),
    box = document.getElementById(`mgDetail${Number(id)}`),
    button = document.getElementById(`mgToggle${Number(id)}`);
  if (!g || !box) return;
  const open = box.style.display === "none";
  if (open) {
    const n = g.interns.length,
      avg = n ? Math.round(g.interns.reduce((a, i) => a + (i.tasks?.percent || 0), 0) / n) : 0,
      submitted = g.interns.filter((i) => i.weeklyReport?.status !== "NOT_SUBMITTED").length,
      present = g.interns.filter((i) => i.attendanceToday?.status !== "NOT_CHECKED_IN").length,
      ended = g.status === "ENDED";
    box.innerHTML = `<div class="fr-hint">${g.description ? `<p style="margin:0 0 6px">${escapeHtml(g.description)}</p>` : ""}
      Tiến độ nhiệm vụ trung bình: <b>${avg}%</b>${ended ? "" : ` · Đã nộp báo cáo tuần này: <b>${submitted}/${n}</b> · Đã check-in hôm nay: <b>${present}/${n}</b>`}</div>`;
  }
  box.style.display = open ? "" : "none";
  button.textContent = open ? "Ẩn chi tiết nhóm" : "Xem chi tiết nhóm";
}
function mentorGroupProfile(groupId, internId) {
  const g = mgFindGroup(groupId),
    i = g?.interns.find((x) => Number(x.id) === Number(internId));
  if (!i) return;
  showMeetingModal("Hồ sơ thực tập sinh");
  const row = (label, value) =>
    `<tr><th style="text-align:left;width:38%">${label}</th><td>${escapeHtml(value || "—")}</td></tr>`;
  document.getElementById("meetingModalBody").innerHTML = `<div class="table-container"><table><tbody>
    ${row("Họ tên", i.fullName)}${row("Mã sinh viên", i.studentCode)}${row("Email", i.email)}${row("Số điện thoại", i.phone)}
    ${row("Trường", i.university)}${row("Ngành", i.major)}${row("Trạng thái", i.status)}
    ${row("Nhóm", g.name)}${row("Chương trình", g.programName)}${row("Vào nhóm", i.startDate ? pgFormat(i.startDate) : "")}
  </tbody></table></div>`;
}
function mentorGroupOpenMeeting(id) {
  openMeeting(id);
}
function mentorGroupViewMeetings() {
  switchTab("tab-meetings");
}
// Mentor chỉ mời được thực tập sinh do mình phụ trách, nên danh sách mời mặc định là các thành viên của nhóm này.
function mentorGroupCreateMeeting(groupId) {
  const g = mgFindGroup(groupId);
  if (!g || g.status === "ENDED" || !g.interns.length) return;
  editMeeting(null, {
    title: `Họp nhóm ${g.name}`,
    programId: g.programId,
    interns: g.interns.map((i) => ({ id: i.id, fullName: i.fullName, email: i.email })),
  });
}

// ---------- Nhóm của tôi: giao diện Intern (Tổng quan / Thành viên / Mentor / Lịch nhóm / Lịch họp) ----------
let internGroupsData = [];
let internGroupSchedule;
const IG_TABS = [
  ["overview", "Tổng quan"],
  ["members", "Thành viên"],
  ["mentors", "Mentor"],
  ["schedule", "Lịch nhóm"],
  ["meetings", "Lịch họp"],
];
function igFind(id) {
  return internGroupsData.find((g) => Number(g.id) === Number(id));
}
function igRow(label, value) {
  return `<tr><th style="text-align:left;width:34%">${label}</th><td>${value}</td></tr>`;
}
function igStatus(g) {
  return g.status === "ENDED"
    ? pill("Đã kết thúc", "ar-b-muted")
    : pill("Đang hoạt động", "ar-b-present");
}
function internGroupCard(g) {
  const id = Number(g.id);
  return `<div class="card" style="margin-bottom:16px" id="igGroup${id}">
    <div class="card-header"><h3 style="margin:0">${escapeHtml(g.name)} ${igStatus(g)} <small>${g.isPrimary ? "(nhóm chính)" : "(nhóm phụ)"}</small></h3></div>
    <div class="card-body">
      <div class="fr-hint" style="margin-bottom:12px">Chương trình: <b>${escapeHtml(g.programName)}</b> · Vào nhóm: <b>${escapeHtml(pgFormat(g.joinedAt))}</b> · Thời gian chương trình: <b>${escapeHtml(mgDateRange(g))}</b></div>
      <div role="tablist" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">${IG_TABS.map(
        ([key, label]) =>
          `<button type="button" role="tab" class="btn btn-sm ${key === "overview" ? "btn-primary" : "btn-outline-primary"}" id="igTab${id}_${key}" onclick="internGroupTab(${id}, '${key}')">${label}</button>`,
      ).join("")}</div>
      <div id="igPanel${id}"></div>
    </div>
  </div>`;
}
function mentorInfoCard(m, label) {
  const rows = [
    ["Email công việc", m.email ? `<a href="mailto:${escapeHtml(m.email)}">${escapeHtml(m.email)}</a>` : "—"],
    ["Phòng ban", escapeHtml(m.department || "—")],
    ["Chuyên môn", escapeHtml(m.specialization || "—")],
  ];
  return `<div class="card" style="margin-bottom:10px;padding:12px 16px"><h4 style="margin:0 0 6px">${escapeHtml(m.fullName)} ${pill(label, label === "Mentor chính" ? "ar-b-present" : "ar-b-pending")}</h4><table><tbody>${rows.map(([l, v]) => igRow(l, v)).join("")}</tbody></table></div>`;
}
function igPanelHtml(g, tab) {
  if (tab === "overview") {
    const rows = [
      igRow("Tên nhóm", escapeHtml(g.name)),
      igRow("Chương trình thực tập", escapeHtml(g.programName)),
      igRow("Trạng thái", igStatus(g)),
      igRow("Loại nhóm", g.isPrimary ? "Nhóm chính" : "Nhóm phụ"),
      igRow("Ngày vào nhóm", escapeHtml(pgFormat(g.joinedAt))),
      igRow("Thời gian chương trình", escapeHtml(mgDateRange(g))),
      igRow("Số thành viên", Number(g.memberCount)),
      igRow("Mentor chính", g.mentors?.main ? escapeHtml(g.mentors.main.fullName) : "Chưa có"),
    ];
    return `${g.description ? `<p>${escapeHtml(g.description)}</p>` : ""}<div class="table-container"><table><tbody>${rows.join("")}</tbody></table></div>`;
  }
  if (tab === "members")
    return g.members.length
      ? `<div class="table-container"><table><thead><tr><th>Họ tên</th><th>Trường</th><th>Ngành</th><th>Vào nhóm</th></tr></thead><tbody>${g.members
          .map(
            (m) =>
              `<tr><td><b>${escapeHtml(m.fullName)}</b>${m.isSelf ? " (bạn)" : ""}</td><td>${escapeHtml(m.university || "—")}</td><td>${escapeHtml(m.major || "—")}</td><td>${escapeHtml(pgFormat(m.joinedAt))}</td></tr>`,
          )
          .join("")}</tbody></table></div><p class="fr-hint">Chỉ hiển thị thông tin học tập cơ bản của các thành viên.</p>`
      : '<p class="fr-hint">Nhóm chưa có thành viên.</p>';
  if (tab === "mentors") {
    const { main, support } = g.mentors || {};
    return (
      (main
        ? mentorInfoCard(main, "Mentor chính")
        : '<p class="fr-hint">Bạn chưa được phân công mentor chính.</p>') +
      (support && support.length
        ? support.map((m) => mentorInfoCard(m, "Mentor hỗ trợ")).join("")
        : '<p class="fr-hint">Nhóm chưa có mentor hỗ trợ.</p>') +
      '<p class="fr-hint">Chỉ hiển thị thông tin công việc mentor cho phép công khai.</p>'
    );
  }
  if (tab === "schedule") return '<p class="fr-hint">Đang tải lịch làm việc...</p>';
  const list = g.upcomingMeetings || [];
  return `${
    list.length
      ? `<div class="table-container"><table><thead><tr><th>Thời gian</th><th>Nội dung</th><th>Địa điểm</th><th>Người tổ chức</th><th>Trạng thái</th><th></th></tr></thead><tbody>${list
          .map(
            (m) =>
              `<tr><td>${escapeHtml(mgMeetingTime(m))}</td><td><b>${escapeHtml(m.title)}</b></td><td>${escapeHtml(m.location || (m.meetingLink ? "Trực tuyến" : "—"))}</td><td>${escapeHtml(m.organizerName || "—")}</td><td>${m.state === "ONGOING" ? pill("Đang diễn ra", "ar-b-present") : pill("Sắp diễn ra", "ar-b-pending")}</td><td><button class="btn btn-sm btn-outline-primary" onclick="internGroupOpenMeeting(${Number(m.id)})">Xem</button></td></tr>`,
          )
          .join("")}</tbody></table></div>`
      : '<p class="fr-hint">Chưa có lịch họp sắp tới của nhóm.</p>'
  }<div style="margin-top:10px"><button class="btn btn-sm btn-outline-primary" onclick="switchTab('tab-my-schedule')">Xem tất cả lịch họp</button></div>`;
}
function igScheduleHtml(data) {
  if (!data) return '<p class="text-danger">Không tải được lịch làm việc.</p>';
  const labels = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"],
    days = [...(data.schedule.days || [])].sort((a, b) => a.weekday - b.weekday),
    fixed = data.schedule.mode === "FIXED";
  return `<p>Lịch của bạn: <b>${escapeHtml(data.schedule.summary)}</b> · theo ${escapeHtml(data.source.label)}</p>
    <div class="table-container"><table><thead><tr><th>Thứ</th><th>Làm việc</th><th>Hình thức</th>${fixed ? "<th>Giờ</th>" : ""}</tr></thead><tbody>${days
      .map(
        (d) =>
          `<tr><td>${labels[d.weekday - 1]}</td><td>${d.isWorking ? "Có" : "Nghỉ"}</td><td>${d.isWorking ? (d.workType === "ONLINE" ? "Online" : "Offline") : "—"}</td>${fixed ? `<td>${d.isWorking ? `${escapeHtml(d.startTime || "")}–${escapeHtml(d.endTime || "")}` : "—"}</td>` : ""}</tr>`,
      )
      .join("")}</tbody></table></div>`;
}
async function internGroupTab(groupId, tab) {
  const g = igFind(groupId),
    panel = document.getElementById(`igPanel${Number(groupId)}`);
  if (!g || !panel) return;
  for (const [key] of IG_TABS) {
    const button = document.getElementById(`igTab${Number(groupId)}_${key}`);
    if (!button) continue;
    button.classList.toggle("btn-primary", key === tab);
    button.classList.toggle("btn-outline-primary", key !== tab);
    button.setAttribute("aria-selected", key === tab ? "true" : "false");
  }
  panel.innerHTML = igPanelHtml(g, tab);
  if (tab !== "schedule") return;
  // Lịch làm việc là của riêng thực tập sinh (ưu tiên: cá nhân > nhóm > chương trình > mặc định), nên chỉ tải một lần.
  if (internGroupSchedule === undefined) {
    const result = await wrRequest("/me/work-schedule");
    internGroupSchedule = result && result.res.ok ? result.body.data : null;
  }
  if (panel.isConnected && document.getElementById(`igTab${Number(groupId)}_schedule`)?.classList.contains("btn-primary"))
    panel.innerHTML = igScheduleHtml(internGroupSchedule);
}
function internGroupOpenMeeting(id) {
  meetingMine = true; // Intern xem chi tiết qua /me/meetings
  openMeeting(id);
}
