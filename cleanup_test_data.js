// Dọn tay dữ liệu test còn sót trong MySQL (không cần backend): node tests/cleanup_test_data.js
// Chỉ xóa bản ghi có email bắt đầu bằng các tiền tố do chính các test sinh ra,
// không đụng tới tài khoản demo và hồ sơ mẫu trong seed_data.sql.
const { cleanupByPattern } = require("./test_helpers");

// Tiền tố email theo từng file test; thêm dòng mới khi test mới tạo dữ liệu
const TEST_EMAIL_PREFIXES = [
  "us7_", // test_applications.js
  "us9_", // test_documents_api.js
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
