# BẢNG KỊCH BẢN KIỂM THỬ (TEST CASES) - STORY 7

## Chức năng: Báo cáo đi làm và nghỉ phép (Quản lý chuyên cần)

- **Người thực hiện:** Bùi Ngọc Bình (Tester / QA)
- **Mã Task:** Task 7.7 (Đợt 1 - Làm ngay)
- **Đối tượng kiểm thử:** API `GET /api/reports/attendance` & Màn hình Báo cáo chuyên cần

---

### BẢNG ĐẶC TẢ CA KIỂM THỬ (TEST CASES MATRIX)

| Mã TC         | Tên ca kiểm thử                                       | Loại kiểm thử         | Tiền điều kiện                                     | Các bước thực hiện                                  | Dữ liệu đầu vào (Input)                           | Kết quả mong đợi                                                                                         |
| :------------ | :---------------------------------------------------- | :-------------------- | :------------------------------------------------- | :-------------------------------------------------- | :------------------------------------------------ | :------------------------------------------------------------------------------------------------------- |
| **TC_REP_01** | HR xem danh sách báo cáo chuyên cần thành công        | Positive              | Đã đăng nhập tài khoản HR, có quyền `VIEW_REPORTS` | Gửi request `GET /api/reports/attendance`           | Token của HR                                      | HTTP 200 OK. Trả về danh sách tổng hợp số ngày đi làm, đi muộn, về sớm, vắng, nghỉ phép.                 |
| **TC_REP_02** | Thống kê số liệu đi làm và vắng chính xác             | Positive / Logic      | DB có sẵn lịch sử chấm công và đơn nghỉ phép       | Xem chi tiết báo cáo chuyên cần của 1 thực tập sinh | Query: `?intern_id=1`                             | HTTP 200 OK. Các trường `so_ngay_di_lam`, `di_muon`, `ve_som`, `vang`, `nghi_phep` khớp dữ liệu thực tế. |
| **TC_REP_03** | Lọc theo khoảng ngày (Date Range)                     | Positive / Filter     | Đã đăng nhập HR                                    | Gửi request lọc từ ngày đến ngày                    | Query: `?from_date=2026-10-01&to_date=2026-10-10` | HTTP 200 OK. Chỉ hiển thị số liệu phát sinh trong khoảng thời gian được chọn.                            |
| **TC_REP_04** | Lọc theo nhóm thực tập sinh                           | Positive / Filter     | Đã đăng nhập HR                                    | Gửi request lọc theo mã nhóm                        | Query: `?group_id=1`                              | HTTP 200 OK. Danh sách chỉ hiển thị các thực tập sinh thuộc nhóm chỉ định.                               |
| **TC_REP_05** | Phân trang danh sách báo cáo                          | Positive / Pagination | Hệ thống có nhiều bản ghi                          | Gửi request phân trang                              | Query: `?page=1&limit=10`                         | HTTP 200 OK. Trả về tối đa 10 bản ghi kèm metadata: `total`, `page`, `totalPages`.                       |
| **TC_REP_06** | Xử lý thực tập sinh chưa có dữ liệu (Chưa đủ dữ liệu) | Business Logic        | Thực tập sinh mới nhận, chưa có lịch sử chấm công  | Gửi request xem báo cáo cho intern mới              | Query: `?intern_id=999`                           | HTTP 200 OK. Hiển thị nhãn hoặc thông tin "Chưa đủ dữ liệu", hệ thống không phát sinh lỗi 500.           |
| **TC_REP_07** | Chặn Thực tập sinh truy cập báo cáo chuyên cần (403)  | Security / RBAC       | Đăng nhập tài khoản Thực tập sinh (Intern)         | Gửi request tới `GET /api/reports/attendance`       | Token của Intern                                  | HTTP **403 Forbidden**. Báo lỗi từ chối quyền truy cập (yêu cầu quyền HR).                               |
| **TC_REP_08** | Chặn Mentor xem báo cáo toàn hệ thống (403)           | Security / RBAC       | Đăng nhập tài khoản Mentor                         | Gửi request tới `GET /api/reports/attendance`       | Token của Mentor                                  | HTTP **403 Forbidden**. Báo lỗi không có quyền quản lý báo cáo chung của HR.                             |
| **TC_REP_09** | Chặn truy cập khi chưa đăng nhập (401)                | Security              | Chưa đăng nhập (không truyền Header)               | Gửi request kiểm tra báo cáo                        | Không gửi token                                   | HTTP **401 Unauthorized**. Báo lỗi yêu cầu đăng nhập.                                                    |
| **TC_REP_10** | Chặn khoảng ngày lọc không hợp lệ                     | Negative / Validation | Đã đăng nhập HR                                    | Gửi request với ngày bắt đầu lớn hơn ngày kết thúc  | Query: `?from_date=2026-10-10&to_date=2026-10-01` | HTTP **400 Bad Request**. Báo lỗi khoảng ngày không hợp lệ.                                              |
