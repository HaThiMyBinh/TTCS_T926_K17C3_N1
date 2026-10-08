
USE `user_management`;

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- 1. NẠP DỮ LIỆU VAI TRÒ (ROLES)
INSERT INTO `roles` (`id`, `role_name`, `description`) VALUES
(1, 'Admin', 'Quản trị viên toàn quyền hệ thống'),
(2, 'HR', 'Quản lý nhân sự và tuyển dụng thực tập sinh'),
(3, 'Mentor', 'Người hướng dẫn và đánh giá thực tập sinh'),
(4, 'Intern', 'Thực tập sinh tham gia chương trình đào tạo')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

-- 2. NẠP DANH MỤC QUYỀN CHỨC NĂNG (PERMISSIONS)
INSERT INTO `permissions` (`id`, `perm_code`, `perm_name`, `description`) VALUES
(1, 'MANAGE_USERS', 'Quản lý tài khoản', 'Tạo mới, xem và xóa tài khoản người dùng'),
(2, 'ASSIGN_TASKS', 'Giao nhiệm vụ & Task', 'Phân công nhiệm vụ cho thực tập sinh'),
(3, 'SUBMIT_WORK', 'Nộp báo cáo công việc', 'Thực tập sinh gửi báo cáo tiến độ tuần'),
(4, 'VIEW_REPORTS', 'Xem báo cáo & Thống kê', 'Xem số liệu báo cáo đào tạo mật'),
(5, 'SYSTEM_SETTINGS', 'Cài đặt hệ thống', 'Quản lý phân quyền vai trò và hệ thống')
ON DUPLICATE KEY UPDATE `perm_name` = VALUES(`perm_name`);

-- 3. GÁN MA TRẬN PHÂN QUYỀN MẶC ĐỊNH (ROLE_PERMISSIONS)
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`) VALUES
(1, 1), (1, 5),
(2, 1), (2, 4),
(3, 2),
(4, 3);

-- 5. NẠP DANH SÁCH HỒ SƠ ỨNG TUYỂN MẪU (CANDIDATE_PROFILES )
INSERT INTO `candidate_profiles` (`id`, `full_name`, `email`, `phone`, `university`, `major`, `cv_link`, `password_hash`, `status`) VALUES
(2001, 'Lê Anh Đức', 'dtc245200050@ictu.edu.vn', '0912345678', 'ĐH CNTT & Truyền Thông (ICTU)', 'Kỹ thuật phần mềm', 'https://github.com/nguyenvanan-cv', '123456', 'Chờ duyệt'),
(2002, 'Nguyễn Quốc Bảo', 'bao162650@gmail.com', '0987654321', 'ĐH Bách Khoa Hà Nội', 'Công nghệ thông tin', 'https://drive.google.com/cv-mai', '123456', 'Đã duyệt'),
(2003, 'Cao Chiến', 'caoxuanchien963@gmail.com', '0933445566', 'ĐH Sư Phạm Kỹ Thuật', 'Hệ thống thông tin', 'https://linkedin.com/in/huy-le', '123456', 'Chờ duyệt')
ON DUPLICATE KEY UPDATE
    `full_name` = VALUES(`full_name`),
    `phone` = VALUES(`phone`),
    `status` = VALUES(`status`);
