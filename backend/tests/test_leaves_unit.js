function check(name, condition) {
  if (!condition) {
    console.error(`[FAIL] ${name}`);
    process.exitCode = 1;
  } else console.log(`[PASS] ${name}`);
}
const s = require("../services/leaves.service");
function throws400(fn) {
  try {
    fn();
    return false;
  } catch (e) {
    return e.status === 400;
  }
}
const TODAY = "2026-10-12";
const ok = { leave_type: "SICK", start_date: "2026-10-13", end_date: "2026-10-14", reason: " Sốt " };

// --- tạo đơn ---
const created = s.validateCreateBody(ok, TODAY);
check("create: hợp lệ, trim lý do", created.reason === "Sốt" && created.leaveType === "SICK");
check("create: mặc định PERSONAL", s.validateCreateBody({ ...ok, leave_type: undefined }, TODAY).leaveType === "PERSONAL");
check("create: loại nghỉ sai", throws400(() => s.validateCreateBody({ ...ok, leave_type: "X" }, TODAY)));
check("create: trường lạ", throws400(() => s.validateCreateBody({ ...ok, intern_id: 1 }, TODAY)));
check("create: ngày sai định dạng", throws400(() => s.validateCreateBody({ ...ok, start_date: "13/10/2026" }, TODAY)));
check("create: ngày không tồn tại", throws400(() => s.validateCreateBody({ ...ok, end_date: "2026-02-30" }, TODAY)));
check("create: bắt đầu sau kết thúc", throws400(() => s.validateCreateBody({ ...ok, start_date: "2026-10-15" }, TODAY)));
check("create: quá 30 ngày", throws400(() => s.validateCreateBody({ ...ok, end_date: "2026-11-20" }, TODAY)));
check("create: đúng 30 ngày được", !throws400(() => s.validateCreateBody({ ...ok, end_date: "2026-11-11" }, TODAY)));
check("create: nghỉ bù 7 ngày trước được", !throws400(() => s.validateCreateBody({ ...ok, start_date: "2026-10-05", end_date: "2026-10-05" }, TODAY)));
check("create: nghỉ bù quá 7 ngày", throws400(() => s.validateCreateBody({ ...ok, start_date: "2026-10-04", end_date: "2026-10-04" }, TODAY)));
check("create: thiếu lý do", throws400(() => s.validateCreateBody({ ...ok, reason: "  " }, TODAY)));
check("create: lý do quá dài", throws400(() => s.validateCreateBody({ ...ok, reason: "x".repeat(501) }, TODAY)));
check("create: body không phải object", throws400(() => s.validateCreateBody(null, TODAY)));

// --- lọc + phân trang ---
const d = s.validateListQuery({});
check("list: mặc định page 1, size 20", d.page === 1 && d.pageSize === 20 && Object.keys(d.filters).length === 0);
const f = s.validateListQuery({ status: "PENDING", from: "2026-10-01", to: "2026-10-31", intern_id: "5", page: "2", page_size: "50" });
check("list: parse đủ bộ lọc", f.filters.status === "PENDING" && f.filters.from === "2026-10-01" && f.filters.to === "2026-10-31" && f.filters.internId === 5 && f.page === 2 && f.pageSize === 50);
check("list: status sai", throws400(() => s.validateListQuery({ status: "pending" })));
check("list: from sai", throws400(() => s.validateListQuery({ from: "2026-13-01" })));
check("list: from > to", throws400(() => s.validateListQuery({ from: "2026-10-31", to: "2026-10-01" })));
check("list: khoảng > 366 ngày", throws400(() => s.validateListQuery({ from: "2025-01-01", to: "2026-10-01" })));
check("list: intern_id không phải số", throws400(() => s.validateListQuery({ intern_id: "abc" })));
check("list: intern_id = 0", throws400(() => s.validateListQuery({ intern_id: "0" })));
check("list: page = 0", throws400(() => s.validateListQuery({ page: "0" })));
check("list: page_size > 100", throws400(() => s.validateListQuery({ page_size: "101" })));
check("list: tham số lạ", throws400(() => s.validateListQuery({ foo: "1" })));
check("list: intern không được lọc intern_id ở /me", throws400(() => s.validateListQuery({ intern_id: "1" }, ["status", "from", "to", "page", "page_size"])));
check("list: tham số mảng bị từ chối", throws400(() => s.validateListQuery({ page: ["1", "2"] })));

// --- duyệt ---
check("review: APPROVED không cần note", s.validateReviewBody({ decision: "APPROVED" }).note === "");
check("review: REJECTED cần lý do", throws400(() => s.validateReviewBody({ decision: "REJECTED" })));
check("review: REJECTED có lý do", s.validateReviewBody({ decision: "REJECTED", note: " trùng lịch " }).note === "trùng lịch");
check("review: quyết định sai", throws400(() => s.validateReviewBody({ decision: "CANCELLED" })));
check("review: trường lạ", throws400(() => s.validateReviewBody({ decision: "APPROVED", status: "x" })));

// --- định dạng ---
const fmt = s.formatLeave({ id: 1, internId: 2, fullName: "A", studentCode: "S", leaveType: "SICK", startDate: "2026-10-13", endDate: "2026-10-14", totalDays: "2", reason: "r", status: "PENDING", createdAt: "x" });
check("format: totalDays là số, reviewNote null", fmt.totalDays === 2 && fmt.reviewNote === null && fmt.reviewedBy === null);
