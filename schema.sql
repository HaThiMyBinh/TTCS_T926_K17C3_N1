
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

-- 5. BẢNG CANDIDATE_PROFILES (Hồ sơ ứng tuyển trực tuyến của thực tập sinh - US 3)
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
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
