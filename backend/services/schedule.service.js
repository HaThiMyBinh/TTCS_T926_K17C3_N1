// Nghiệp vụ Quản lý & Tra cứu Lịch thực tập cá nhân (Internship Schedule & Milestones)
const db = require("../db");
const { HttpError } = require("../errors");
const { getVietnamToday } = require("../utils/date");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isValidDate(value) {
  if (!value || typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseDateUtc(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDateUtc(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Ngày hiện tại luôn theo giờ Việt Nam; `override` chỉ dùng cho test.
function getTodayString(override) {
  if (override && isValidDate(override)) return override;
  return getVietnamToday();
}

function diffDays(startStr, endStr) {
  const s = parseDateUtc(startStr);
  const e = parseDateUtc(endStr);
  return Math.round((e.getTime() - s.getTime()) / MS_PER_DAY) + 1;
}

function addDays(dateStr, days) {
  const d = parseDateUtc(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDateUtc(d);
}

function selectConfirmedContract(contracts = []) {
  return (
    contracts.find((contract) => contract.confirmationStatus === "CONFIRMED") ||
    null
  );
}

/**
 * Tính toán tổng quan tiến độ thời gian thực tập
 */
function calculateTimelineSummary({
  startDate,
  endDate,
  todayStr,
  milestones = [],
}) {
  const today = getTodayString(todayStr);

  const totalMilestones = milestones.length;
  const completedMilestones = milestones.filter(
    (m) => m.status === "COMPLETED",
  ).length;
  const inProgressMilestones = milestones.filter(
    (m) => m.status === "IN_PROGRESS",
  ).length;

  if (
    !startDate ||
    !endDate ||
    !isValidDate(startDate) ||
    !isValidDate(endDate)
  ) {
    return {
      start_date: startDate || null,
      end_date: endDate || null,
      duration_days: null,
      days_elapsed: null,
      days_remaining: null,
      progress_percent:
        totalMilestones > 0
          ? Math.round((completedMilestones / totalMilestones) * 100)
          : 0,
      time_state: "UNSCHEDULED",
      time_state_text: "Chưa đặt lịch",
      total_milestones: totalMilestones,
      completed_milestones: completedMilestones,
      in_progress_milestones: inProgressMilestones,
    };
  }

  const durationDays = diffDays(startDate, endDate);
  if (durationDays <= 0) {
    return {
      start_date: startDate,
      end_date: endDate,
      duration_days: 0,
      days_elapsed: 0,
      days_remaining: 0,
      progress_percent: 0,
      time_state: "UNSCHEDULED",
      time_state_text: "Ngày không hợp lệ",
      total_milestones: totalMilestones,
      completed_milestones: completedMilestones,
      in_progress_milestones: inProgressMilestones,
    };
  }

  let daysElapsed = 0;
  let daysRemaining = 0;
  let progressPercent = 0;
  let timeState = "RUNNING";
  let timeStateText = "Đang diễn ra";

  if (today < startDate) {
    timeState = "UPCOMING";
    timeStateText = "Sắp diễn ra";
    daysElapsed = 0;
    daysRemaining = durationDays;
    progressPercent = 0;
  } else if (today > endDate) {
    timeState = "ENDED";
    timeStateText = "Đã kết thúc";
    daysElapsed = durationDays;
    daysRemaining = 0;
    progressPercent = 100;
  } else {
    timeState = "RUNNING";
    timeStateText = "Đang diễn ra";
    daysElapsed = diffDays(startDate, today);
    daysRemaining = Math.max(0, durationDays - daysElapsed);
    progressPercent = Math.min(
      100,
      Math.max(0, Math.round((daysElapsed / durationDays) * 100)),
    );
  }

  return {
    start_date: startDate,
    end_date: endDate,
    duration_days: durationDays,
    days_elapsed: daysElapsed,
    days_remaining: daysRemaining,
    progress_percent: progressPercent,
    time_state: timeState,
    time_state_text: timeStateText,
    total_milestones: totalMilestones,
    completed_milestones: completedMilestones,
    in_progress_milestones: inProgressMilestones,
  };
}

/**
 * Tạo danh sách các giai đoạn / mốc tiêu chuẩn theo mẫu kế hoạch thực tập doanh nghiệp (BM02)
 */
function getDefaultMilestones(startDate, endDate) {
  const baseTemplates = [
    {
      phase_order: 1,
      title: "Onboarding & Huấn luyện kỹ năng làm việc doanh nghiệp",
      duration_weeks: "2 tuần",
      description:
        "Tìm hiểu văn hóa doanh nghiệp, nội quy dự án, tiếp nhận môi trường làm việc và các công cụ quản lý dự án (Git, Jira).",
      expected_results:
        "Nắm rõ văn hóa, quy định dự án; sẵn sàng mindset làm việc chuyên nghiệp.",
    },
    {
      phase_order: 2,
      title: "Phát triển dự án Web - Sprint 1 (Tính năng cốt lõi)",
      duration_weeks: "1 tuần",
      description:
        "Thiết lập quy trình Agile/Scrum, khởi tạo bảng công việc. Xây dựng xác thực, phân quyền (RBAC) và quản lý hồ sơ thực tập sinh, mentor.",
      expected_results:
        "Hoàn thiện các tính năng cốt lõi: Tạo tài khoản, phân quyền RBAC, đăng ký tài khoản trực tuyến, quản lý hồ sơ TTS và Mentor.",
    },
    {
      phase_order: 3,
      title: "Phát triển dự án Web - Sprint 2 (Xét duyệt & Hợp đồng)",
      duration_weeks: "1 tuần",
      description:
        "Hoàn thiện luồng xét duyệt hồ sơ ứng tuyển, tự động gửi email thông báo kết quả, upload tài liệu CV & đơn xin thực tập, tải lên và xác nhận hợp đồng thực tập.",
      expected_results:
        "Quy trình xét duyệt hồ sơ hoạt động trơn tru; ứng viên nhận email tự động; hợp đồng được ký và xác nhận trực tuyến.",
    },
    {
      phase_order: 4,
      title: "Phát triển dự án Web - Sprint 3 (Kế hoạch & Lịch thực tập)",
      duration_weeks: "1 tuần",
      description:
        "Hoàn thiện tạo chương trình thực tập theo phòng ban, thiết lập thời gian đào tạo, phân công thực tập sinh cho mentor, tra cứu lịch thực tập cá nhân và giao nhiệm vụ.",
      expected_results:
        "Thực tập sinh tra cứu được lịch thực tập cá nhân và kế hoạch đào tạo; mentor và HR quản lý tiến độ hiệu quả.",
    },
    {
      phase_order: 5,
      title: "Phát triển dự án Web - Sprint 4 (Kiểm thử, Tối ưu & Báo cáo)",
      duration_weeks: "1 tuần",
      description:
        "Tối ưu hóa hiệu năng, tích hợp giao diện UI/UX, sửa toàn bộ bug và thực hiện kiểm thử tự động toàn diện (End-to-End Testing).",
      expected_results:
        "Hệ thống Web chạy mượt mà không còn lỗi; vượt qua 100% kịch bản kiểm thử tự động; chuẩn bị tài liệu nghiệm thu.",
    },
    {
      phase_order: 6,
      title: "Đánh giá & Tổng kết kỳ thực tập",
      duration_weeks: "1 tuần",
      description:
        "Mentor và đơn vị quản lý đánh giá kết quả thực tập, tổng kết kiến thức kỹ năng đạt được và nghiệm thu báo cáo thực tập cơ sở.",
      expected_results:
        "Hoàn thành báo cáo thực tập cơ sở đạt yêu cầu; nhận đánh giá và chứng nhận hoàn thành từ doanh nghiệp.",
    },
  ];

  if (
    !startDate ||
    !endDate ||
    !isValidDate(startDate) ||
    !isValidDate(endDate) ||
    endDate < startDate
  )
    return [];

  // Chia khoảng ngày theo tỷ lệ thời gian giữa startDate và endDate
  const totalDays = diffDays(startDate, endDate);
  const weights = [0.22, 0.15, 0.15, 0.16, 0.16, 0.16];
  let curStart = startDate;

  return baseTemplates.map((t, idx) => {
    let pDays = Math.max(1, Math.round(totalDays * weights[idx]));
    if (idx === baseTemplates.length - 1) {
      // Giai đoạn cuối cùng kết thúc đúng endDate
      const mEnd = endDate;
      return {
        ...t,
        start_date: curStart,
        end_date: mEnd,
        status: "NOT_STARTED",
      };
    }
    const mEnd = addDays(curStart, pDays - 1);
    const item = {
      ...t,
      start_date: curStart,
      end_date: mEnd > endDate ? endDate : mEnd,
      status: "NOT_STARTED",
    };
    curStart = addDays(mEnd, 1);
    if (curStart > endDate) curStart = endDate;
    return item;
  });
}

function formatVnDate(dateStr) {
  return String(dateStr).split("-").reverse().join("/");
}

/**
 * Cảnh báo khi lịch đã lưu không còn phù hợp với hợp đồng/chương trình.
 * Quy tắc: mốc lịch phải nằm trong hợp đồng (hoặc trong chương trình nếu hợp đồng
 * thiếu ngày), và hợp đồng phải nằm trong chương trình. Không yêu cầu trùng khít:
 * hợp đồng có thể vào muộn/ra sớm hơn chương trình, mốc có thể chừa ngày đệm.
 */
function computeScheduleSyncWarning({
  contract,
  program,
  milestoneStart,
  milestoneEnd,
}) {
  if (!milestoneStart && !milestoneEnd) return null;
  const hasRange = (range) => Boolean(range?.start_date && range?.end_date);
  const issues = [];

  const reference = hasRange(contract)
    ? { label: "hợp đồng", range: contract }
    : hasRange(program)
      ? { label: "chương trình", range: program }
      : null;
  if (
    reference &&
    ((milestoneStart && milestoneStart < reference.range.start_date) ||
      (milestoneEnd && milestoneEnd > reference.range.end_date))
  ) {
    issues.push(
      `Có mốc lịch nằm ngoài khoảng ${reference.label} (${formatVnDate(reference.range.start_date)} – ${formatVnDate(reference.range.end_date)}).`,
    );
  }

  if (
    hasRange(contract) &&
    hasRange(program) &&
    (contract.start_date < program.start_date ||
      contract.end_date > program.end_date)
  ) {
    issues.push(
      `Thời gian hợp đồng nằm ngoài thời gian của chương trình (${formatVnDate(program.start_date)} – ${formatVnDate(program.end_date)}).`,
    );
  }

  return issues.length
    ? `${issues.join(" ")} Mốc được giữ nguyên; HR/Mentor cần rà soát và cập nhật thủ công.`
    : null;
}

/**
 * Chuẩn bị DTO đầy đủ về lịch thực tập cá nhân cho thực tập sinh
 */
async function buildScheduleDto(intern, todayOverride) {
  if (!intern) throw new HttpError(404, "Không tìm thấy hồ sơ thực tập sinh!");

  const todayStr = getTodayString(todayOverride);

  // 1. Thông tin Mentor
  let mentor = null;
  if (intern.mentorId) {
    mentor = await db.findMentorById(intern.mentorId);
  }

  // 2. Hợp đồng thực tập
  const contracts = await db.listContractsByInternId(intern.id);
  const activeContract = selectConfirmedContract(contracts);

  // Chỉ theo chương trình được liên kết trực tiếp trên hợp đồng.
  const program = activeContract?.programId
    ? await db.findProgramById(activeContract.programId)
    : null;

  // Khoảng hợp đồng đã xác nhận được ưu tiên; nếu thiếu ngày thì dùng ngày của chương trình liên kết.
  let overallStart = activeContract?.startDate || program?.start_date || null;
  let overallEnd = activeContract?.endDate || program?.end_date || null;

  // GET chỉ đọc lịch đã lưu, không khởi tạo dữ liệu.
  const rawMilestones = await db.listScheduleMilestones(intern.id);

  // Nếu chưa có ngày từ contract hay program, lấy từ milestones
  if (!overallStart && rawMilestones.length > 0) {
    const validStarts = rawMilestones.map((m) => m.startDate).filter(Boolean);
    if (validStarts.length > 0) overallStart = validStarts.sort()[0];
  }
  if (!overallEnd && rawMilestones.length > 0) {
    const validEnds = rawMilestones.map((m) => m.endDate).filter(Boolean);
    if (validEnds.length > 0) overallEnd = validEnds.sort().reverse()[0];
  }

  // Cập nhật trạng thái hiển thị cho từng mốc dựa trên thời gian thực tế
  const milestones = rawMilestones.map((m) => {
    let computedStatus = m.status;
    if (m.status === "NOT_STARTED") {
      if (m.endDate && todayStr > m.endDate) {
        computedStatus = "COMPLETED";
      } else if (
        m.startDate &&
        m.endDate &&
        todayStr >= m.startDate &&
        todayStr <= m.endDate
      ) {
        computedStatus = "IN_PROGRESS";
      }
    }
    return {
      id: Number(m.id),
      intern_id: Number(m.internId),
      phase_order: Number(m.phaseOrder),
      title: m.title,
      start_date: m.startDate,
      end_date: m.endDate,
      duration_weeks: m.durationWeeks || null,
      description: m.description || "",
      expected_results: m.expectedResults || "",
      status: computedStatus,
    };
  });
  const milestoneStart =
    milestones
      .map((m) => m.start_date)
      .filter(Boolean)
      .sort()[0] || null;
  const milestoneEnd =
    milestones
      .map((m) => m.end_date)
      .filter(Boolean)
      .sort()
      .reverse()[0] || null;
  const scheduleSyncWarning = computeScheduleSyncWarning({
    contract: activeContract
      ? {
          start_date: activeContract.startDate,
          end_date: activeContract.endDate,
        }
      : null,
    program,
    milestoneStart,
    milestoneEnd,
  });

  const timelineSummary = calculateTimelineSummary({
    startDate: overallStart,
    endDate: overallEnd,
    todayStr: todayStr,
    milestones,
  });

  return {
    intern: {
      id: Number(intern.id),
      student_code: intern.studentCode || "",
      full_name: intern.fullName,
      email: intern.email,
      phone: intern.phone || "",
      university: intern.university || "",
      major: intern.major || "",
      status: intern.status || "Đang thực tập",
    },
    mentor: mentor
      ? {
          id: Number(mentor.id),
          full_name: mentor.fullName,
          email: mentor.email,
          phone: mentor.phone || "",
          department: mentor.department || "",
          specialization: mentor.specialization || "",
        }
      : null,
    contract: activeContract
      ? {
          id: Number(activeContract.id),
          title: activeContract.title || "Hợp đồng thực tập sinh",
          start_date: activeContract.startDate,
          end_date: activeContract.endDate,
          confirmation_status: activeContract.confirmationStatus || "PENDING",
          note: activeContract.note || "",
        }
      : null,
    program: program
      ? {
          id: Number(program.id),
          name: program.name,
          department_name: program.department_name,
          description: program.description || "",
          start_date: program.start_date,
          end_date: program.end_date,
          status: program.status,
        }
      : null,
    timeline_summary: timelineSummary,
    milestones,
    schedule_status: milestones.length ? "SCHEDULED" : "EMPTY",
    schedule_status_text: milestones.length ? "Đã có lịch" : "Chưa có lịch",
    schedule_sync_warning: scheduleSyncWarning,
  };
}

/**
 * Lấy lịch thực tập cho tài khoản Intern đang đăng nhập
 */
async function getScheduleForInternUser(user, todayOverride) {
  if (!user?.email) {
    throw new HttpError(404, "Tài khoản chưa có hồ sơ thực tập sinh!");
  }
  const intern = await db.findInternProfileByEmail(user.email);
  if (!intern) {
    throw new HttpError(404, "Tài khoản chưa có hồ sơ thực tập sinh!");
  }
  return buildScheduleDto(intern, todayOverride);
}

/**
 * Lấy lịch thực tập theo ID thực tập sinh (dành cho Admin, HR, Mentor)
 */
async function getScheduleForInternId(rawInternId, todayOverride, user = null) {
  if (!/^\d+$/.test(String(rawInternId))) {
    throw new HttpError(400, "Mã thực tập sinh không hợp lệ!");
  }
  const internId = Number(rawInternId);
  const intern = await db.findInternProfileById(internId);
  if (!intern) {
    throw new HttpError(404, "Không tìm thấy hồ sơ thực tập sinh!");
  }
  if (user) await authorizeScheduleManager(user, intern);
  return buildScheduleDto(intern, todayOverride);
}

async function authorizeScheduleManager(user, intern) {
  if (user?.role === "HR" || user?.role === "Admin") return true;
  if (user?.role !== "Mentor" || !user.email)
    throw new HttpError(403, "Bạn không có quyền quản lý lịch thực tập này!");
  const mentor = await db.findMentorByEmail(user.email);
  if (!mentor || Number(intern.mentorId) !== Number(mentor.id))
    throw new HttpError(
      403,
      "Bạn chỉ được quản lý lịch của thực tập sinh được phân công cho mình!",
    );
  return true;
}

function validateMilestone(input, partial = false) {
  const value = {};
  const fields = [
    "phase_order",
    "title",
    "start_date",
    "end_date",
    "duration_weeks",
    "description",
    "expected_results",
    "status",
  ];
  for (const field of fields)
    if (Object.prototype.hasOwnProperty.call(input || {}, field))
      value[field] = input[field];
  if (partial && Object.keys(value).length === 0)
    throw new HttpError(400, "Cần gửi ít nhất một trường để cập nhật mốc!");
  if (
    !partial &&
    (!Number.isInteger(Number(value.phase_order)) ||
      Number(value.phase_order) < 1 ||
      !String(value.title || "").trim())
  )
    throw new HttpError(400, "Cần phase_order và title hợp lệ!");
  if (value.phase_order !== undefined) {
    value.phase_order = Number(value.phase_order);
    if (!Number.isInteger(value.phase_order) || value.phase_order < 1)
      throw new HttpError(400, "phase_order phải là số nguyên dương!");
  }
  if (Object.prototype.hasOwnProperty.call(value, "title")) {
    value.title = String(value.title || "").trim();
    if (!value.title) throw new HttpError(400, "Tên mốc không được để trống!");
  }
  for (const field of ["start_date", "end_date"]) {
    if (value[field] && !isValidDate(value[field]))
      throw new HttpError(400, `${field} không hợp lệ!`);
  }
  if (value.start_date && value.end_date && value.end_date < value.start_date) {
    throw new HttpError(400, "Ngày kết thúc phải bằng hoặc sau ngày bắt đầu!");
  }
  if (
    value.status &&
    !["NOT_STARTED", "IN_PROGRESS", "COMPLETED"].includes(value.status)
  ) {
    throw new HttpError(400, "Trạng thái mốc không hợp lệ!");
  }
  return value;
}

async function getConfirmedContractRange(internId) {
  const contracts = await db.listContractsByInternId(internId);
  const contract = selectConfirmedContract(contracts);
  if (!contract?.startDate || !contract?.endDate) return null;
  return { start: contract.startDate, end: contract.endDate };
}

function assertMilestoneWithinRange(milestone, range) {
  if (!range) return;
  if (
    !milestone.start_date ||
    !milestone.end_date ||
    milestone.start_date < range.start ||
    milestone.end_date > range.end
  ) {
    throw new HttpError(
      400,
      `Ngày mốc phải nằm trọn trong khoảng hợp đồng đã xác nhận (${range.start} – ${range.end})!`,
    );
  }
}

function conflictOnDuplicate(error) {
  if (error?.code === "ER_DUP_ENTRY")
    throw new HttpError(
      409,
      "phase_order này đã được dùng cho một mốc khác của thực tập sinh!",
    );
  throw error;
}

async function manageMilestones(
  user,
  rawInternId,
  action,
  rawMilestoneId,
  body = {},
) {
  const id = Number(rawInternId);
  if (!/^\d+$/.test(String(rawInternId)))
    throw new HttpError(400, "Mã thực tập sinh không hợp lệ!");
  const intern = await db.findInternProfileById(id);
  if (!intern) throw new HttpError(404, "Không tìm thấy hồ sơ thực tập sinh!");
  await authorizeScheduleManager(user, intern);
  if (action === "create") {
    const milestone = validateMilestone(body);
    assertMilestoneWithinRange(milestone, await getConfirmedContractRange(id));
    try {
      await db.insertScheduleMilestone(id, milestone);
    } catch (error) {
      conflictOnDuplicate(error);
    }
    return db.listScheduleMilestones(id);
  }
  if (action === "update") {
    const milestoneId = Number(rawMilestoneId);
    if (!/^\d+$/.test(String(rawMilestoneId)))
      throw new HttpError(400, "Mã mốc không hợp lệ!");
    const found = await db.findMilestoneById(milestoneId);
    if (!found || Number(found.internId) !== id)
      throw new HttpError(404, "Không tìm thấy mốc lịch!");
    const changes = validateMilestone(body, true);
    const changesDates =
      Object.prototype.hasOwnProperty.call(changes, "start_date") ||
      Object.prototype.hasOwnProperty.call(changes, "end_date");
    if (changesDates) {
      const merged = {
        start_date: changes.start_date ?? found.startDate,
        end_date: changes.end_date ?? found.endDate,
      };
      assertMilestoneWithinRange(merged, await getConfirmedContractRange(id));
    }
    try {
      await db.updateScheduleMilestone(id, milestoneId, changes);
    } catch (error) {
      conflictOnDuplicate(error);
    }
    return db.listScheduleMilestones(id);
  }
  if (action === "delete") {
    const milestoneId = Number(rawMilestoneId);
    if (!/^\d+$/.test(String(rawMilestoneId)))
      throw new HttpError(400, "Mã mốc không hợp lệ!");
    if (!(await db.deleteScheduleMilestone(id, milestoneId)))
      throw new HttpError(404, "Không tìm thấy mốc lịch!");
    return db.listScheduleMilestones(id);
  }
  const dates = await getScheduleForInternId(id);
  if (!dates.contract?.start_date || !dates.contract?.end_date)
    throw new HttpError(
      409,
      "Cần hợp đồng CONFIRMED có ngày bắt đầu và kết thúc để tạo mẫu!",
    );
  const defaults = getDefaultMilestones(
    dates.contract.start_date,
    dates.contract.end_date,
  );
  if (!defaults.length)
    throw new HttpError(409, "Khoảng ngày hợp đồng không hợp lệ!");
  if ((await db.listScheduleMilestones(id)).length) {
    throw new HttpError(
      409,
      "Đã có mốc lịch. Hãy xóa hoặc chỉnh sửa các mốc hiện tại trước khi tạo mẫu để tránh ghi đè hoặc tạo một phần!",
    );
  }
  try {
    await db.insertScheduleMilestonesAtomic(id, defaults);
  } catch (error) {
    conflictOnDuplicate(error);
  }
  return db.listScheduleMilestones(id);
}

module.exports = {
  isValidDate,
  calculateTimelineSummary,
  computeScheduleSyncWarning,
  getDefaultMilestones,
  buildScheduleDto,
  getScheduleForInternUser,
  getScheduleForInternId,
  manageMilestones,
  validateMilestone,
  authorizeScheduleManager,
  selectConfirmedContract,
  assertMilestoneWithinRange,
};
