
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
    `status` VARCHAR(50) DEFAULT 'Đang thực tập',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
(2, 1), (2, 4),                         -- HR: MANAGE_USERS, VIEW_REPORTS
(3, 2),                                 -- Mentor: ASSIGN_TASKS
(4, 3);                                 -- Intern: SUBMIT_WORK
