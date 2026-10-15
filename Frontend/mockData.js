
/**
 * Story 2.2 - Dữ liệu giả lịch sử nhận phụ cấp.
 * Story 2.3 sẽ thay dữ liệu này bằng API GET /api/me/allowances.
 */
window.MOCK_ALLOWANCES = [
  {
    id: 1,
    period: "2026-01",
    receivedDate: "2026-01-31",
    amount: 1500000,
    status: "Đã nhận",
  },
  {
    id: 2,
    period: "2026-02",
    receivedDate: "2026-02-28",
    amount: 1500000,
    status: "Đã nhận",
  },
  {
    id: 3,
    period: "2026-03",
    receivedDate: "2026-03-31",
    amount: 1800000,
    status: "Đã nhận",
  },
  {
    id: 4,
    period: "2026-04",
    receivedDate: "2026-04-30",
    amount: 1800000,
    status: "Đã nhận",
  },
  {
    id: 5,
    period: "2026-05",
    receivedDate: "2026-05-31",
    amount: 2000000,
    status: "Đã nhận",
  },
  {
    id: 6,
    period: "2026-06",
    receivedDate: "2026-06-30",
    amount: 2000000,
    status: "Đã nhận",
  },
];
// Dữ liệu mẫu cho Story 1 - Quản lý phụ cấp
window.mockAllowances = window.mockAllowances || [
    {
        id: 1,
        intern: "Nguyễn Văn An",
        type: "Ăn trưa",
        amount: 500000,
        period: "2026-10",
        note: "Phụ cấp ăn trưa tháng 10",
        createdBy: "HR",
        createdAt: "15/10/2026"
    },
    {
        id: 2,
        intern: "Trần Thị Bình",
        type: "Đi lại",
        amount: 300000,
        period: "2026-10",
        note: "Hỗ trợ đi lại",
        createdBy: "HR",
        createdAt: "15/10/2026"
    },
    {
        id: 3,
        intern: "Lê Minh Đức",
        type: "Điện thoại",
        amount: 200000,
        period: "2026-09",
        note: "Phụ cấp điện thoại",
        createdBy: "HR",
        createdAt: "30/09/2026"
    }
];