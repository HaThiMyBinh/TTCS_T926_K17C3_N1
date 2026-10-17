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

**Nhật ký gửi email (chỉ HR):** mục **Nhật ký gửi Email** trong menu tài khoản (bấm tên người dùng ở góc phải trên, cạnh **Hồ sơ**) cho xem trạng thái từng email
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

### Thông báo nghỉ phép (email + chuông)
- Khi thực tập sinh gửi đơn nghỉ (`POST /api/me/leaves`): gửi **email** tới mọi HR đang hoạt động (cần cấu hình SMTP; lỗi gửi không chặn đơn, `hrNotified` trong response là số HR đã nhận) và tạo **thông báo chuông** cho HR + mentor phụ trách.
- Khi HR/mentor duyệt hoặc từ chối: thực tập sinh nhận thông báo chuông (kèm lý do nếu có).
- Chuông ở góc phải thanh trên cùng, hiện số chưa đọc, tự cập nhật mỗi 45 giây; bấm một thông báo sẽ đánh dấu đã đọc và chuyển tới tab liên quan. Có nút \"Đọc tất cả\".
- Bảng `notifications` (tự tạo khi khởi động, có trong `schema.sql`). API (mọi vai trò, chỉ thấy thông báo của chính mình): `GET /api/notifications`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`.

### Thông báo khi HR phân công mentor (US 12 / 30)
- `PUT /api/interns/:id/mentor` (HR) giờ tạo thông báo chuông: **mentor mới** (\"Bạn được phân công...\"), **mentor cũ** nếu bị đổi/gỡ, và **thực tập sinh** (có mentor hoặc bị gỡ mentor). Gán lại đúng mentor đang phụ trách thì không báo. Lỗi tạo thông báo không làm hỏng việc phân công.

### Chương trình thực tập: HR xếp thực tập sinh và phân công mentor (US 12)
- Thực tập sinh thuộc chương trình **do HR tự xếp** (bảng `program_interns`), không phụ thuộc hợp đồng: sau khi thực tập sinh đã vào hệ thống, HR quyết định cho họ làm chương trình nào. Một thực tập sinh có thể thuộc nhiều chương trình. **Mọi nơi dùng "chương trình của thực tập sinh" đều đọc danh sách này**: lịch làm việc áp dụng theo chương trình (và xem trước phạm vi), báo cáo chuyên cần (lọc / nhóm theo chương trình), báo cáo cuối kỳ (phạm vi và cột chương trình / phòng ban), timeline thực tập. Khi thuộc nhiều chương trình thì tại mỗi ngày chỉ tính các chương trình có ngày bao phủ ngày đó (chương trình không có ngày = luôn hiệu lực) và lấy chương trình HR xếp gần nhất. Trường `program_id` trên hợp đồng chỉ còn dùng để kiểm tra ngày hợp đồng nằm trong chương trình và làm chương trình dự phòng cho timeline khi thực tập sinh chưa được xếp.
- Tab **Chương trình thực tập** (HR): nút **Thực tập sinh & mentor** mở cửa sổ gồm (1) mục *Thêm thực tập sinh vào chương trình* (có ô tìm kiếm), (2) danh sách thành viên kèm nút **Gỡ khỏi CT**, (3) chọn nhiều thành viên + chọn mentor để phân công một lần (\"-- Gỡ mentor --\" để gỡ).
- API (chỉ HR): `GET /api/programs/:id/interns`, `GET /api/programs/:id/available-interns`, `POST /api/programs/:id/interns` `{ \"intern_ids\": [..] }`, `DELETE /api/programs/:id/interns/:internId`, `PUT /api/programs/:id/mentor` `{ \"mentor_id\": 5 | null, \"intern_ids\": [..] }` (bỏ `intern_ids` = cả chương trình).
- Luật: tối đa 500 người/lần, không trùng; thêm vượt `capacity` của chương trình trả 409; thực tập sinh không tồn tại / không thuộc chương trình trả 400; mentor không tồn tại 404; chương trình chưa có thành viên 409. Gán mentor chạy trong một transaction, người đã đúng mentor đó tính là `unchanged`. Gỡ khỏi chương trình không đổi mentor.
- Thông báo chuông: thực tập sinh mới được xếp vào chương trình; khi gán mentor, mentor mới nhận 1 thông báo gộp (\"... N thực tập sinh\"), mỗi mentor cũ 1 thông báo, mỗi thực tập sinh bị đổi 1 thông báo riêng. Phân công từng người (US 30) vẫn ở `PUT /api/interns/:id/mentor`.
- Kiểm thử: `npm run test:unit` (có `test_program_mentor_unit.js`).

### Menu báo cáo (HR)
- Thanh menu chỉ còn một mục **Báo cáo & Thống kê**. Trong trang này có hai nút lớn mở **Báo cáo cuối kỳ** và **Báo cáo chuyên cần**; mỗi trang báo cáo có nút quay lại. Khi đang ở một trong hai báo cáo, mục "Báo cáo & Thống kê" trên menu vẫn được tô sáng. HR luôn vào được trang này (phần số liệu tổng quan chỉ hiện khi có quyền VIEW_REPORTS).

### Số thực tập sinh của mentor khi phân công (US 11)
- Ô chọn mentor khi phân công (bảng thực tập sinh, cửa sổ chương trình) hiện kèm \"· N TTS\" để HR chọn người đang nhẹ việc.
- API: `GET /api/mentors` có thêm `activeInterns`.

---

## PHỤ CẤP THỰC TẬP SINH (HR)

*User story: "Là HR, tôi muốn nhập thông tin phụ cấp của thực tập sinh để quản lý quyền lợi."*
(Menu HR → **Phụ cấp thực tập sinh**)

- **Giao diện (chỉ HR):** trang tổng quan liệt kê thực tập sinh kèm số khoản phụ cấp đang hiệu lực và tổng phụ cấp theo tháng,
  có ô tìm kiếm (họ tên, MSSV, email, trường, ngành) và bộ lọc trường. Bấm **Quản lý** để mở cửa sổ danh sách các khoản
  phụ cấp của một thực tập sinh và thêm / sửa / xóa từng khoản. Thực tập sinh chưa có hợp đồng đã xác nhận bị khóa nút
  **Quản lý** (kèm nhãn "Chưa có HĐ xác nhận").
- **Một khoản phụ cấp gồm:** loại (`MEAL` ăn uống, `TRANSPORT` đi lại, `PHONE` điện thoại, `HOUSING` nhà ở, `OTHER` khác),
  số tiền VND (số nguyên, 1 – 999.999.999), chu kỳ chi trả (`MONTHLY` theo tháng, `DAILY` theo ngày, `ONE_TIME` một lần),
  ngày bắt đầu hiệu lực, ngày kết thúc (để trống = kéo dài đến hết hợp đồng) và ghi chú (tối đa 500 ký tự).
  Trạng thái tính theo giờ Việt Nam: **Đang hiệu lực / Sắp hiệu lực / Hết hạn**.
- Bảng `intern_allowances` (tự tạo khi khởi động backend, cũng có trong `schema.sql`); xóa hồ sơ thực tập sinh thì xóa theo
  (`ON DELETE CASCADE`); xóa tài khoản HR thì `created_by` / `updated_by` về NULL. DB có CHECK số tiền > 0 và ngày kết thúc ≥ ngày bắt đầu.
- API (chỉ vai trò HR; Admin / Mentor / Intern nhận 403, chưa đăng nhập 401; phản hồi có `Cache-Control: private, no-store`):
  - `GET /api/allowances/overview?q=&university=` — tổng quan + `summary { internCount, withAllowance, totalMonthly }`
  - `GET /api/interns/:id/allowances` — danh sách (mỗi khoản có `status`) + `summary { totalCount, activeCount, totalMonthly, totalDaily }`
  - `POST /api/interns/:id/allowances` — body `{ allowance_type, amount, pay_cycle, effective_from, effective_to?, note? }` → 201
  - `PATCH /api/interns/:id/allowances/:allowanceId` — chỉ gửi trường cần đổi; hệ thống kiểm tra lại toàn bộ dữ liệu sau khi gộp
  - `DELETE /api/interns/:id/allowances/:allowanceId`
- Luật nghiệp vụ:
  - **400** dữ liệu sai: số tiền không phải số nguyên (chuỗi, số thực, âm, 0, quá lớn), loại / chu kỳ ngoài danh sách, ngày sai định
    dạng hoặc không tồn tại, ngày kết thúc trước ngày bắt đầu, loại `OTHER` thiếu ghi chú, ghi chú quá 500 ký tự, trường lạ
    (`intern_id`, `created_by`...), ID không hợp lệ, PATCH rỗng.
  - **404** thực tập sinh hoặc khoản phụ cấp không tồn tại; khoản phụ cấp không thuộc thực tập sinh trong đường dẫn cũng trả 404 (chống IDOR).
  - **409** thực tập sinh chưa có hợp đồng đã xác nhận (cùng luật trình tự với giao việc, báo cáo tuần, đánh giá); khoảng hiệu lực
    nằm ngoài kỳ của một hợp đồng đã xác nhận (hợp đồng thiếu ngày = không giới hạn; nếu không nhập ngày kết thúc thì chỉ cần ngày bắt đầu
    nằm trong hợp đồng); **trùng khoảng hiệu lực với khoản cùng loại** của cùng thực tập sinh (kể cả khoản không có ngày kết thúc).
    Kiểm tra trùng chạy trong một transaction có khóa dòng thực tập sinh nên hai yêu cầu song song không thể cùng lọt qua.
  - Tổng theo tháng (`totalMonthly`) chỉ cộng các khoản **theo tháng đang hiệu lực**; khoản theo ngày cộng riêng ở `totalDaily`;
    khoản một lần không quy đổi.
  - Số tiền tính bằng số nguyên VND, không dùng số thực. Mọi dữ liệu hiển thị trên giao diện đều được escape (chống XSS ở ghi chú).
- Chưa có: thực tập sinh xem phụ cấp của mình, Admin / Mentor xem, xuất Excel / CSV, lịch sử thay đổi, duyệt nhiều cấp,
  tính phụ cấp theo ngày công thực tế, email / chuông thông báo cho thực tập sinh, đưa phụ cấp vào báo cáo cuối kỳ.
- Kiểm thử: `cd backend && npm run test:allowances-unit` (không cần MySQL); API: `npm run test:allowances-api` (cần MySQL và backend).
  Cả hai đã được đăng ký trong `npm test` / `npm run test:unit`.

---

## LỊCH SỬ PHỤ CẤP CỦA TÔI (Thực tập sinh)

*User story: "Là thực tập sinh, tôi muốn xem lịch sử nhận phụ cấp để theo dõi thu nhập."*
(Menu Intern → **Phụ cấp của tôi**)

- **Phạm vi:** chỉ đọc. Thực tập sinh xem các khoản phụ cấp mà HR đã ghi nhận cho mình ở mục *Phụ cấp thực tập sinh*
  (mỗi khoản gồm loại, số tiền, chu kỳ, khoảng hiệu lực, ghi chú, trạng thái và ngày HR ghi nhận). HR thêm / sửa / xóa
  thì thực tập sinh thấy ngay khi tải lại. Hệ thống hiện **chưa có dữ liệu chi trả thực tế** (đã trả bao nhiêu, ngày nào),
  nên "lịch sử nhận" là lịch sử các khoản **được hưởng** theo thời gian.
- **Giao diện:** thẻ tổng hợp (đang hưởng theo tháng, theo ngày, số khoản đang hiệu lực / sắp hiệu lực / đã hết hạn),
  bộ lọc theo **Trạng thái** và **Loại phụ cấp**, bảng lịch sử xếp mới nhất trước. Thẻ tổng hợp luôn tính trên toàn bộ
  các khoản, không đổi theo bộ lọc. Ghi chú được escape (chống XSS).
- **API:** `GET /api/me/allowances?status=&type=` — chỉ vai trò Intern (HR / Admin / Mentor nhận 403, chưa đăng nhập 401);
  phản hồi `{ intern, items, summary { totalCount, activeCount, upcomingCount, expiredCount, totalMonthly, totalDaily } }`
  và có `Cache-Control: private, no-store`.
- **Bảo mật:** hồ sơ được xác định theo email của tài khoản đăng nhập (giống Nghỉ phép / Hợp đồng của tôi), không có tham số ID
  nên không thể xem phụ cấp của người khác. Chỉ trả các trường cần thiết, **không** lộ ID người nhập / người sửa hay ID hồ sơ.
  Không có route ghi nào cho thực tập sinh (POST / PATCH / DELETE của HR vẫn trả 403).
- **Lỗi:** 400 khi `status` không thuộc `ACTIVE` / `UPCOMING` / `EXPIRED`, `type` ngoài danh sách loại, tham số lạ hoặc lặp lại;
  404 khi tài khoản chưa có hồ sơ thực tập sinh. Thực tập sinh chưa có phụ cấp nhận danh sách rỗng và tổng bằng 0.
- Chưa có: ghi nhận chi trả thực tế theo kỳ (bảng lương / phiếu chi), tổng thu nhập theo tháng, xuất Excel / PDF,
  thông báo cho thực tập sinh khi HR thêm hoặc đổi phụ cấp.
- Kiểm thử: `npm run test:allowances-unit` (không cần MySQL) và `npm run test:allowances-api` (cần MySQL và backend) —
  đã gồm các ca của US này.

## YÊU CẦU HỖ TRỢ (Thực tập sinh → HR)

Thực tập sinh có thể gửi yêu cầu cấp giấy xác nhận thực tập, giấy giới thiệu, xác nhận phụ cấp/thu nhập, hỗ trợ giấy tờ hoặc yêu cầu khác. HR tiếp nhận, giải quyết hoặc từ chối; thông báo chuông dẫn người dùng đến đúng trang.

- **API Intern:** `GET /api/me/support-requests?status=&type=`, `POST /api/me/support-requests` (`request_type`, `title`, `description`), tải/xóa file yêu cầu, hủy khi còn `PENDING`.
- **API HR:** `GET /api/support-requests?status=&type=&q=`, `GET /api/support-requests/:id`, `POST /api/support-requests/:id/process` (`START`, `RESOLVE`, `REJECT`), tải file kết quả.
- Luật nghiệp vụ: cần hợp đồng đã xác nhận; tối đa 1 yêu cầu cùng loại đang mở và 10 yêu cầu mở tổng cộng; giới hạn 5 file gửi, 3 file kết quả. Từ chối cần lý do; giải quyết cần ghi chú hoặc file kết quả.
- File được kiểm tra đuôi, dung lượng và magic bytes; lưu dưới tên UUID trong `uploads/`, không phục vụ tĩnh. Tải xuống qua API có phân quyền.
- **Chưa có:** email thông báo, SLA/hạn xử lý, mẫu giấy tờ tự sinh, gán người xử lý, lịch sử thay đổi.

Kiểm thử: `npm run test:support-unit` (không cần MySQL) và `npm run test:support-api` (cần MySQL/backend).

### HR duyệt & phản hồi

HR xem danh sách tại `GET /api/support-requests?status=&type=&q=&page=&pageSize=`. Kết quả có `items`, `total`, `page`, `pageSize` và phần tổng hợp trạng thái không bị ảnh hưởng bởi bộ lọc. Danh sách ưu tiên yêu cầu `PENDING`, sau đó `IN_PROGRESS`, rồi sắp xếp mới nhất trước.

- `POST /api/support-requests/:id/process`: `START` chỉ từ `PENDING`; `RESOLVE` chỉ từ `IN_PROGRESS` và bắt buộc có ghi chú hoặc file kết quả; `REJECT` từ `PENDING` hoặc `IN_PROGRESS` và bắt buộc có lý do.
- `POST /api/support-requests/:id/result-attachments`: HR tải tối đa ba file kết quả khi đang xử lý. `DELETE /api/support-requests/:id/result-attachments/:attachmentId` chỉ xóa file kết quả khi yêu cầu vẫn `IN_PROGRESS`.
- Mọi chuyển trạng thái dùng cập nhật atomic. Khi có thay đổi, thực tập sinh nhận thông báo chuông `SUPPORT_REQUEST_UPDATED` dẫn đến `tab-my-support`; thông báo giải quyết nhắc có file kết quả nếu có.
- File không được phục vụ tĩnh. Tải xuống qua API có phân quyền, luôn dùng `Content-Disposition: attachment` và `X-Content-Type-Options: nosniff`; tên lưu UUID và `stored_name` không đi vào phản hồi API.

Chưa có: email thông báo, SLA/hạn xử lý, mẫu giấy tờ tự sinh, gán người xử lý riêng và lịch sử thay đổi.

## THỐNG KÊ THỰC TẬP SINH THEO TRƯỜNG / NGÀNH (HR)

**User story:** "Là HR, tôi muốn xem số lượng thực tập sinh theo trường/ngành để phân tích nguồn ứng viên."

- **Bối cảnh & Giả định:**
  - Số lượng thực tập sinh được tính trên bảng `intern_profiles` (đếm hồ sơ thực tập sinh, không đếm hợp đồng). Mặc định tính tất cả thực tập sinh, có bộ lọc theo `status` ("Đang thực tập", "Hoàn thành", "Tạm dừng").
  - Khoảng thời gian: lọc theo ngày tạo hồ sơ thực tập sinh (`created_at`) qua tham số `from` và `to` (mặc định không giới hạn).
  - Phân tích nguồn ứng viên bao gồm: Top trường, Top ngành, ma trận phân bổ Trường × Ngành (kèm tỷ lệ % trên tổng số), và phễu tuyển dụng theo trường từ bảng `candidate_profiles` (số hồ sơ ứng tuyển, đã duyệt, từ chối, chờ duyệt, tỷ lệ duyệt %).
- **Chuẩn hóa tên trường / ngành khi đếm (không sửa dữ liệu gốc):**
  - Cắt khoảng trắng đầu cuối, gộp các khoảng trắng liên tiếp (`\s+` thành một dấu cách).
  - So sánh không phân biệt hoa thường và dấu tiếng Việt (so sánh trên chuỗi chuẩn hóa NFD loại bỏ dấu).
  - Các giá trị `NULL`, chuỗi rỗng `""`, hoặc `"Chưa cập nhật"` được gom thành nhóm riêng mang tên **"Chưa cập nhật"** và luôn hiển thị độc lập, không bị ẩn hay gộp vào "Khác".
  - Nhãn hiển thị của nhóm lấy dạng viết có tần suất xuất hiện phổ biến nhất trong nhóm.
  - Hệ thống chưa có danh mục trường/ngành chuẩn nên không tự động gộp các tên viết tắt khác nhau (ví dụ "ICTU" và "ĐH CNTT & Truyền Thông").
- **Giao diện (`tab-intern-origin-report` trong `Frontend/index.html`):**
  - Thẻ truy cập nằm trong Hub Báo cáo & Thống kê (`reportsHub`), chỉ hiển thị cho HR.
  - Thẻ thống kê tổng quan (Tổng thực tập sinh, Số trường, Số chuyên ngành, Số hồ sơ chưa cập nhật).
  - Bộ lọc: Trạng thái hồ sơ, khoảng ngày (`from`, `to`), xem theo (Trường / Ngành / Cả hai), ô tìm kiếm có debounce ~300ms.
  - Biểu đồ cột ngang trực quan cho Top trường và Top ngành bằng HTML/CSS (có nhãn số liệu, phần trăm, thuộc tính trợ năng `aria-label`/`title`, có thể bấm vào từng thanh để xem danh sách chi tiết).
  - Bảng chi tiết trường, bảng chi tiết ngành và bảng ma trận Trường × Ngành có cuộn ngang.
  - Bảng phễu tuyển dụng theo từng trường (số nộp, đã duyệt, từ chối, chờ duyệt, tỷ lệ duyệt %).
  - Modal danh sách thực tập sinh: bấm vào một nhóm trường/ngành bất kỳ sẽ mở modal hiển thị danh sách thực tập sinh thuộc nhóm đó kèm phân trang (Họ tên, MSSV, Trường, Ngành, Trạng thái, Mentor).
  - Nút **Xuất CSV**: chống double-submit, tải qua `fetch` kèm token xác thực, lưu file UTF-8 có BOM mở được trực tiếp trên Excel (`thuc-tap-sinh-theo-truong-nganh_YYYY-MM-DD.csv`).
- **API (Header `Cache-Control: private, no-store`):**
  - `GET /api/reports/interns-by-origin`: lấy dữ liệu thống kê tổng quan, top trường, top ngành, ma trận và phễu tuyển dụng (`groupBy`, `status`, `from`, `to`, `q`, `limit`).
  - `GET /api/reports/interns-by-origin/interns`: lấy danh sách thực tập sinh chi tiết thuộc nhóm có phân trang (`university`, `major`, `status`, `from`, `to`, `q`, `page`, `pageSize`).
  - `GET /api/reports/interns-by-origin/export.csv`: xuất file CSV UTF-8 BOM, an toàn chống CSV injection bằng hàm `csvCell`.
- **Bảo mật & Quyền hạn:**
  - Chỉ HR có quyền truy cập (`[requireRole("HR"), checkPermission("VIEW_REPORTS")]`). Admin, Mentor và Intern nhận mã lỗi 403. Chưa đăng nhập nhận 401.
  - API thống kê và danh sách chi tiết tuyệt đối **không** làm lộ thông tin nhạy cảm như email hay số điện thoại của thực tập sinh.
  - Tham số tìm kiếm `q` được escape ký tự đại diện `%` và `_` khi truy vấn SQL `LIKE`.
  - Toàn bộ dữ liệu render trên giao diện được xử lý qua hàm `escapeHtml` chống XSS.
- **Xử lý lỗi (HTTP 400, thông báo tiếng Việt):**
  - 400 khi có tham số lạ hoặc tham số bị lặp lại trong query string.
  - 400 khi `groupBy` không hợp lệ, ngày sai định dạng YYYY-MM-DD hoặc `from` > `to`.
  - 400 khi `limit`, `page`, `pageSize` không phải số nguyên dương hoặc vượt quá 100.
  - 400 khi `q` quá 100 ký tự.
  - Dữ liệu rỗng trả mã 200 với danh sách rỗng và `total = 0`, không gây lỗi chia cho 0 khi tính tỷ lệ %.
- **Chưa có:**
  - Danh mục chuẩn hóa trường và ngành học tự động gộp tên viết tắt (alias matching).
  - So sánh biến động nguồn ứng viên theo từng kỳ tuyển dụng / theo năm học.
  - Biểu đồ trực quan hóa xu hướng nộp hồ sơ theo dòng thời gian (time-series).
  - Xuất báo cáo trực tiếp ra định dạng Excel (.xlsx) nhiều sheet hoặc PDF có biểu đồ.
- **Kiểm thử:**
  - `npm run test:intern-origin-unit`: Unit test logic chuẩn hóa, gom nhóm, nhãn phổ biến nhất, sắp xếp, tính % làm tròn, top N + Khác, bảo toàn Chưa cập nhật, validate tham số và chống CSV injection (không cần MySQL).
  - `npm run test:intern-origin-api`: API test toàn diện kiểm tra RBAC (401/403/200), gom nhóm biến thể chữ hoa/thường/khoảng trắng trên MySQL thật, bộ lọc trạng thái và khoảng ngày, phễu tuyển dụng, phân trang danh sách chi tiết, bảo mật không lộ email/SĐT, và tải CSV đúng UTF-8 BOM.



## US6 — Tỷ lệ hoàn thành chương trình

HR có VIEW_REPORTS xác nhận kết quả riêng từng chương trình tại **Chương trình thực tập → Thực tập sinh & mentor → Kết quả chương trình**. Kết quả A được giữ khi xếp tiếp chương trình B; ứng dụng chặn lịch trùng.

**Nâng cấp từ bản cũ:** giữ cấu hình riêng, dừng backend cũ, chạy `cd backend`, `npm ci`, `npm run migrate:program-completion`, rồi `npm start`. Không import lại schema/seed vào DB đang dùng. Lượt cũ không tự suy ra hoàn thành từ trạng thái hồ sơ; cần HR rà soát.

Báo cáo trong Report Hub có bộ lọc thời gian chương trình/trạng thái chương trình, thống kê theo lượt tham gia và số người riêng, drill-down và CSV.

Xem [FIXES_US6.md](FIXES_US6.md) để biết định nghĩa, migration, API, kiểm thử và giới hạn.

Ghi chú lần thống nhất định dạng/xử lý lỗi: [FIXES_CODE_STYLE.md](FIXES_CODE_STYLE.md).
