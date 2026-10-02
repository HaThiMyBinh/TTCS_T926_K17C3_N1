const express = require("express");
const db = require("../db");
const { requireRole } = require("../auth");
const { attachApplicationsToStudents } = require("../services/applications.service");
const { trimOrDefault } = require("../utils/request");
const router = express.Router();
// --- QUẢN LÝ HỒ SƠ THỰC TẬP SINH (INTERNS / STUDENTS) ---

// GET /api/interns & GET /api/students
async function handleGetInterns(req, res) {
  try {
    const students = await db.getAllStudents();
    // US10: chỉ HR nhận kèm hồ sơ ứng tuyển + tài liệu của từng thực tập sinh
    res.json(
      req.user.role === "HR" ? await attachApplicationsToStudents(students) : students,
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi đọc danh sách hồ sơ thực tập sinh!" });
  }
}
router.get("/interns", requireRole("Admin", "HR", "Mentor"), handleGetInterns);
router.get(
  "/students",
  requireRole("Admin", "HR", "Mentor"),
  handleGetInterns,
);

// POST /api/interns & POST /api/students
async function handleCreateIntern(req, res) {
  try {
    const {
      studentCode,
      fullName,
      email,
      phone,
      university,
      major,
      mentorName,
      status,
    } = req.body;

    if (!fullName || !email || !university) {
      return res.status(400).json({
        error: "Vui lòng nhập đầy đủ Họ tên, Email và Trường đại học!",
      });
    }

    const students = await db.getAllStudents();

    if (studentCode && isDuplicateStudentCode(students, studentCode)) {
      return res
        .status(400)
        .json({ error: "Mã sinh viên này đã tồn tại trong hệ thống!" });
    }

    if (isDuplicateStudentEmail(students, email)) {
      return res
        .status(400)
        .json({ error: "Email hồ sơ thực tập sinh này đã tồn tại!" });
    }

    const newStudent = await db.insertStudent({
      studentCode: trimOrDefault(studentCode),
      fullName: trimOrDefault(fullName),
      email: trimOrDefault(email).toLowerCase(),
      phone: trimOrDefault(phone),
      university: trimOrDefault(university),
      major: trimOrDefault(major),
      mentorName: trimOrDefault(mentorName),
      status: status || "Đang thực tập",
    });

    res.status(201).json({
      message: "Thêm mới hồ sơ thực tập sinh thành công!",
      student: newStudent,
      intern: newStudent,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Lỗi server khi thêm hồ sơ thực tập sinh!" });
  }
}
router.post("/interns", requireRole("Admin", "HR"), handleCreateIntern);
router.post("/students", requireRole("Admin", "HR"), handleCreateIntern);

// PUT /api/interns/:id & PUT /api/students/:id
async function handleUpdateIntern(req, res) {
  try {
    const {
      studentCode,
      fullName,
      email,
      phone,
      university,
      major,
      mentorName,
      status,
    } = req.body;

    if (!fullName || !email || !university) {
      return res.status(400).json({
        error: "Vui lòng nhập đầy đủ Họ tên, Email và Trường đại học!",
      });
    }

    const students = await db.getAllStudents();
    const currentId = Number(req.params.id);

    // Kiểm tra trùng Mã SV / Email với các hồ sơ *khác* (loại trừ chính hồ sơ đang sửa)
    if (
      studentCode &&
      isDuplicateStudentCode(students, studentCode, currentId)
    ) {
      return res
        .status(400)
        .json({ error: "Mã sinh viên này đã thuộc về thực tập sinh khác!" });
    }

    if (isDuplicateStudentEmail(students, email, currentId)) {
      return res
        .status(400)
        .json({ error: "Email này đã thuộc về thực tập sinh khác!" });
    }

    const updated = await db.updateStudent(req.params.id, {
      studentCode,
      fullName,
      email: trimOrDefault(email).toLowerCase(),
      phone,
      university,
      major,
      mentorName,
      status,
    });

    if (!updated) {
      return res
        .status(404)
        .json({ error: "Không tìm thấy hồ sơ thực tập sinh cần cập nhật!" });
    }

    res.json({
      message: "Cập nhật hồ sơ thực tập sinh thành công!",
      student: updated,
      intern: updated,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res
      .status(500)
      .json({ error: "Lỗi server khi cập nhật hồ sơ thực tập sinh!" });
  }
}
router.put("/interns/:id", requireRole("Admin", "HR"), handleUpdateIntern);
router.put("/students/:id", requireRole("Admin", "HR"), handleUpdateIntern);

// DELETE /api/interns/:id & DELETE /api/students/:id
async function handleDeleteIntern(req, res) {
  try {
    await db.deleteStudent(req.params.id);
    res.json({ message: "Đã xóa hồ sơ thực tập sinh!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi khi xóa hồ sơ thực tập sinh!" });
  }
}
router.delete("/interns/:id", requireRole("Admin", "HR"), handleDeleteIntern);
router.delete("/students/:id", requireRole("Admin", "HR"), handleDeleteIntern);

// Kiểm tra trùng Mã SV trong danh sách hồ sơ, có thể loại trừ 1 id (dùng khi sửa)
function isDuplicateStudentCode(students, studentCode, excludeId = null) {
  const target = studentCode.trim().toLowerCase();
  return students.some(
    (s) =>
      (excludeId === null || Number(s.id) !== excludeId) &&
      s.studentCode &&
      s.studentCode.trim().toLowerCase() === target,
  );
}

// Kiểm tra trùng Email trong danh sách hồ sơ, có thể loại trừ 1 id (dùng khi sửa)
function isDuplicateStudentEmail(students, email, excludeId = null) {
  const target = email.trim().toLowerCase();
  return students.some(
    (s) =>
      (excludeId === null || Number(s.id) !== excludeId) &&
      s.email &&
      s.email.toLowerCase() === target,
  );
}

module.exports = router;


