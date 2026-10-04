# HƯỚNG DẪN KHỞI ĐỘNG VÀ BÁO CÁO TOÀN DIỆN HỆ THỐNG

## 0. BẮT ĐẦU TỪ FILE NÉN (.ZIP) — CÁC BƯỚC CHẠY LẦN ĐẦU

Làm theo đúng thứ tự dưới đây nếu bạn vừa nhận được file `.zip` của dự án và
chưa từng chạy thử lần nào:

1. **Cài Node.js** (nếu máy chưa có): tải bản LTS tại
   [nodejs.org](https://nodejs.org/), cài xong mở terminal/cmd gõ `node -v`
   để kiểm tra đã nhận lệnh (khuyến nghị Node 18 trở lên).
2. **Cài & bật MySQL Server** (nếu máy chưa có): cài MySQL 8.x, hoặc dùng
   XAMPP/WAMP (có sẵn MySQL đi kèm). Đảm bảo dịch vụ MySQL **đang chạy**
   trước khi bật backend ở bước 4.
3. **Cấu hình kết nối cơ sở dữ liệu:** vào thư mục `backend`, ở file `db_config.json`,
   sửa `password` thành mật khẩu MySQL thật của bạn (nếu dùng XAMPP mặc định
   thường để trống `""`).
   - Backend sẽ **tự động tạo database, tạo bảng và seed dữ liệu mẫu** ngay
     lần chạy đầu tiên — bạn **không cần** tự tay import `schema.sql` hay
     `seed_data.sql`, trừ khi muốn nạp/kiểm tra dữ liệu thủ công bằng MySQL
     Workbench/phpMyAdmin.
4. **Chạy hệ thống** — chọn 1 trong 2 cách:
   - **Cách 1 (khuyên dùng, Windows):** nhấp đúp file **`run.bat`** ở thư
     mục gốc. Script sẽ tự kiểm tra Node.js, tự chạy `npm install` nếu thiếu
     thư viện, khởi động backend ở cổng 5000, chờ tới khi `/api/health` phản
     hồi thành công rồi tự mở trình duyệt tại `http://localhost:5000/login.html`.
   - **Cách 2 (thủ công, dùng được cho macOS/Linux):** mở terminal tại thư
     mục `backend`, chạy lần lượt:
     ```bash
     npm install
     npm start
     ```
     Sau đó tự mở trình duyệt và truy cập `http://localhost:5000/login.html`.
5. **Đăng nhập thử** bằng một trong các tài khoản mẫu ở mục "KHỞI ĐỘNG HỆ
   THỐNG" bên dưới (mật khẩu chung: `password123`) để xác nhận hệ thống đã
   chạy đúng.

> Nếu gặp lỗi ở bước 4, xem cửa sổ **"Backend Server"** được `run.bat` mở ra
> để đọc thông báo lỗi thật từ Node.js (thường do: MySQL chưa bật, sai mật
> khẩu trong `db_config.json`, hoặc cổng 5000 đang bị chương trình khác
> chiếm dụng).

---

## CẤU HÌNH CƠ SỞ DỮ LIỆU (MYSQL)

- Cấu hình kết nối nằm tại `backend/db_config.json`:
  ```json
  {
    "host": "localhost",
    "port": 3306,
    "user": "root",
    "password": "your_password",
    "database": "user_management"
  }
  ```
  File này chỉ chứa giá trị mẫu (`your_password`) và đã được thêm vào
  `.gitignore` - **hãy thay bằng mật khẩu MySQL thật của bạn** (hoặc dùng biến
  môi trường `DB_PASSWORD`) trước khi chạy. Server sẽ cảnh báo ra console nếu
  phát hiện giá trị mẫu này chưa được đổi.
- File cấu trúc bảng: `schema.sql`
- File dữ liệu mẫu ban đầu (chỉ cần cho import thủ công, backend tự seed lúc
  khởi động): `seed_data.sql`

### GỬI EMAIL THÔNG BÁO KẾT QUẢ XÉT DUYỆT

Khi HR **duyệt** hoặc **từ chối** hồ sơ, hệ thống gửi email thật tới ứng viên (từ chối kèm lý do).
Việc gửi chạy **nền** qua hàng đợi trong bộ nhớ (EventEmitter), nên HR nhận phản hồi ngay và lỗi mail
không làm hỏng việc duyệt. Mỗi email được ghi vào bảng `email_logs`; lỗi tạm thời (mất mạng, timeout)
được tự thử lại tối đa 3 lần (chờ 5s, 15s, 45s), còn lỗi vĩnh viễn (sai mật khẩu SMTP, email nhận sai)
ghi thất bại ngay. Email không bao giờ chứa mật khẩu.

**Cấu hình SMTP (chỉ Admin):**

1. Cài thư viện: `cd backend` rồi `npm install` (bắt buộc, vì `run.bat` chỉ tự cài khi chưa có `node_modules`).
2. Sao chép `backend/mail_config.example.json` thành `backend/mail_config.json`, hoặc nhập trực tiếp
   trên giao diện: đăng nhập Admin, bấm vào tên tài khoản (góc phải) -> **Cấu hình Email (SMTP)**.
3. Nếu dùng Gmail: bật xác minh 2 bước, vào https://myaccount.google.com/apppasswords tạo
   **App Password** (16 ký tự) và dán vào ô mật khẩu (không dùng mật khẩu Gmail thường).
   Dùng host `smtp.gmail.com`, cổng `587` (STARTTLS) hoặc `465` (SSL).
4. Bấm **Gửi thử** để kiểm tra cấu hình. Mật khẩu không bao giờ được trả về giao diện;
   để trống ô mật khẩu khi lưu nghĩa là giữ mật khẩu cũ.

`mail_config.json` chứa mật khẩu nên đã nằm trong `.gitignore`, đừng gửi file này cho người khác.

**Nhật ký gửi email (chỉ HR):** mục **Nhật ký gửi Email** ở thanh bên cho xem trạng thái từng email
(Chờ gửi / Đang thử lại / Đã gửi / Thất bại), lọc, phân trang và bấm **Gửi lại** với email thất bại.
Sau khi duyệt/từ chối, giao diện tự theo dõi và hiện thông báo kết quả gửi mail.

---

# KHỞI ĐỘNG HỆ THỐNG

- **Chạy nhanh:** Nhấp đúp chuột vào file **`run.bat`** tại thư mục gốc. Hệ thống sẽ tự động bật backend server (cổng 5000) và mở trình duyệt tại `http://localhost:5000/login.html`.
  - `run.bat` giờ **kiểm tra thật** server đã khởi động thành công (gọi `GET /api/health` tối đa 20 lần, cách nhau 1 giây) trước khi báo "THÀNH CÔNG" và mở trình duyệt - trước đây chỉ chờ cố định 3 giây rồi báo thành công vô điều kiện, kể cả khi server đã crash (ví dụ do thiếu thư viện, sai mật khẩu MySQL, hoặc cổng 5000 đang bị chiếm). Nếu sau 20 giây vẫn chưa lên được, script sẽ báo lỗi rõ ràng và yêu cầu bạn xem cửa sổ "Backend Server" để đọc thông báo lỗi thật từ Node.js.
- **Tài khoản mẫu đăng nhập (Mật khẩu: `password123`):**
  - **Admin:** `admin@gmail.com` (Quản lý tài khoản, Cài đặt phân quyền)
  - **HR:** `hr@company.com` (Quản lý tài khoản, Báo cáo, Hồ sơ ứng tuyển, Mentor, Hồ sơ thực tập sinh và hợp đồng thực tập)
  - **Mentor:** `mentor@gmail.com` (Giao nhiệm vụ & Task)
  - **Intern:** `intern@gmail.com` (Trang nộp đơn đăng ký công khai `register.html`)

---

## BỘ KIỂM THỬ TỰ ĐỘNG (AUTOMATED TEST SUITES)

Các file test nằm trong `backend/tests/`. Chỉ cần: đã cài Node.js và **MySQL Server đang chạy**
(đúng mật khẩu trong `backend/db_config.json`). **Không cần bật backend bằng tay.**

```bash
cd backend
npm test                      # Chạy TẤT CẢ test bằng 1 lệnh
npm run test:unit             # Chỉ unit test (KHÔNG cần MySQL / backend)
npm run test:contracts-unit   # Unit test hợp đồng
npm run test:contracts-api    # API test hợp đồng (cần MySQL / backend)
```

`npm test` (file `tests/run_all.js`) tự động làm toàn bộ các bước sau:

1. Tự `npm install` nếu chưa có `node_modules`.
2. Chạy unit test (email, upload, hợp đồng, review - điều kiện duyệt hồ sơ).
3. Kiểm tra MySQL; báo lỗi rõ ràng nếu chưa bật / sai mật khẩu.
4. Tự bật backend ở cổng 5000 (nếu backend đã chạy sẵn thì dùng luôn và không tắt nó).
5. Chạy lần lượt các test API (login, create-account, rbac, register, interns, mentors,
   applications, documents-api, review-documents-api, email-api).
6. Dọn dữ liệu test còn sót, tự tắt backend do script bật, in bảng tổng kết.
7. Thoát mã `1` nếu có bộ test nào FAIL hoặc bị bỏ qua do lỗi môi trường (dùng được cho CI).

Chạy riêng một bộ test: `node tests/run_all.js --only rbac` (hoặc `npm run test:rbac` nếu đã tự bật backend).
Log backend do script bật nằm ở `backend/tests/.server.log`.

```bash
# dọn dữ liệu test thủ công (khi test bị Ctrl+C giữa chừng)
npm run test:cleanup
```

---

**Test:** `cd backend && npm test` (cần MySQL đang chạy; backend được tự bật). Chỉ chạy test không cần DB: `npm run test:unit`.

Kiểm thử toàn bộ: `cd backend && npm test -- --unit`, sau đó `cd backend && npm test` (cần MySQL đang chạy cho phần API).

### Múi giờ, báo cáo và định dạng code

- **Múi giờ Việt Nam:** mọi nghiệp vụ "hôm nay" (lịch thực tập, chương trình) dùng `backend/utils/date.js` (`Asia/Ho_Chi_Minh`), không phụ thuộc múi giờ máy chủ. Pool MySQL cố định `+07:00` nên `NOW()` và `TIMESTAMP` cũng theo giờ Việt Nam; frontend hiển thị ngày giờ theo cùng múi giờ. Unit test: `npm run test:date-unit`.
- **Báo cáo & Thống kê:** `GET /api/reports` (quyền `VIEW_REPORTS`) trả số liệu thật từ DB: số hồ sơ theo trạng thái, thực tập sinh đã có mentor, hợp đồng đã xác nhận và các tỷ lệ tương ứng (`null` khi chưa có dữ liệu để tính).
- **Chưa triển khai:** Giao nhiệm vụ (`/api/tasks`) và Nộp báo cáo công việc (`/api/submissions`) chỉ kiểm tra quyền và trả danh sách rỗng (`implemented: false`); giao diện hiển thị thông báo chưa triển khai thay vì dữ liệu mẫu.
- **Thông báo giao diện:** dùng toast thay cho `alert()`; thông báo khi buộc đăng xuất (phiên hết hạn) hiển thị trên trang đăng nhập.
- **Định dạng:** dự án dùng Prettier (`.prettierrc.json`) và `.editorconfig` (thụt 2 dấu cách, LF).
