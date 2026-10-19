const MEETING_EMAIL_LABELS = {
  MEETING_INVITE: "Mời họp",
  MEETING_UPDATED: "Cập nhật lịch",
  MEETING_CANCELLED: "Hủy / đổi người tham dự",
  MEETING_REMINDER: "Nhắc họp",
};
const MEETING_STATUS_LABELS = {
  PENDING: "Đang chờ gửi",
  RETRYING: "Đang thử lại",
  SENT: "Đã gửi",
  FAILED: "Lỗi gửi",
};
let meetingPage = 1,
  meetingMine = false,
  meetingListRequest = 0,
  meetingModalRequest = 0,
  meetingPoll = null,
  meetingReturnFocus = null,
  meetingEditId = null,
  meetingRequestKey = null,
  meetingSelected = new Map();
const meetingTime = (value) =>
  formatDateTime(String(value).replace(" ", "T") + "+07:00");
document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-meeting-action]");
  if (!button) return;
  const action = button.dataset.meetingAction,
    id = Number(button.dataset.id);
  try {
    if (action === "close") closeMeetingModal();
    else if (action === "create") await editMeeting();
    else if (action === "detail") await openMeeting(id);
    else if (action === "edit") await editMeeting(id);
    else if (action === "previous" || action === "next") {
      meetingPage += action === "next" ? 1 : -1;
      await loadMeetings();
    } else if (action === "search") {
      const data = await meetingRequest(
        `/meetings/options?q=${encodeURIComponent(document.getElementById("meetingAttendeeSearch").value)}`,
      );
      if (document.getElementById("meetingAttendees"))
        renderMeetingAttendees(data.interns);
    } else if (
      action === "cancel" &&
      confirm("Hủy cuộc họp và gửi thông báo cho người tham dự?")
    ) {
      button.disabled = true;
      await meetingRequest(`/meetings/${id}/cancel`, {
        method: "POST",
        body: "{}",
      });
      await loadMeetings();
      await openMeeting(id);
    } else if (action === "retry") {
      button.disabled = true;
      await meetingRequest(
        `/meetings/${id}/emails/${Number(button.dataset.logId)}/retry`,
        { method: "POST", body: "{}" },
      );
      await openMeeting(id);
    }
  } catch (err) {
    document.getElementById("meetingModalError").textContent = err.message;
  } finally {
    if (button.isConnected) button.disabled = false;
  }
});
document.getElementById("meetingModal").addEventListener("click", (event) => {
  if (event.target.id === "meetingModal") closeMeetingModal();
});
document.addEventListener("keydown", (event) => {
  const modal = document.getElementById("meetingModal");
  if (modal.style.display !== "flex") return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeMeetingModal();
  } else if (event.key === "Tab") {
    const items = [
        ...modal.querySelectorAll("button,input,select,textarea,a[href]"),
      ].filter((el) => !el.disabled && el.getClientRects().length),
      first = items[0],
      last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-report-export]");
  if (button)
    exportReport(
      button.dataset.reportExport,
      button.dataset.exportFormat,
      button,
      button.dataset.reportId,
    );
});

const sidebarMedia = window.matchMedia("(max-width: 1024px)");

// Danh sách định nghĩa các quyền trong hệ thống
const PERMISSIONS_DEF = [
  {
    code: "MANAGE_USERS",
    name: "Quản lý tài khoản",
    tabId: "tab-users",
    icon: "fa-users",
  },
  {
    code: "SYSTEM_SETTINGS",
    name: "Phân quyền vai trò",
    tabId: "tab-permissions",
    icon: "fa-shield-halved",
  },
  {
    code: "ASSIGN_TASKS",
    name: "Giao nhiệm vụ & Task",
    tabId: "tab-tasks",
    icon: "fa-list-check",
  },
  {
    code: "SUBMIT_WORK",
    name: "Nộp báo cáo công việc",
    tabId: "tab-submissions",
    icon: "fa-file-arrow-up",
  },
  {
    code: "VIEW_REPORTS",
    name: "Báo cáo & Thống kê",
    tabId: "tab-reports",
    icon: "fa-chart-line",
  },
];

const REPORT_SUBTABS = [
  "tab-completion-rate",
  "tab-final-reports",
  "tab-attendance-report",
  "tab-intern-origin-report",
];
let currentRole = "Admin";
let currentTab = "tab-users";
let permissionsMap = {};
let usersList = [];

// =========================================================================
// KHỞI TẠO VÀ TẢI DỮ LIỆU BAN ĐẦU
// =========================================================================
window.addEventListener("DOMContentLoaded", async () => {
  initSidebarNavigation();
  // Đọc phiên đăng nhập từ sessionStorage nếu có
  const storedUser = sessionStorage.getItem("currentUser");
  const token = getAuthToken();

  if (!storedUser || !token) {
    forceLogout();
    return;
  }

  try {
    const user = JSON.parse(storedUser);
    if (user.role) {
      currentRole = user.role;
    }
    renderUserMenu(user);
  } catch (e) {
    forceLogout();
    return;
  }

  await loadPermissions();
  if (getRolePermissions(currentRole).includes("MANAGE_USERS")) {
    await loadUsers();
  } else {
    usersList = [];
  }
  currentTab = getDefaultTabForRole(currentRole);
  updateRoleContext();
});

// Đóng menu tài khoản khi click ra ngoài
document.addEventListener("click", (e) => {
  const bell = document.getElementById("notifBell");
  if (bell && !bell.contains(e.target))
    document.getElementById("notifDropdown").classList.remove("open");
  const menu = document.getElementById("userMenu");
  const dropdown = document.getElementById("userMenuDropdown");
  if (menu && dropdown && !menu.contains(e.target)) {
    dropdown.classList.remove("open");
  }
});

let isSupportBenefitsSubmenuOpen = null;
let isMySupportBenefitsSubmenuOpen = null;

let isAttendanceTimeSubmenuOpen = null;


// ---- state danh sách hồ sơ ----
let applicationsList = [];
let reviewingId = null; // id hồ sơ đang mở modal từ chối
const busyApplicationIds = new Set(); // hồ sơ đang gửi request

const STATUS_UI = {
  PENDING: { label: "Chờ duyệt", cls: "badge-pending" },
  APPROVED: { label: "Đã duyệt", cls: "badge-active" },
  REJECTED: { label: "Từ chối", cls: "badge-rejected" },
};

document.addEventListener("click", (e) => {
  const btn =
    e.target.closest &&
    e.target.closest(
      ".doc-download-btn[data-doc-id], .doc-view-btn[data-doc-id]",
    );
  if (!btn) return;
  const appId = Number(btn.dataset.appId);
  const docId = Number(btn.dataset.docId);
  const name = btn.dataset.name || "document";
  if (btn.classList.contains("doc-view-btn"))
    viewDocumentFile(appId, docId, name);
  else downloadDocumentFile(appId, docId, name);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeRejectModal();
});

// =========================================================================
// QUẢN LÝ MENTOR & PHÒNG BAN (HR THÊM MỚI MENTOR)
// =========================================================================
let mentorsList = [];

// =========================================================================
// QUẢN LÝ HỒ SƠ THỰC TẬP SINH
// =========================================================================
let studentsList = [];
let studentFilterOptionsLoaded = false;
let studentUnfilteredCount = 0;
let studentSearchTimer = null;
let studentSearchRequest = 0;

// =========================================================================
// GIAO NHIỆM VỤ (MENTOR) & NHIỆM VỤ CỦA TÔI (INTERN)
// =========================================================================
let taskList = [];
let taskInterns = [];
let taskLoadSeq = 0;
const TASK_PRIORITY_UI = {
  HIGH: { label: "Cao", cls: "badge-rejected" },
  MEDIUM: { label: "Trung bình", cls: "badge-pending" },
  LOW: { label: "Thấp", cls: "badge-active" },
};
const TASK_STATUS_UI = {
  TODO: { label: "Chưa bắt đầu", cls: "badge-test" },
  IN_PROGRESS: { label: "Đang làm", cls: "badge-retrying" },
  DONE: { label: "Hoàn thành", cls: "badge-active" },
};

const TASK_ATTACHMENT_LIMIT = 5;
const TASK_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const TASK_ATTACHMENT_EXTS = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".png",
  ".jpg",
  ".jpeg",
  ".txt",
];

// ---- Cập nhật tiến độ (US12) ----
let myTaskList = [];
// =========================================================================
// BÁO CÁO TUẦN: thực tập sinh nộp (tab-submissions), mentor xem (tab-weekly-reports)
// =========================================================================
const WR_STATUS_UI = {
  SUBMITTED: { label: "Đã nộp", cls: "badge-active" },
  LATE_SUBMITTED: { label: "Nộp trễ", cls: "badge-retrying" },
  MISSING: { label: "Chưa nộp", cls: "badge-rejected" },
  UPCOMING: { label: "Chưa đến hạn", cls: "badge-test" },
};

let wrStatusData = null; // trạng thái các tuần của intern
let wrReportsByWeek = {}; // báo cáo đã nộp, key = ngày thứ Hai của tuần
let wrSelectedWeek = null;
let wrPendingFiles = [];
let wrMentorWeek = null; // thứ Hai của tuần mentor đang xem
let wrMentorReports = [];
let wrMentorOverview = null; // tổng quan tuần mentor đang xem (dùng để vẽ lại bảng)
const WR_FEEDBACK_MAX = 2000;
const WR_FEEDBACK_UI = {
  DONE: { label: "Đã phản hồi", cls: "badge-active" },
  PENDING: { label: "Chưa phản hồi", cls: "badge-pending" },
  OUTDATED: { label: "Báo cáo đã sửa", cls: "badge-retrying" },
};

// =========================================================================
// ĐÁNH GIÁ THỰC TẬP SINH (MENTOR): kỹ năng + thái độ (1-5) + nhận xét tổng kết
// =========================================================================
const EV_COMMENT_MAX = 2000;
let evOverview = null; // tổng quan đang hiển thị (dùng để vẽ lại bảng)
let evCurrentInternId = null; // thực tập sinh đang mở form
const EV_STATUS_UI = {
  DONE: { label: "Đã đánh giá", cls: "badge-active" },
  PENDING: { label: "Chưa đánh giá", cls: "badge-pending" },
};

let progressTaskId = null;
let progressPendingFiles = [];

// =========================================================================
// CẤU HÌNH EMAIL (SMTP) & NHẬT KÝ EMAIL (US 8)
// =========================================================================
let currentPageEmailLogs = 1;
let totalPagesEmailLogs = 1;
let emailMaxAttempts = 4;

// LOGIC QUẢN LÝ TÀI LIỆU HỒ SƠ ỨNG TUYỂN (INTERN & HR)
let myProfileState = null;
const uploadingTypes = new Set();

// HỢP ĐỒNG CỦA THỰC TẬP SINH
let scheduleManagerInternId = null;
let scheduleManagerInternName = "";
let scheduleMilestones = [];

let myScheduleMentor = null;
let myScheduleProgram = null;
let myScheduleMilestones = [];
let myScheduleMonth = null;
let myScheduleSelectedDate = "";
let myWorkSchedule = null; // lịch làm việc của intern (GET /me/work-schedule)
let myWorkHolidays = {}; // ngày nghỉ chung: { "YYYY-MM-DD": tên }
let myScheduleWarning = "";
let myScheduleView = "month"; // "week" | "month" | "list"
let myScheduleWeekStart = null;
let myScheduleMeetings = []; // lịch họp của intern (GET /me/meetings)
const myScheduleFilters = { work: true, internship: true, meeting: true };

let myContracts = [];
const confirmingMyContracts = new Set();

let contractsInternId = null;
let contractsViewOnly = false;
let contractPrograms = [];
let contractsData = [];
let programItems = [];
let programDepartments = [];
const programMaxDurationDays = 730;

// ---------- US12: HR xếp thực tập sinh vào chương trình và phân công mentor ----------
let pmProgramId = null,
  pmInterns = [],
  pmAvailable = [];
const programResultLabels = {
  IN_PROGRESS: "Đang thực tập",
  COMPLETED: "Hoàn thành",
  PAUSED: "Tạm dừng",
  NOT_COMPLETED: "Không hoàn thành",
};
const featureCss = document.createElement("style");
featureCss.textContent = `.attendance-action{width:100%;min-height:54px;font-size:1.1rem;margin-top:12px}.fr-signature{text-align:right;margin:48px 24px}.fr-print-table tr{break-inside:avoid;page-break-inside:avoid}@media print{body *{visibility:hidden!important}#frPrintable,#frPrintable *{visibility:visible!important}#frPrintable{position:absolute;inset:0;width:100%;font-size:10pt}#frPrintable table{width:100%;border-collapse:collapse}#frPrintable th,#frPrintable td{border:1px solid #555;padding:5px}#frPrintable tr{break-inside:avoid;page-break-inside:avoid}.fr-screen-controls{display:none!important}@page{size:A4;margin:15mm}}`;
document.head.appendChild(featureCss);

let attendanceServerNow = null;
let attendanceClockTimer = null;
let attendanceCorrectionId = null;
let finalReportOptions = { universities: [], programs: [] };
let editingFinalReportId = null;
const frCss = document.createElement("style");
frCss.textContent = `.fr-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 20px;margin-bottom:16px}.fr-field{display:flex;flex-direction:column;gap:6px;font-size:14.5px;font-weight:600;color:var(--slate-700)}.fr-field.fr-span-2{grid-column:1/-1}.fr-field input,.fr-field select,.fr-field textarea{width:100%;padding:10px 14px;border:1px solid var(--slate-300);border-radius:8px;font-size:15px;font-weight:400;background:#fff;outline:none;font-family:inherit}.fr-field textarea{min-height:90px;resize:vertical}.fr-field input:focus,.fr-field select:focus,.fr-field textarea:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(37,99,235,.15)}.fr-req{color:var(--danger)}.fr-hint{font-weight:400;color:var(--slate-600);font-size:13px}.fr-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:4px}.fr-row-actions{display:flex;flex-wrap:wrap;gap:6px}.fr-sub{display:block;font-size:13px;color:var(--slate-600);margin-top:2px}.fr-badge-final{background:#e0f2fe;color:#0369a1}.fr-screen-controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:16px}.fr-screen-controls h2{margin-right:auto}.fr-send-panel{flex-basis:100%;display:grid;gap:12px;border-top:1px solid var(--slate-200);padding-top:14px;margin-top:6px}.fr-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}.fr-chip-wrap{display:inline-flex;align-items:center;border:1px solid var(--slate-300);border-radius:20px;background:var(--slate-50);overflow:hidden}.fr-chip{border:0;background:transparent;padding:5px 10px;font-size:14px;cursor:pointer;color:var(--slate-800)}.fr-chip:hover{background:var(--primary-light)}.fr-chip-x{border:0;border-left:1px solid var(--slate-200);background:transparent;padding:5px 8px;cursor:pointer;color:var(--slate-600)}.fr-chip-x:hover{background:#fee2e2;color:var(--danger)}.fr-history{flex-basis:100%;font-size:14.5px}.fr-history ul{margin:8px 0 0 18px;display:grid;gap:6px}@media(max-width:700px){.fr-form-grid{grid-template-columns:1fr}}`;
document.head.appendChild(frCss);
const arCss = document.createElement("style");
arCss.textContent = `.ar-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px}.ar-stat{background:#fff;border:1px solid var(--slate-200);border-radius:12px;padding:14px 16px}.ar-stat span{display:block;font-size:13px;color:var(--slate-600)}.ar-stat strong{display:block;font-size:26.5px;margin-top:4px}.ar-stat.clickable{cursor:pointer}.ar-stat.clickable:hover{border-color:var(--primary)}.ar-rate{display:inline-block;padding:2px 10px;border-radius:12px;font-weight:700;font-size:14px;white-space:nowrap}.ar-rate-good{background:#dcfce7;color:#166534}.ar-rate-mid{background:#fef3c7;color:#92400e}.ar-rate-low{background:#fee2e2;color:#991b1b}.ar-rate-none{background:var(--slate-100);color:var(--slate-600)}.ar-badge{display:inline-block;padding:2px 9px;border-radius:12px;font-size:13px;font-weight:600;white-space:nowrap}.ar-b-present{background:#dcfce7;color:#166534}.ar-b-leave{background:#e0f2fe;color:#075985}.ar-b-absent{background:#fee2e2;color:#991b1b}.ar-b-pending{background:#fef3c7;color:#92400e}.ar-b-muted{background:var(--slate-100);color:var(--slate-600)}.ar-muted-row{opacity:.55}th.ar-sortable{cursor:pointer;user-select:none;white-space:nowrap}th.ar-sortable:hover{color:var(--primary)}.ws-day-grid td{padding:8px 12px}.ws-day-grid input[type=time]{padding:6px 10px;border:1px solid var(--slate-300);border-radius:8px}.ws-hide{display:none!important}.ar-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.ar-col-name{min-width:190px}.ar-col-group{min-width:230px}.card-body .fr-actions{margin-bottom:12px}.card-body .fr-actions+.fr-hint{margin-top:4px}`;
document.head.appendChild(arCss);

// ====================== US7 + US8: chuyên cần, lịch làm việc, nghỉ phép ======================
const WEEKDAY_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const DAY_STATUS = {
  PRESENT: ["Có mặt", "ar-b-present"],
  LEAVE: ["Nghỉ phép", "ar-b-leave"],
  ABSENT: ["Vắng", "ar-b-absent"],
  ABSENT_PENDING_LEAVE: ["Vắng (chờ duyệt nghỉ)", "ar-b-pending"],
  DAY_OFF: ["Ngày nghỉ", "ar-b-muted"],
  HOLIDAY: ["Ngày lễ", "ar-b-muted"],
  OUT_OF_CONTRACT: ["Ngoài hợp đồng", "ar-b-muted"],
  UPCOMING: ["Chưa tới", "ar-b-muted"],
};
const DAY_FLAGS = {
  LATE: "Đi muộn",
  EARLY_LEAVE: "Về sớm",
  SHORT_HOURS: "Thiếu giờ",
  MISSING_CHECKOUT: "Thiếu check-out",
  ADJUSTED: "Đã bổ sung check-out",
  WORKED_DURING_LEAVE: "Đi làm dù đã xin nghỉ",
};
const LEAVE_TYPE_LABEL = {
  SICK: "Nghỉ ốm",
  PERSONAL: "Việc cá nhân",
  EXAM: "Học / thi",
  OTHER: "Khác",
};
const LEAVE_STATUS_LABEL = {
  PENDING: ["Chờ duyệt", "ar-b-pending"],
  APPROVED: ["Đã duyệt", "ar-b-present"],
  REJECTED: ["Từ chối", "ar-b-absent"],
  CANCELLED: ["Đã hủy", "ar-b-muted"],
};
let workScopeOptions = null;
const SCOPE_LABEL = {
  UNIVERSITY: "Trường",
  PROGRAM: "Chương trình",
  GROUP: "Nhóm thực tập",
  MENTOR: "Mentor",
  INTERN: "Thực tập sinh",
};

// ---------- Báo cáo chuyên cần ----------
let attendanceReportData = null;
let attendanceReportSort = { key: "attendanceRate", dir: "asc" };
const AR_COLUMNS = [
  ["name", "Thực tập sinh"],
  ["schedule", "Nhóm / lịch"],
  ["requiredDays", "Phải đi"],
  ["presentDays", "Có mặt"],
  ["leaveDays", "Nghỉ phép"],
  ["absentDays", "Vắng"],
  ["pendingLeaveDays", "Chờ duyệt nghỉ"],
  ["lateCount", "Muộn"],
  ["earlyLeaveCount", "Về sớm"],
  ["missingCheckoutCount", "Thiếu check-out"],
  ["totalWorkMinutes", "Giờ làm"],
  ["attendanceRate", "Tỷ lệ"],
];
// US6: labels use textContent (no user text in HTML or inline JavaScript).
let crAppliedFilters = null;
let crReportRequest = 0;
let crDetailRequest = 0;
let crReturnFocus = null;
document.getElementById("crFilters").addEventListener("submit", (event) => {
  event.preventDefault();
  loadCompletionRate();
});
document
  .getElementById("crExport")
  .addEventListener("click", downloadCompletionRateCsv);
document
  .getElementById("crClose")
  .addEventListener("click", closeCompletionRateModal);
document
  .getElementById("tab-completion-rate")
  .addEventListener("click", (event) => {
    const button = event.target.closest(".cr-group");
    if (button)
      openCompletionRateGroup(
        button.dataset.dimension,
        button.dataset.key,
        button.dataset.name,
      );
  });
document.getElementById("crModal").addEventListener("click", (event) => {
  if (event.target.id === "crModal") closeCompletionRateModal();
});
document.addEventListener("keydown", (event) => {
  const modal = document.getElementById("crModal");
  if (modal.style.display !== "flex") return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeCompletionRateModal();
  }
  if (event.key === "Tab") {
    const focusable = Array.from(
      modal.querySelectorAll(
        "button:not(:disabled), [href], input, select, textarea, [tabindex='0']",
      ),
    );
    const first = focusable[0],
      last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
// END US6

// =========================================================================
// US5: THỐNG KÊ THỰC TẬP SINH THEO TRƯỜNG / NGÀNH (HR)
// =========================================================================
let internOriginData = null;
let iorSearchTimer = null;
let iorModalState = { university: null, major: null, page: 1 };
document.addEventListener("click", (event) => {
  const trigger = event.target.closest(".ior-detail-trigger");
  if (!trigger) return;
  event.stopPropagation();
  const requestedPage = Number(trigger.dataset.iorPage || 1);
  openInternOriginDetailModal(
    trigger.dataset.iorUniversity || "",
    trigger.dataset.iorMajor || "",
    requestedPage,
  );
});
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    document.getElementById("iorDetailModal")?.style.display === "flex"
  ) {
    closeInternOriginModal();
  }
});

// ---------- Lịch làm việc (HR thiết lập) ----------
let wsSchedules = [];
let wsEditingId = null;

// ---------- US30: HR xem / gán thực tập sinh từ tab Quản lý mentor ----------
let miMentorId = null,
  miAvailable = [];

// ---------- Chuông thông báo ----------
let notifTimer = null,
  notifUnread = 0,
  notifFirstLoad = true;
// =========================================================================
//  PHỤ CẤP THỰC TẬP SINH (HR): nhập, sửa, xóa và xem tổng quan phụ cấp
// =========================================================================
const ALLOWANCE_TYPE_LABELS = {
  MEAL: "Ăn uống",
  TRANSPORT: "Đi lại",
  PHONE: "Điện thoại",
  HOUSING: "Nhà ở",
  OTHER: "Khác",
};
const ALLOWANCE_CYCLE_LABELS = {
  MONTHLY: "Theo tháng",
  DAILY: "Theo ngày",
  ONE_TIME: "Một lần",
};
const ALLOWANCE_STATUS_BADGES = {
  ACTIVE: { label: "Đang hiệu lực", cls: "badge-approved" },
  UPCOMING: { label: "Sắp hiệu lực", cls: "badge-pending" },
  EXPIRED: { label: "Hết hạn", cls: "badge-expired" },
};
let allowancesInternId = null;
let allowanceItems = [];
let allowanceEditingId = null;
let allowanceSaving = false;
let allowanceSearchTimer = null;
let allowanceOverviewRequest = 0;
let allowanceUniversitiesLoaded = false;

// =========================================================================
//  PHỤ CẤP CỦA TÔI (Thực tập sinh): xem lịch sử các khoản phụ cấp, chỉ đọc
// =========================================================================
let myAllowancesRequest = 0;

const SUPPORT_TYPE_LABELS = {
  INTERNSHIP_CERTIFICATE: "Giấy xác nhận thực tập",
  INTRODUCTION_LETTER: "Giấy giới thiệu",
  INCOME_CONFIRMATION: "Xác nhận phụ cấp / thu nhập",
  DOCUMENT_SUPPORT: "Hỗ trợ giấy tờ",
  OTHER: "Khác",
};
const SUPPORT_STATUS_LABELS = {
  PENDING: "Chờ tiếp nhận",
  IN_PROGRESS: "Đang xử lý",
  RESOLVED: "Đã giải quyết",
  REJECTED: "Từ chối",
  CANCELLED: "Đã hủy",
};
const SUPPORT_MAX_REQUEST_FILES = 5,
  SUPPORT_MAX_RESULT_FILES = 3;
let supportPage = 1,
  supportSearchTimer = null,
  supportCurrent = null,
  supportActionBusy = false,
  supportNoteDraft = "";
document.addEventListener("keydown", (event) => {
  const modal = document.getElementById("supportHrModal");
  if (event.key === "Escape" && modal && modal.style.display === "flex")
    closeSupportModal();
});
