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
npm run test:intern-filter-unit # Unit test bộ lọc thực tập sinh
npm run test:intern-filter-api  # API test bộ lọc (cần MySQL / backend)
npm run test:tasks-unit       # Unit test giao nhiệm vụ (không cần MySQL)
npm run test:tasks-api        # API test giao nhiệm vụ (cần MySQL / backend)
npm run test:task-attachments-unit  # Unit test tệp đính kèm tiến độ (không cần MySQL)
npm run test:weeks-unit             # Unit test tính tuần / hạn nộp báo cáo tuần (không cần MySQL)
npm run test:weekly-reports-unit    # Unit test báo cáo tuần (không cần MySQL)
npm run test:weekly-reports-api     # API test báo cáo tuần (cần MySQL / backend)
npm run test:weekly-feedback-unit    # Unit test phản hồi báo cáo tuần của mentor (không cần MySQL)
npm run test:weekly-feedback-api     # API test phản hồi báo cáo tuần (cần MySQL / backend)
npm run test:business-rules-api      # API test các luật nghiệp vụ bổ sung (cần MySQL / backend)
npm run test:evaluations-unit        # Unit test đánh giá thực tập sinh của mentor (không cần MySQL)
npm run test:evaluations-api         # API test đánh giá thực tập sinh (cần MySQL / backend)
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

---

## PHẢN HỒI BÁO CÁO TUẦN (MENTOR)

*User story: "Là mentor, tôi muốn xem báo cáo và phản hồi để hỗ trợ thực tập sinh."*

- **Mentor** (tab **Báo cáo tuần**): xem báo cáo của thực tập sinh mình phụ trách, bấm **Xem / Phản hồi** để
  gửi, cập nhật hoặc xóa phản hồi (tối đa 2000 ký tự). Bảng tổng quan có cột **Phản hồi**
  (Đã phản hồi / Chưa phản hồi / Báo cáo đã sửa), số **Chờ phản hồi** và bộ lọc
  "Chỉ hiện báo cáo chưa phản hồi".
- **Thực tập sinh** (tab nộp báo cáo): chỉ **đọc** phản hồi của mentor; có nhãn "Có phản hồi" trong bảng các tuần.
  Nếu thực tập sinh sửa báo cáo *sau* lần phản hồi gần nhất thì cả hai bên thấy cảnh báo "báo cáo đã sửa" (`feedback_outdated`).
- Mỗi báo cáo có **tối đa 1 phản hồi** (bảng `weekly_report_feedback`, `UNIQUE report_id`); gửi lại là cập nhật.
  Bảng được tự tạo khi khởi động backend (cũng có trong `schema.sql`) và bị xóa theo khi xóa báo cáo / hồ sơ thực tập sinh.
- API (chỉ vai trò Mentor, và chỉ với thực tập sinh được phân công cho mình, nếu không trả 403):
  - `PUT /api/weekly-reports/:id/feedback` — body `{ "content": "..." }`
  - `DELETE /api/weekly-reports/:id/feedback`
  - Phản hồi nằm trong trường `feedback` của `GET /api/weekly-reports` (mentor) và `GET /api/me/weekly-reports` (intern);
    `GET /api/weekly-reports/overview` thêm `has_feedback`, `feedback_outdated` mỗi dòng và `summary.feedback_pending`.
- Khi mentor của thực tập sinh bị đổi, mentor mới được sửa/xóa phản hồi cũ (mentor phụ trách hiện tại quản lý phản hồi).
- Chưa có: email thông báo khi có phản hồi, chấm điểm, trao đổi nhiều lượt.

---

## ĐÁNH GIÁ THỰC TẬP SINH (MENTOR)

*User story: "Là mentor, tôi muốn đánh giá kỹ năng và thái độ của thực tập sinh để tổng kết."*
(Module **Quản lý công việc & đánh giá** → **Đánh giá**)

- **Mentor** (tab **Đánh giá thực tập sinh**): bảng liệt kê các thực tập sinh mình phụ trách kèm trạng thái
  (Đã đánh giá / Chưa đánh giá), điểm kỹ năng, điểm thái độ, điểm tổng, thời điểm cập nhật và bộ lọc
  "Chỉ hiện thực tập sinh chưa đánh giá". Bấm **Đánh giá** (hoặc **Xem / Sửa**) để mở form:
  - **Kỹ năng**: điểm 1–5 (bắt buộc) + nhận xét (tùy chọn, tối đa 2000 ký tự)
  - **Thái độ**: điểm 1–5 (bắt buộc) + nhận xét (tùy chọn, tối đa 2000 ký tự)
  - **Nhận xét tổng kết**: bắt buộc, tối đa 2000 ký tự
  - **Điểm tổng** = trung bình điểm kỹ năng và thái độ (làm tròn 1 chữ số thập phân), do server tính.
- Mỗi thực tập sinh có **tối đa 1 đánh giá** (bảng `intern_evaluations`, `UNIQUE intern_id`); gửi lại là cập nhật.
  Mentor có thể sửa hoặc xóa đánh giá. Bảng được tự tạo khi khởi động backend (cũng có trong `schema.sql`) và bị xóa
  theo khi xóa hồ sơ thực tập sinh; xóa mentor thì `mentor_id` về NULL.
- API (chỉ vai trò Mentor, và chỉ với thực tập sinh được phân công cho mình, nếu không trả 403; không tồn tại trả 404):
  - `GET /api/evaluations/overview` — danh sách thực tập sinh của mentor + `summary { total, evaluated, pending }`
  - `GET /api/interns/:id/evaluation` — lấy đánh giá (`data: null` nếu chưa có)
  - `PUT /api/interns/:id/evaluation` — body `{ skill_score, skill_comment, attitude_score, attitude_comment, overall_comment }`
  - `DELETE /api/interns/:id/evaluation` — xóa đánh giá (404 nếu chưa có)
- Dữ liệu sai trả 400 (điểm không phải số nguyên 1–5, thiếu nhận xét tổng kết, quá 2000 ký tự, trường lạ như `overall_score`).
- Khi mentor của thực tập sinh bị đổi, mentor mới được sửa/xóa đánh giá cũ (mentor phụ trách hiện tại quản lý đánh giá).
- Chưa có: thực tập sinh / HR xem đánh giá, email thông báo, xuất PDF, lịch sử nhiều phiên bản.

---

## CÁC LUẬT NGHIỆP VỤ BỔ SUNG (rà soát US1–US19)

- **Đăng ký (US6)**: tạo tài khoản + hồ sơ ứng tuyển trong cùng 1 transaction; lỗi giữa chừng thì rollback, không còn tài khoản mồ côi.
- **Nộp lại hồ sơ**: ứng viên bị **Từ chối** được đăng ký lại bằng cùng email. Hệ thống dùng lại tài khoản/hồ sơ cũ,
  cập nhật thông tin mới, đặt về "Chờ duyệt", xóa lý do từ chối và mở khóa tài khoản. Hồ sơ đang chờ duyệt / đã duyệt thì vẫn báo email đã tồn tại.
- **Duyệt hồ sơ (US5, US7)**: luôn yêu cầu đủ CV + Đơn xin thực tập. Tham số `require_documents` đã bị bỏ, không còn cách bỏ qua điều kiện này.
- **Hợp đồng đã xác nhận (US10)**: HR đổi một ngày **đã có** của hợp đồng đã xác nhận thì hợp đồng quay về *Chờ xác nhận*
  (xóa thời điểm xác nhận, response có `reconfirmation_required: true`) và thực tập sinh phải xác nhận lại.
  Điền ngày vào chỗ còn trống hoặc đổi chương trình thì không cần xác nhận lại.
- **Ngày hợp đồng và chương trình (US13)**: hợp đồng gắn chương trình thì ngày bắt đầu/kết thúc phải nằm trong khoảng ngày của chương trình
  (chương trình chưa có ngày thì không giới hạn). HR không thể thu hẹp khoảng ngày chương trình nếu có hợp đồng gắn kèm nằm ngoài khoảng mới (409).
- **Trình tự (US15, US17, US19)**: giao nhiệm vụ, nộp báo cáo tuần và đánh giá tổng kết chỉ được thực hiện khi thực tập sinh có
  ít nhất **1 hợp đồng đã xác nhận** (nếu không trả 409). Xem / xóa dữ liệu cũ và phản hồi báo cáo không bị chặn.
