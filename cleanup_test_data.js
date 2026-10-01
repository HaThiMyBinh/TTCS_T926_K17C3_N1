// tests/cleanup_test_data.js - Công cụ dọn TAY dữ liệu rác do các file test để lại trong
// MySQL (ví dụ từ các lần chạy cũ trước khi test tự dọn, hoặc khi test bị dừng giữa chừng
// (Ctrl+C) nên chưa kịp chạy xong khối "finally" dọn dẹp).
//
// AN TOÀN: chỉ xóa các bản ghi có email BẮT ĐẦU BẰNG một trong các tiền tố bên dưới - đây là
// các tiền tố do chính các file test tự sinh (kèm Date.now() để không trùng nhau), KHÔNG khớp
// với 4 tài khoản demo (admin@gmail.com, hr@company.com, mentor@gmail.com, intern@gmail.com)
// hay 3 hồ sơ ứng viên mẫu thật (id 2001-2003) trong seed_data.sql.
//
// Cách chạy: node tests/cleanup_test_data.js   (yêu cầu MySQL đang chạy, không cần backend)
const { cleanupByPattern } = require("./test_helpers");

// Rà soát toàn bộ thư mục tests/ - mỗi dòng ghi rõ tiền tố thuộc file nào, để khi thêm file
// test mới có tạo dữ liệu, chỉ cần bổ sung thêm 1 dòng vào đây.
const TEST_EMAIL_PREFIXES = [
  "us7_", // test_applications.js
  "test_email_", // test_email_api.js
  "candidate_", // test_register.js
  "dup_", // test_register.js
  "mentor_test_", // test_mentors.js
  "intern_", // test_interns.js
  "unique_email_", // test_interns.js
  "auto_hr_", // test_create_account.js
  "auto_mentor_", // test_create_account.js
  "trung_email_", // test_create_account.js
];

(async () => {
  console.log(" Đang dọn dữ liệu test còn sót lại trong MySQL...\n");
  try {
    const removed = await cleanupByPattern(TEST_EMAIL_PREFIXES);
    console.log(
      ` Đã xóa ${removed} bản ghi rác (ứng viên / tài khoản / mentor / hồ sơ thực tập sinh do test tạo ra).`,
    );
  } catch (err) {
    console.error(" Lỗi khi dọn dữ liệu test:", err.message);
    console.error(" -> Kiểm tra MySQL đã chạy và backend/db_config.json đúng chưa.");
    process.exit(1);
  }
})();
