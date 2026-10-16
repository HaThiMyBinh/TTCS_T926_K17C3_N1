-- LEGACY/MIGRATION fixture: profile statuses do NOT become course results.
-- New memberships stay IN_PROGRESS until HR confirms each result. Existing overlapping legacy rows are retained for review.
-- OPTIONAL FIXTURE: ONLY for a NEW DISPOSABLE test database after schema.sql + seed_data.sql.
-- Never import into a user/production database. No UPDATE/DELETE statements.
SET NAMES utf8mb4;
INSERT INTO departments (id,name) VALUES (96001,'US6 test department');
INSERT INTO mentors (id,full_name,email) VALUES
(96001,'Mentor O''Brien <>&"','us6_mentor_a@example.test'),
(96002,'constructor','us6_mentor_b@example.test');
INSERT INTO internship_programs (id,department_id,name,status,start_date,end_date) VALUES
(96001,96001,'O''Brien <>&"','ONGOING','2026-01-01','2026-06-30'),
(96002,96001,'__proto__','CLOSED','2026-01-01','2026-06-30'),
(96003,96001,'=1+1','OPEN','2026-01-01','2026-06-30');
INSERT INTO intern_profiles (id,full_name,email,student_code,university,status,mentor_id,mentor_name,created_at) VALUES
(96001,'A 50%_\\O''Brien','us6_a@example.test','US6_A','Đại học Y','Hoàn thành',96001,NULL,'2026-01-10 10:00:00'),
(96002,'B','us6_b@example.test','US6_B','Dai  hoc Y','Đang thực tập',96001,NULL,'2026-01-10 10:00:00'),
(96003,'C','us6_c@example.test','US6_C',NULL,'Tạm dừng',96002,NULL,'2026-01-10 10:00:00'),
(96004,'D','us6_d@example.test','US6_D','','Hoàn thành',NULL,'Đại  học Y','2026-01-20 10:00:00'),
(96005,'E','us6_e@example.test','US6_E','Chưa cập nhật',NULL,NULL,NULL,'2026-01-20 10:00:00'),
(96006,'F','us6_f@example.test','US6_F','__proto__','Hoàn thành',96002,NULL,'2026-01-20 10:00:00'),
(96007,'G','us6_g@example.test','US6_G','constructor','Đang thực tập',NULL,'Dai hoc Y','2026-01-20 10:00:00');
INSERT INTO program_interns (program_id,intern_id) VALUES
(96001,96001),(96002,96001),(96001,96002),(96002,96003),(96002,96004),(96003,96006),(96001,96007);
