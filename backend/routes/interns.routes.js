const express = require("express");
const db = require("../db");
const { requireRole } = require("../auth");
const { HttpError, sendRouteError } = require("../errors");
const {
  attachApplicationsToStudents,
} = require("../services/applications.service");
const { trimOrDefault } = require("../utils/request");
const { normalizeInternFilters } = require("../utils/internFilters");
const contractsService = require("../services/contracts.service");
const {
  notifyMentorAssignment,
} = require("../services/mentorAssignment.service");
const warn = require("../services/assignmentWarnings.service");
const router = express.Router();
// --- QUẢN LÝ HỒ SƠ THỰC TẬP SINH (INTERNS / STUDENTS) ---

// GET /api/interns & GET /api/students
async function handleGetInterns(req, res) {
  try {
    const filters = normalizeInternFilters(req.query);
    if (req.user.role === "Mentor") {
      return res.json(
        await db.getStudentsForMentorEmail(req.user.email, filters),
      );
    }

    const students = await db.getAllStudents({
      includeContractCount: req.user.role === "HR",
      filters,
    });
    // US10: chỉ HR nhận kèm hồ sơ ứng tuyển + tài liệu của từng thực tập sinh
    res.json(
      req.user.role === "HR"
        ? await attachApplicationsToStudents(students)
        : students,
    );
  } catch (err) {
    return sendRouteError(res, err, "Lỗi đọc danh sách hồ sơ thực tập sinh!");
  }
}
router.get(
  "/interns/filter-options",
  requireRole("Admin", "HR"),
  async (req, res) => {
    try {
      let university = "";
      if (Object.prototype.hasOwnProperty.call(req.query, "university")) {
        university =
          normalizeInternFilters({
            university: req.query.university,
          }).university || "";
      }
      return res.json(await db.getInternFilterOptions({ university }));
    } catch (err) {
      return sendRouteError(
        res,
        err,
        "Lỗi tải danh sách bộ lọc thực tập sinh!",
      );
    }
  },
);
router.get("/interns/count", requireRole("Admin", "HR"), async (req, res) => {
  if (Object.keys(req.query).some((key) => key !== "unassigned")) {
    return sendRouteError(
      res,
      new HttpError(400, "API đếm chỉ nhận tham số unassigned."),
    );
  }
  try {
    const filters = normalizeInternFilters(req.query);
    return res.json({ count: await db.countInterns(filters) });
  } catch (err) {
    return sendRouteError(res, err, "Lỗi đếm hồ sơ thực tập sinh!");
  }
});
router.get("/interns", requireRole("Admin", "HR", "Mentor"), handleGetInterns);
router.get("/students", requireRole("Admin", "HR", "Mentor"), handleGetInterns);

// PUT /api/interns/:id/mentor — HR quản lý phân công mentor.
router.put("/interns/:id/mentor", requireRole("HR"), async (req, res) => {
  const rawId = req.params.id;
  if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(Number(rawId))) {
    return sendRouteError(
      res,
      new HttpError(400, "Mã thực tập sinh không hợp lệ!"),
    );
  }
  if (
    req.body == null ||
    typeof req.body !== "object" ||
    Array.isArray(req.body) ||
    !Object.prototype.hasOwnProperty.call(req.body, "mentor_id")
  ) {
    return sendRouteError(
      res,
      new HttpError(400, "Vui lòng gửi mentor_id hợp lệ!"),
    );
  }

  const mentorId = req.body.mentor_id;
  if (
    mentorId !== null &&
    (typeof mentorId !== "number" ||
      !Number.isSafeInteger(mentorId) ||
      mentorId < 1)
  ) {
    return sendRouteError(
      res,
      new HttpError(400, "Mã mentor phải là số nguyên dương hoặc null!"),
    );
  }

  try {
    const confirmed = warn.parseConfirm(req.body.confirm_warnings);
    const before = await db
      .findInternProfileById(Number(rawId))
      .catch(() => null);
    // Cảnh báo mềm (thực tập sinh không còn thực tập / lệch phòng ban) chỉ khi thật sự đổi mentor.
    if (mentorId != null && before && Number(before.mentorId) !== mentorId) {
      const mentor = await db.findMentorById(mentorId);
      if (mentor)
        warn.requireConfirmation(
          warn.assignmentWarnings({
            mentor,
            interns: [before],
            programDepartments: await db.listProgramDepartmentsForInterns([
              before.id,
            ]),
          }),
          confirmed,
        );
    }
    const result = await db.assignInternMentor(Number(rawId), mentorId, {
      userId: req.user && req.user.id,
    });
    if (result.outcome === "INTERN_NOT_FOUND") {
      return sendRouteError(
        res,
        new HttpError(404, "Không tìm thấy thực tập sinh!"),
      );
    }
    if (result.outcome === "MENTOR_NOT_FOUND") {
      return sendRouteError(res, new HttpError(404, "Không tìm thấy mentor!"));
    }
    await notifyMentorAssignment({
      before,
      internId: Number(rawId),
      mentorId,
      mentorName: result.student.mentorName,
    });
    return res.json({
      message: "Cập nhật phân công mentor thành công!",
      student: result.student,
    });
  } catch (err) {
    return sendRouteError(res, err, "Lỗi cập nhật phân công mentor!");
  }
});

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
      return sendRouteError(
        res,
        new HttpError(
          400,
          "Vui lòng nhập đầy đủ Họ tên, Email và Trường đại học!",
        ),
      );
    }

    if (studentCode && (await db.isStudentCodeTaken(studentCode))) {
      return sendRouteError(
        res,
        new HttpError(400, "Mã sinh viên này đã tồn tại trong hệ thống!"),
      );
    }
    // Trùng email do ràng buộc UNIQUE(email) của DB báo lại (db.insertStudent).

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
    return sendRouteError(res, err, "Lỗi server khi thêm hồ sơ thực tập sinh!");
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
      return sendRouteError(
        res,
        new HttpError(
          400,
          "Vui lòng nhập đầy đủ Họ tên, Email và Trường đại học!",
        ),
      );
    }

    // Kiểm tra trùng Mã SV với các hồ sơ *khác* (loại trừ chính hồ sơ đang sửa).
    // Trùng email do ràng buộc UNIQUE(email) của DB báo lại (db.updateStudent).
    if (
      studentCode &&
      (await db.isStudentCodeTaken(studentCode, req.params.id))
    ) {
      return sendRouteError(
        res,
        new HttpError(400, "Mã sinh viên này đã thuộc về thực tập sinh khác!"),
      );
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
      return sendRouteError(
        res,
        new HttpError(404, "Không tìm thấy hồ sơ thực tập sinh cần cập nhật!"),
      );
    }

    res.json({
      message: "Cập nhật hồ sơ thực tập sinh thành công!",
      student: updated,
      intern: updated,
    });
  } catch (err) {
    return sendRouteError(
      res,
      err,
      "Lỗi server khi cập nhật hồ sơ thực tập sinh!",
    );
  }
}
router.put("/interns/:id", requireRole("Admin", "HR"), handleUpdateIntern);
router.put("/students/:id", requireRole("Admin", "HR"), handleUpdateIntern);

// DELETE /api/interns/:id & DELETE /api/students/:id
async function handleDeleteIntern(req, res) {
  try {
    const storedNames = await db.deleteStudent(req.params.id);
    contractsService.removeFiles(storedNames);
    res.json({ message: "Đã xóa hồ sơ thực tập sinh!" });
  } catch (err) {
    return sendRouteError(res, err, "Lỗi khi xóa hồ sơ thực tập sinh!");
  }
}
router.delete("/interns/:id", requireRole("Admin", "HR"), handleDeleteIntern);
router.delete("/students/:id", requireRole("Admin", "HR"), handleDeleteIntern);

module.exports = router;
