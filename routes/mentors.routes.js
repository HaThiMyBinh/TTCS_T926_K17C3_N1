const express = require("express");
const db = require("../db");
const { requireRole } = require("../auth");
const { trimOrDefault } = require("../utils/request");
const router = express.Router();
router.get(
  "/mentors",
  requireRole("Admin", "HR", "Mentor"),
  async (req, res) => {
    try {
      const mentors = await db.getAllMentors();
      res.json(mentors);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Lỗi đọc danh sách mentor!" });
    }
  },
);

// POST /api/mentors - HR thêm mentor để phân công cho thực tập sinh
router.post("/mentors", requireRole("Admin", "HR"), async (req, res) => {
  try {
    const { fullName, email, phone, department, specialization } = req.body;
    if (!fullName || !email || !department) {
      return res
        .status(400)
        .json({ error: "Vui lòng nhập đầy đủ Họ tên, Email và Phòng ban!" });
    }
    const mentors = await db.getAllMentors();
    if (
      mentors.some(
        (m) => m.email && m.email.toLowerCase() === email.trim().toLowerCase(),
      )
    ) {
      return res
        .status(400)
        .json({ error: "Email mentor này đã tồn tại trong hệ thống!" });
    }
    const newMentor = await db.insertMentor({
      fullName: trimOrDefault(fullName),
      email: trimOrDefault(email).toLowerCase(),
      phone: trimOrDefault(phone),
      department: trimOrDefault(department),
      specialization: trimOrDefault(specialization),
    });
    res
      .status(201)
      .json({ message: "Thêm mentor mới thành công!", mentor: newMentor });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Lỗi server khi thêm mentor!" });
  }
});

// PUT /api/mentors/:id
router.put("/mentors/:id", requireRole("Admin", "HR"), async (req, res) => {
  try {
    const { fullName, email, phone, department, specialization } = req.body;
    if (!fullName || !email || !department) {
      return res
        .status(400)
        .json({ error: "Vui lòng nhập đầy đủ Họ tên, Email và Phòng ban!" });
    }
    const updated = await db.updateMentor(req.params.id, {
      fullName: trimOrDefault(fullName),
      email: trimOrDefault(email).toLowerCase(),
      phone: trimOrDefault(phone),
      department: trimOrDefault(department),
      specialization: trimOrDefault(specialization),
    });
    if (!updated) {
      return res
        .status(404)
        .json({ error: "Không tìm thấy mentor cần cập nhật!" });
    }
    res.json({
      message: "Cập nhật thông tin mentor thành công!",
      mentor: updated,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Lỗi server khi cập nhật mentor!" });
  }
});

// DELETE /api/mentors/:id
router.delete("/mentors/:id", requireRole("Admin", "HR"), async (req, res) => {
  try {
    await db.deleteMentor(req.params.id);
    res.json({ message: "Đã xóa mentor khỏi hệ thống!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi khi xóa mentor!" });
  }
});

module.exports = router;


