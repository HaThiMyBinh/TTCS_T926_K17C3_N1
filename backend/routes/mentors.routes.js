const express = require("express");
const db = require("../db");
const { requireRole } = require("../auth");
const { HttpError, sendRouteError } = require("../errors");
const { trimOrDefault } = require("../utils/request");
const { makeEndpoint } = require("../utils/endpoint");
const mentorInterns = require("../services/mentorInterns.service");
const endpoint = makeEndpoint("MENTOR");
const router = express.Router();
router.get("/mentors/me/interns", requireRole("Mentor"), async (req, res) => {
  try {
    const students = await db.getStudentsForMentorEmail(req.user.email);
    res.json(students);
  } catch (err) {
    return sendRouteError(
      res,
      err,
      "Lỗi đọc danh sách thực tập sinh của mentor!",
    );
  }
});

// HR xem / gán thực tập sinh theo từng mentor (Quản lý mentor).
router.get(
  "/mentors/:id/interns",
  requireRole("Admin", "HR"),
  endpoint(
    (req) => mentorInterns.list(req.params.id),
    "Lấy thực tập sinh của mentor thành công!",
  ),
);
router.get(
  "/mentors/:id/available-interns",
  requireRole("HR"),
  endpoint(
    (req) => mentorInterns.available(req.params.id),
    "Lấy thực tập sinh có thể gán thành công!",
  ),
);
router.post(
  "/mentors/:id/interns",
  requireRole("HR"),
  endpoint(
    (req) =>
      mentorInterns.assign(req.params.id, req.body, {
        userId: req.user && req.user.id,
      }),
    "Cập nhật phân công mentor thành công!",
  ),
);

router.get(
  "/mentors",
  requireRole("Admin", "HR", "Mentor"),
  async (req, res) => {
    try {
      const mentors = await db.getAllMentors();
      res.json(mentors);
    } catch (err) {
      return sendRouteError(res, err, "Lỗi đọc danh sách mentor!");
    }
  },
);

// POST /api/mentors - HR thêm mentor để phân công cho thực tập sinh
router.post("/mentors", requireRole("Admin", "HR"), async (req, res) => {
  try {
    const { fullName, email, phone, department, specialization } = req.body;
    if (!fullName || !email || !department) {
      return sendRouteError(
        res,
        new HttpError(400, "Vui lòng nhập đầy đủ Họ tên, Email và Phòng ban!"),
      );
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
    return sendRouteError(res, err, "Lỗi server khi thêm mentor!");
  }
});

// PUT /api/mentors/:id
router.put("/mentors/:id", requireRole("Admin", "HR"), async (req, res) => {
  try {
    const { fullName, email, phone, department, specialization } = req.body;
    if (!fullName || !email || !department) {
      return sendRouteError(
        res,
        new HttpError(400, "Vui lòng nhập đầy đủ Họ tên, Email và Phòng ban!"),
      );
    }
    const updated = await db.updateMentor(req.params.id, {
      fullName: trimOrDefault(fullName),
      email: trimOrDefault(email).toLowerCase(),
      phone: trimOrDefault(phone),
      department: trimOrDefault(department),
      specialization: trimOrDefault(specialization),
    });
    if (!updated) {
      return sendRouteError(
        res,
        new HttpError(404, "Không tìm thấy mentor cần cập nhật!"),
      );
    }
    res.json({
      message: "Cập nhật thông tin mentor thành công!",
      mentor: updated,
    });
  } catch (err) {
    return sendRouteError(res, err, "Lỗi server khi cập nhật mentor!");
  }
});

// DELETE /api/mentors/:id
router.delete("/mentors/:id", requireRole("Admin", "HR"), async (req, res) => {
  try {
    await db.deleteMentor(req.params.id);
    res.json({ message: "Đã xóa mentor khỏi hệ thống!" });
  } catch (err) {
    return sendRouteError(res, err, "Lỗi khi xóa mentor!");
  }
});

module.exports = router;
