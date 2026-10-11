
-- DATABASE SCHEMA: HỆ THỐNG QUẢN LÝ NGƯỜI DÙNG & PHÂN QUYỀN (USER MANAGEMENT)

CREATE DATABASE IF NOT EXISTS `user_management` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `user_management`;

-- 1. BẢNG ROLES (Vai trò trong hệ thống)
CREATE TABLE IF NOT EXISTS `roles` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `role_name` VARCHAR(50) NOT NULL UNIQUE,
    `description` VARCHAR(255) NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. BẢNG PERMISSIONS (Danh mục quyền chức năng)
CREATE TABLE IF NOT EXISTS `permissions` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `perm_code` VARCHAR(50) NOT NULL UNIQUE,
    `perm_name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. BẢNG ROLE_PERMISSIONS (Ma trận gán quyền cho vai trò - RBAC)
CREATE TABLE IF NOT EXISTS `role_permissions` (
    `role_id` INT NOT NULL,
    `permission_id` INT NOT NULL,
    PRIMARY KEY (`role_id`, `permission_id`),
    FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. BẢNG USERS (Tài khoản người dùng trong hệ thống)
CREATE TABLE IF NOT EXISTS `users` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(150) NOT NULL UNIQUE,
    `password_hash` VARCHAR(255) NOT NULL,
    `role_id` INT NOT NULL,
    `phone` VARCHAR(20) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'LOCKED', 'PENDING') DEFAULT 'ACTIVE',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. BẢNG CANDIDATE_PROFILES (Hồ sơ ứng tuyển trực tuyến của thực tập sinh )
CREATE TABLE IF NOT EXISTS `candidate_profiles` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `user_id` BIGINT NULL,
    `full_name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(150) NOT NULL UNIQUE,
    `phone` VARCHAR(20) NOT NULL,
    `university` VARCHAR(150) NOT NULL,
    `major` VARCHAR(100) NULL,
    `cv_link` VARCHAR(255) NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `status` ENUM('Chờ duyệt', 'Đã duyệt', 'Từ chối') DEFAULT 'Chờ duyệt',
    `applied_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `rejection_reason` TEXT NULL,                  -- lý do từ chối
    `reviewed_by` BIGINT NULL,                     -- users.id của HR xử lý
    `reviewed_at` DATETIME NULL,                   -- thời điểm xử lý
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- (DB đã tạo từ trước: backend tự ALTER thêm 3 cột trên khi khởi động, không cần chạy tay)

-- 6. BẢNG MENTORS (Quản lý mentor & phòng ban)
CREATE TABLE IF NOT EXISTS `mentors` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `full_name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(150) NOT NULL UNIQUE,
    `phone` VARCHAR(20) NULL,
    `department` VARCHAR(150) NULL,
    `specialization` VARCHAR(150) NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. BẢNG INTERN_PROFILES (Quản lý thông tin cá nhân hồ sơ thực tập sinh)
CREATE TABLE IF NOT EXISTS `intern_profiles` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `student_code` VARCHAR(30) NULL,
    `full_name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(150) NOT NULL UNIQUE,
    `phone` VARCHAR(20) NULL,
    `university` VARCHAR(150) NULL,
    `major` VARCHAR(100) NULL,
    `mentor_name` VARCHAR(100) NULL,
    `mentor_id` BIGINT NULL,
    `status` VARCHAR(50) DEFAULT 'Đang thực tập',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_intern_mentor_id` FOREIGN KEY (`mentor_id`) REFERENCES `mentors`(`id`) ON DELETE SET NULL,
    INDEX `idx_intern_mentor_id` (`mentor_id`),
    INDEX `idx_intern_university` (`university`),
    INDEX `idx_intern_major` (`major`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. BẢNG EMAIL_LOGS (Nhật ký gửi email thông báo kết quả xét duyệt )
CREATE TABLE IF NOT EXISTS `email_logs` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `application_id` BIGINT NULL,
    `recipient_email` VARCHAR(150) NOT NULL,
    `recipient_name` VARCHAR(100) NULL,
    `email_type` ENUM('APPROVED', 'REJECTED') NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `status` ENUM('PENDING', 'RETRYING', 'SENT', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `attempts` INT NOT NULL DEFAULT 0,
    `error_message` TEXT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `sent_at` DATETIME NULL,
    FOREIGN KEY (`application_id`) REFERENCES `candidate_profiles`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 9. BẢNG APPLICATION_DOCUMENTS (Tài liệu hồ sơ ứng tuyển: CV & Đơn xin thực tập )
CREATE TABLE IF NOT EXISTS `application_documents` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `application_id` BIGINT NOT NULL,
    `doc_type` ENUM('CV', 'APPLICATION_LETTER') NOT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `stored_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(100) NOT NULL,
    `size_bytes` BIGINT NOT NULL,
    `uploaded_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uq_application_doc_type` (`application_id`, `doc_type`),
    FOREIGN KEY (`application_id`) REFERENCES `candidate_profiles`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;



-- 10. BẢNG HỢP ĐỒNG THỰC TẬP SINH (hồ sơ chính thức)
CREATE TABLE IF NOT EXISTS `internship_contracts` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `intern_id` BIGINT NOT NULL,
    `title` VARCHAR(255) NULL,
    `start_date` DATE NULL,
    `end_date` DATE NULL,
    `note` TEXT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `stored_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(100) NOT NULL,
    `size_bytes` BIGINT NOT NULL,
    `uploaded_by` BIGINT NULL,
    `uploaded_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `confirmation_status` ENUM('PENDING', 'CONFIRMED') NOT NULL DEFAULT 'PENDING',
    `program_id` BIGINT NULL,
    `confirmed_at` DATETIME NULL,
    `confirmed_by` BIGINT NULL,
    INDEX `idx_contract_intern` (`intern_id`),
    INDEX `idx_contract_confirmed_by` (`confirmed_by`),
    FOREIGN KEY (`intern_id`) REFERENCES `intern_profiles`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_contract_confirmed_by` FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Bảng mới cho kế hoạch chương trình thực tập; không thay đổi bảng hiện có.
CREATE TABLE IF NOT EXISTS `departments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(150) NOT NULL COLLATE utf8mb4_unicode_ci,
  `description` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_departments_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `internship_programs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `department_id` INT NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `start_date` DATE NULL,
  `end_date` DATE NULL,
  `capacity` INT NULL,
  CONSTRAINT `chk_program_capacity` CHECK (`capacity` IS NULL OR `capacity` >= 1),
  `status` ENUM('DRAFT','OPEN','ONGOING','CLOSED') NOT NULL DEFAULT 'DRAFT',
  `created_by` BIGINT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_program_department` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_program_creator` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  INDEX `idx_program_department_status` (`department_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE `internship_contracts`
  ADD CONSTRAINT `fk_contract_program` FOREIGN KEY (`program_id`) REFERENCES `internship_programs`(`id`) ON DELETE SET NULL;

-- 12. BẢNG LỊCH THỰC TẬP CÁ NHÂN & KẾ HOẠCH ĐÀO TẠO (INTERN_SCHEDULES)
CREATE TABLE IF NOT EXISTS `intern_schedules` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `intern_id` BIGINT NOT NULL,
  `phase_order` INT NOT NULL DEFAULT 1,
  `title` VARCHAR(255) NOT NULL,
  `start_date` DATE NULL,
  `end_date` DATE NULL,
  `duration_weeks` VARCHAR(50) NULL,
  `description` TEXT NULL,
  `expected_results` TEXT NULL,
  `status` ENUM('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED') NOT NULL DEFAULT 'NOT_STARTED',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_schedule_intern_phase` (`intern_id`, `phase_order`),
  INDEX `idx_schedule_intern` (`intern_id`),
  CONSTRAINT `fk_schedule_intern` FOREIGN KEY (`intern_id`) REFERENCES `intern_profiles`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 13. BẢNG NHIỆM VỤ MENTOR GIAO CHO THỰC TẬP SINH (INTERN_TASKS)
CREATE TABLE IF NOT EXISTS `intern_tasks` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `intern_id` BIGINT NOT NULL,
  `created_by_mentor_id` BIGINT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `due_date` DATE NULL,
  `priority` ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL DEFAULT 'MEDIUM',
  `status` ENUM('TODO', 'IN_PROGRESS', 'DONE') NOT NULL DEFAULT 'TODO',
  `progress_percent` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `progress_note` TEXT NULL,
  `progress_updated_at` DATETIME NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_task_intern` (`intern_id`),
  INDEX `idx_task_mentor` (`created_by_mentor_id`),
  CONSTRAINT `fk_task_intern` FOREIGN KEY (`intern_id`) REFERENCES `intern_profiles`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_task_mentor` FOREIGN KEY (`created_by_mentor_id`) REFERENCES `mentors`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 14. BẢNG TỆP ĐÍNH KÈM CỦA CẬP NHẬT TIẾN ĐỘ (TASK_ATTACHMENTS)
CREATE TABLE IF NOT EXISTS `task_attachments` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `task_id` BIGINT NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `stored_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(100) NOT NULL,
  `size_bytes` BIGINT NOT NULL,
  `uploaded_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_task_attachment_task` (`task_id`),
  CONSTRAINT `fk_task_attachment_task` FOREIGN KEY (`task_id`) REFERENCES `intern_tasks`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 15. BẢNG BÁO CÁO TUẦN CỦA THỰC TẬP SINH (WEEKLY_REPORTS)
CREATE TABLE IF NOT EXISTS `weekly_reports` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `intern_id` BIGINT NOT NULL,
  `week_start` DATE NOT NULL,
  `content` TEXT NOT NULL,
  `difficulties` TEXT NULL,
  `next_plan` TEXT NULL,
  `is_late` TINYINT(1) NOT NULL DEFAULT 0,
  `submitted_at` DATETIME NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_weekly_report_intern_week` (`intern_id`, `week_start`),
  CONSTRAINT `fk_weekly_report_intern` FOREIGN KEY (`intern_id`) REFERENCES `intern_profiles`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 16. BẢNG TỆP ĐÍNH KÈM CỦA BÁO CÁO TUẦN (WEEKLY_REPORT_ATTACHMENTS)
CREATE TABLE IF NOT EXISTS `weekly_report_attachments` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `report_id` BIGINT NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `stored_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(100) NOT NULL,
  `size_bytes` BIGINT NOT NULL,
  `uploaded_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_weekly_attachment_report` (`report_id`),
  CONSTRAINT `fk_weekly_attachment_report` FOREIGN KEY (`report_id`) REFERENCES `weekly_reports`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 17. BẢNG PHẢN HỒI CỦA MENTOR CHO BÁO CÁO TUẦN (WEEKLY_REPORT_FEEDBACK)
-- Mỗi báo cáo tuần có tối đa 1 phản hồi (mentor gửi lại thì cập nhật).
CREATE TABLE IF NOT EXISTS `weekly_report_feedback` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `report_id` BIGINT NOT NULL,
  `mentor_id` BIGINT NULL,
  `content` TEXT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_weekly_feedback_report` (`report_id`),
  INDEX `idx_weekly_feedback_mentor` (`mentor_id`),
  CONSTRAINT `fk_weekly_feedback_report` FOREIGN KEY (`report_id`) REFERENCES `weekly_reports`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_weekly_feedback_mentor` FOREIGN KEY (`mentor_id`) REFERENCES `mentors`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 18. BẢNG ĐÁNH GIÁ TỔNG KẾT CỦA MENTOR CHO THỰC TẬP SINH (INTERN_EVALUATIONS)
-- Mỗi thực tập sinh có tối đa 1 đánh giá (mentor gửi lại thì cập nhật). Điểm 1-5.
CREATE TABLE IF NOT EXISTS `intern_evaluations` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `intern_id` BIGINT NOT NULL,
  `mentor_id` BIGINT NULL,
  `skill_score` TINYINT UNSIGNED NOT NULL,
  `skill_comment` TEXT NULL,
  `attitude_score` TINYINT UNSIGNED NOT NULL,
  `attitude_comment` TEXT NULL,
  `overall_comment` TEXT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_evaluation_intern` (`intern_id`),
  INDEX `idx_evaluation_mentor` (`mentor_id`),
  CONSTRAINT `chk_eval_skill` CHECK (`skill_score` BETWEEN 1 AND 5),
  CONSTRAINT `chk_eval_attitude` CHECK (`attitude_score` BETWEEN 1 AND 5),
  CONSTRAINT `fk_evaluation_intern` FOREIGN KEY (`intern_id`) REFERENCES `intern_profiles`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_evaluation_mentor` FOREIGN KEY (`mentor_id`) REFERENCES `mentors`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 19. BẢNG CHẤM CÔNG THỰC TẬP SINH (ATTENDANCE_RECORDS)
CREATE TABLE IF NOT EXISTS `attendance_records` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `intern_id` BIGINT NOT NULL,
  `work_date` DATE NOT NULL,
  `check_in_at` DATETIME NOT NULL,
  `check_out_at` DATETIME NULL,
  `note` VARCHAR(255) NULL,
  `is_adjusted` TINYINT(1) NOT NULL DEFAULT 0,
  `correction_status` ENUM('PENDING','APPROVED','REJECTED') NULL,
  `correction_check_out_at` DATETIME NULL,
  `correction_reason` VARCHAR(255) NULL,
  `correction_requested_at` DATETIME NULL,
  `correction_reviewed_by` BIGINT NULL,
  `correction_reviewed_at` DATETIME NULL,
  `correction_review_note` VARCHAR(255) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_attendance_intern_date` (`intern_id`, `work_date`),
  CONSTRAINT `chk_attendance_checkout` CHECK (`check_out_at` IS NULL OR `check_out_at` >= `check_in_at`),
  CONSTRAINT `fk_attendance_intern` FOREIGN KEY (`intern_id`) REFERENCES `intern_profiles`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 19b. BẢNG ĐƠN XIN NGHỈ CỦA THỰC TẬP SINH (LEAVE_REQUESTS)
CREATE TABLE IF NOT EXISTS `leave_requests` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `intern_id` BIGINT NOT NULL,
  `leave_type` ENUM('PERSONAL','SICK','STUDY','OTHER') NOT NULL DEFAULT 'PERSONAL',
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `status` ENUM('PENDING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `reviewed_by` BIGINT NULL,
  `reviewed_at` DATETIME NULL,
  `review_note` VARCHAR(255) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_leave_intern_dates` (`intern_id`, `start_date`, `end_date`),
  INDEX `idx_leave_status_start` (`status`, `start_date`),
  CONSTRAINT `chk_leave_dates` CHECK (`end_date` >= `start_date`),
  CONSTRAINT `fk_leave_intern` FOREIGN KEY (`intern_id`) REFERENCES `intern_profiles`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 20. BẢNG BÁO CÁO TỔNG KẾT CUỐI KỲ (FINAL_REPORTS)
CREATE TABLE IF NOT EXISTS `final_reports` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL,
  `scope_type` ENUM('ALL','UNIVERSITY','PROGRAM') NOT NULL,
  `scope_value` VARCHAR(255) NULL,
  `period_from` DATE NULL,
  `period_to` DATE NULL,
  `status` ENUM('DRAFT','FINALIZED') NOT NULL DEFAULT 'DRAFT',
  `hr_note` TEXT NULL,
  `snapshot_json` LONGTEXT NULL,
  `created_by` BIGINT NULL,
  `finalized_by` BIGINT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `finalized_at` DATETIME NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_final_report_creator` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_final_report_finalizer` FOREIGN KEY (`finalized_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 21. LỊCH SỬ GỬI BÁO CÁO CUỐI KỲ (FINAL_REPORT_SENDS)
CREATE TABLE IF NOT EXISTS `final_report_sends` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `report_id` BIGINT NOT NULL,
  `sent_by` BIGINT NULL,
  `recipients` TEXT NOT NULL,
  `message` VARCHAR(1000) NULL,
  `sent_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_final_report_sends_report` (`report_id`, `sent_at`),
  CONSTRAINT `fk_final_report_send_report` FOREIGN KEY (`report_id`) REFERENCES `final_reports`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_final_report_send_user` FOREIGN KEY (`sent_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 22. EMAIL NGƯỜI NHẬN BÁO CÁO CUỐI KỲ (gợi ý theo phạm vi; scope_value rỗng = ALL)
CREATE TABLE IF NOT EXISTS `final_report_recipients` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `email` VARCHAR(254) NOT NULL,
  `scope_type` ENUM('ALL','UNIVERSITY','PROGRAM') NOT NULL,
  `scope_value` VARCHAR(255) NOT NULL DEFAULT '',
  `created_by` BIGINT NULL,
  `last_used_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_final_report_recipient` (`email`, `scope_type`, `scope_value`),
  CONSTRAINT `fk_final_report_recipient_user` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ==============================================================================
-- DỮ LIỆU MẪU BAN ĐẦU (SEED DATA)
-- ==============================================================================

-- Thêm vai trò
INSERT INTO `roles` (`id`, `role_name`, `description`) VALUES
(1, 'Admin', 'Quản trị viên toàn quyền hệ thống'),
(2, 'HR', 'Quản lý nhân sự & tuyển dụng thực tập sinh'),
(3, 'Mentor', 'Người hướng dẫn thực tập sinh'),
(4, 'Intern', 'Thực tập sinh tham gia chương trình');

-- Thêm quyền chức năng
INSERT INTO `permissions` (`id`, `perm_code`, `perm_name`, `description`) VALUES
(1, 'MANAGE_USERS', 'Quản lý tài khoản', 'Tạo, sửa, xóa tài khoản người dùng'),
(2, 'ASSIGN_TASKS', 'Giao nhiệm vụ & Task', 'Phân công nhiệm vụ cho thực tập sinh'),
(3, 'SUBMIT_WORK', 'Nộp báo cáo công việc', 'Thực tập sinh gửi báo cáo/tiến độ'),
(4, 'VIEW_REPORTS', 'Xem báo cáo & Thống kê', 'Xem số liệu thống kê đào tạo'),
(5, 'SYSTEM_SETTINGS', 'Cài đặt hệ thống', 'Cấu hình phân quyền và hệ thống');

-- Gán quyền mặc định cho từng vai trò
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES
(1, 1), (1, 5), -- Admin: chỉ còn MANAGE_USERS và SYSTEM_SETTINGS
(2, 4),                                 -- HR: VIEW_REPORTS
(3, 2),                                 -- Mentor: ASSIGN_TASKS
(4, 3);                                 -- Intern: SUBMIT_WORK
