
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

/**
 * Story 3.4 - Dữ liệu giả yêu cầu hỗ trợ của Intern.
 * Dùng để xây dựng giao diện trước khi kết nối API.
 */
window.MOCK_SUPPORT_REQUESTS = [
    {
        id: 1,
        type: "Chứng nhận",
        title: "Xin giấy xác nhận thực tập",
        content: "Tôi cần giấy xác nhận đang thực tập tại công ty.",
        status: "Chờ xử lý",
        createdAt: "2026-10-14T09:00:00",
        response: ""
    },
    {
        id: 2,
        type: "Giấy tờ",
        title: "Xin bản sao giấy tờ thực tập",
        content: "Tôi muốn xin bản sao giấy tờ liên quan đến kỳ thực tập.",
        status: "Đang xử lý",
        createdAt: "2026-10-13T14:30:00",
        response: "Bộ phận phụ trách đang kiểm tra yêu cầu."
    },
    {
        id: 3,
        type: "Khác",
        title: "Hỏi về thủ tục thực tập",
        content: "Tôi muốn hỏi về thủ tục hoàn thành kỳ thực tập.",
        status: "Đã xử lý",
        createdAt: "2026-10-10T10:00:00",
        response: "Bạn vui lòng liên hệ bộ phận nhân sự để được hướng dẫn."
    }
];
