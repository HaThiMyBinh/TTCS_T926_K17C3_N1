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
npm run test:attendance-unit  # Unit test chấm công
npm run test:final-reports-unit # Unit test báo cáo cuối kỳ
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

## CHẤM CÔNG THỰC TẬP SINH (US6)

- Intern check-in/check-out bằng giờ máy chủ theo múi giờ Việt Nam; mỗi ngày tối đa một lượt. Check-in cần có hợp đồng đã xác nhận và nằm trong kỳ thực tập của hợp đồng. Check-out chỉ thực hiện trong cùng ngày Việt Nam; quên check-out thì giữ trạng thái thiếu và không tính giờ.
- Bảng `attendance_records` được tạo trong `schema.sql` và `db.initDatabase()`, xóa hồ sơ intern thì xóa bản ghi. Thời lượng được tính từ mốc check-in/check-out, không lưu cứng.
- API (chỉ Intern; dữ liệu luôn lấy từ email trong token):
  - `GET /api/me/attendance/today` — trạng thái, ngày và giờ máy chủ.
  - `POST /api/me/attendance/check-in` — body tùy chọn `{ note }`.
  - `POST /api/me/attendance/check-out` — body `{}`.
  - `GET /api/me/attendance?from=YYYY-MM-DD&to=YYYY-MM-DD` — lịch sử và tổng thời lượng (mặc định tháng hiện tại, tối đa 366 ngày).
- Lỗi chính: 400 dữ liệu sai, 401 chưa đăng nhập, 403 sai vai trò, 404 thiếu hồ sơ intern, 409 sai trình tự hoặc chưa đủ điều kiện hợp đồng.
- Chưa có: HR/Mentor xem hoặc duyệt công, sửa giờ/bổ sung công, nhiều ca mỗi ngày, GPS/IP/ảnh, xuất Excel, nhắc quên check-out.
- Kiểm thử: `cd backend && npm run test:attendance-unit`; API: `npm run test:attendance-api` (cần MySQL và backend).

## BÁO CÁO TỔNG KẾT CUỐI KỲ (HR, US5)

- HR tạo bản nháp theo phạm vi toàn bộ, trường hoặc chương trình; xem trước điểm đánh giá, báo cáo tuần, nhiệm vụ và (nếu có) tổng phút chấm công. Người chưa được đánh giá được ghi rõ “Chưa đánh giá” và không ảnh hưởng điểm trung bình.
- Khi chốt, hệ thống lưu snapshot bất biến. Báo cáo đã chốt không sửa/xóa được. HR có thể in/Lưu PDF từ trình duyệt hoặc tải CSV UTF-8 BOM.
- API (chỉ HR; các API đánh giá của Mentor vẫn giữ quyền cũ):
  - `GET /api/final-reports/preview?scope_type=&scope_value=&from=&to=`
  - `GET/POST /api/final-reports` — danh sách và tạo nháp.
  - `GET/PUT/DELETE /api/final-reports/:id` — xem, sửa hoặc xóa bản nháp.
  - `POST /api/final-reports/:id/finalize` — chốt snapshot.
  - `GET /api/final-reports/:id/export.csv` — xuất dữ liệu.
  - `GET /api/final-reports/recipients?scope_type=&scope_value=` — gợi ý email người nhận theo phạm vi; `DELETE /api/final-reports/recipients/:id` — xóa khỏi gợi ý.
- Phạm vi chỉ gồm dữ liệu cần gửi; không đưa email, số điện thoại, tệp hoặc chi tiết hợp đồng. Không áp dụng nhãn xếp loại vì chưa có thang chính thức được xác nhận.
- Chưa có: gửi email tự động, PDF sinh ở server, chữ ký số, lịch sử phiên bản, lịch chốt tự động, quyền xem cho Mentor/Intern.
- Kiểm thử: `cd backend && npm run test:final-reports-unit`; API: `npm run test:final-reports-api` (cần MySQL và backend).

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

## Cập nhật sau rà soát nghiệp vụ US5 / US6

### US6 – Chấm công (thực tập sinh)
- **Ca qua đêm / quên check-out:** check-out nhận cả ca mở bắt đầu trong vòng 16 giờ (kể cả qua nửa đêm). Ca mở lâu hơn 16 giờ mới bị coi là `MISSING_CHECKOUT`. Đang còn ca mở của ngày trước thì chưa check-in ngày mới được.
- **Bổ sung check-out có duyệt:** thực tập sinh gửi `POST /api/me/attendance/:id/correction` (`check_out_at`, `reason`) cho ngày quên check-out trong vòng 30 ngày. Chỉ khi Mentor phụ trách hoặc HR duyệt thì giờ mới được tính vào giờ làm (bản ghi gắn cờ `isAdjusted`). Bị từ chối thì được gửi lại.
- **HR / Mentor xem và duyệt:** `GET /api/interns/:id/attendance`, `GET /api/attendance/corrections/pending`, `POST /api/attendance/:id/correction/review` (`decision`: `APPROVED` | `REJECTED`, từ chối bắt buộc có `note`). Mentor chỉ thấy thực tập sinh mình phụ trách. Giao diện: tab "Chấm công thực tập sinh".
- **Kỳ thực tập:** chỉ check-in được vào ngày nằm trong kỳ của *ít nhất một hợp đồng đã xác nhận* (không còn lọt vào khoảng trống giữa hai hợp đồng).
- **Phân quyền:** API của thực tập sinh yêu cầu quyền `SUBMIT_WORK` như báo cáo tuần.

### US5 – Báo cáo cuối kỳ (HR)
- **Giờ làm và nhiệm vụ tính theo kỳ báo cáo** khi chọn khoảng ngày (nhiệm vụ tính theo hạn nộp, không có hạn thì theo ngày giao).
- **Chỉ thực tập sinh có hợp đồng đã xác nhận** mới vào báo cáo, kể cả khi không chọn khoảng ngày.
- **Tên chương trình / phòng ban** liệt kê đủ các chương trình của thực tập sinh (khi lọc theo chương trình thì chỉ chương trình đó).
- **Chốt báo cáo khi còn người chưa được đánh giá** trả `409` mã `INCOMPLETE_EVALUATION`; chỉ chốt được khi gửi `{ "confirm_incomplete": true }` (giao diện hỏi xác nhận).
- **Gửi email:** `POST /api/final-reports/:id/send` (`recipients` tối đa 10 email, `message` tùy chọn) gửi báo cáo *đã chốt* kèm file CSV qua SMTP đã cấu hình. Bản nháp không gửi được. Mỗi lần gửi thành công được ghi vào bảng `final_report_sends` (người gửi, người nhận, lời nhắn, thời điểm); danh sách báo cáo hiển thị trạng thái **Đã gửi**, số lần và người nhận gần nhất. Email người nhận được lưu vào `final_report_recipients` để gợi ý cho báo cáo cùng phạm vi lần sau.
- Giao diện và CSV hiển thị giờ làm; tổng giờ làm nằm trong `summary.totalWorkMinutes`.
- **Phân quyền:** HR cần quyền `VIEW_REPORTS`. `permissions.json` và mặc định đã gán `VIEW_REPORTS` cho HR. Hệ thống đang chạy với `permissions.json` cũ (HR rỗng) cần Admin cấp quyền này trong ma trận phân quyền.

### Nâng cấp CSDL
Bảng `attendance_records` có thêm các cột `is_adjusted`, `correction_*`. Server tự thêm cột vào database cũ khi khởi động (`ensureColumn`); `schema.sql` đã cập nhật cho database mới.

### US7 / US8 – Lịch làm việc, nghỉ phép và chuyên cần

**Lịch làm việc (US8, HR thiết lập, Admin chỉ xem)** – tab *Lịch làm việc*, API `/api/work-schedules`.
- Mẫu lịch có hai chế độ: `FIXED` (giờ bắt đầu/kết thúc từng ngày + dung sai đi muộn/về sớm) và `FLEXIBLE` (chỉ cần đủ số phút tối thiểu mỗi ngày). Cấu hình riêng cho từng thứ trong tuần; có sẵn "Lịch mặc định" T2–T6 08:30–17:30 (không xóa được).
- Gán lịch cho nhóm tại `/api/work-schedules/assignments` theo `DEFAULT`, trường, chương trình, mentor hoặc cá nhân, kèm ngày hiệu lực. Thứ tự ưu tiên: cá nhân > chương trình > mentor > trường > mặc định. Gán lịch mới cho cùng phạm vi sẽ tự kết thúc lần đang mở trước đó; khoảng ngày trùng bị từ chối (409). `/api/work-schedules/preview` cho biết số thực tập sinh bị ảnh hưởng, `/api/work-schedules/resolved` liệt kê lịch đang áp dụng của từng người, `/api/work-schedules/options` cấp danh sách cho các ô chọn.
- Sửa một mẫu lịch đã được gán sẽ ảnh hưởng cả báo cáo các ngày đã qua; nên tạo mẫu mới và áp dụng từ ngày hiệu lực.
- Ngày nghỉ chung: `/api/work-holidays`. Thực tập sinh xem lịch của mình ở `/api/me/work-schedule`; `GET /api/me/attendance/today` có thêm trường `schedule`. Check-in/check-out **không bị chặn** vào ngày nghỉ hay ngoài giờ, chỉ được gắn cờ trong báo cáo.

**Nghỉ phép (US7)** – nghỉ nguyên ngày, loại `SICK|PERSONAL|EXAM|OTHER`.
- Thực tập sinh: `POST/GET /api/me/leaves`, `POST /api/me/leaves/:id/cancel` (tab *Nghỉ phép*). Quy tắc: trong hợp đồng đã xác nhận (hợp đồng thiếu ngày bắt đầu/kết thúc được coi là không giới hạn), tối đa 30 ngày/đơn, nộp bù tối đa 7 ngày, không xin cho ngày đã chấm công, không chồng đơn đang chờ hoặc đã duyệt. Hủy được đơn chờ duyệt, hoặc đơn đã duyệt khi chưa tới ngày nghỉ.
- HR/Mentor phụ trách: `GET /api/leaves/pending` và `POST /api/leaves/:id/review` (card *Đơn nghỉ phép chờ duyệt* ở tab Chấm công thực tập sinh; từ chối phải có lý do). HR xem toàn bộ đơn ở `GET /api/leaves?status=&intern_id=&from=&to=`.

**Báo cáo chuyên cần (US7, HR có quyền `VIEW_REPORTS`)** – tab *Báo cáo chuyên cần*.
- `GET /api/attendance/report?from=&to=&scope_type=ALL|UNIVERSITY|PROGRAM|MENTOR&scope_value=&intern_id=&group_by=NONE|PROGRAM|UNIVERSITY|MENTOR`, chi tiết từng ngày `GET /api/attendance/report/interns/:id/days`, xuất CSV `GET /api/attendance/report/export.csv`. Khoảng ngày tối đa 366 ngày; dữ liệu được tải theo lô, không truy vấn theo từng ngày.
- Mỗi ngày được xếp vào một trạng thái: Có mặt, Nghỉ phép, Vắng, Vắng (chờ duyệt nghỉ), Ngày nghỉ, Ngày lễ, Ngoài hợp đồng, Chưa tới. Ngày "phải đi làm" gồm Có mặt, Nghỉ phép, Vắng. Cờ kèm theo: đi muộn, về sớm, thiếu giờ (lịch linh hoạt), thiếu check-out, đã bổ sung check-out, đi làm dù đã xin nghỉ.
- Tỷ lệ chuyên cần = số ngày có mặt / (ngày phải đi làm − ngày nghỉ có phép); để trống nếu mẫu số bằng 0. Màu: từ 90% xanh, 75–90% vàng, dưới 75% đỏ.
- Kiểm thử đơn vị: `npm run test:work-schedule-unit` (hàm thuần) và `npm run test:attendance-report-unit` (báo cáo, nghỉ phép, quản lý lịch với DB giả, không cần MySQL). Test API (cần MySQL và backend đang chạy): `npm run test:work-schedule-api` (lịch, gán lịch, ngày nghỉ chung, nghỉ phép, phân quyền mentor) và `npm run test:attendance-report-api` (báo cáo, lọc, nhóm, chi tiết từng ngày, CSV). Hai bộ này tự tạo dữ liệu riêng và dọn sạch sau khi chạy; `npm test` chạy tất cả.