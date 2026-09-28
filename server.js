const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const db = require("./db");
const {
  hashPassword,
  verifyPassword,
  generateToken,
  authenticateToken,
  requireRole,
} = require("./auth");

const app = express();
app.use(cors());
app.use(express.json());

// Phục vụ giao diện web tĩnh từ thư mục Frontend
const FRONTEND_DIR = path.join(__dirname, "..", "Frontend");
app.use(express.static(FRONTEND_DIR));

const PERMISSIONS_FILE = path.join(__dirname, "permissions.json");
const PORT = process.env.PORT || 5000;

// Bắt buộc xác thực JWT cho MỌI route /api/*
const PUBLIC_API_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/health",
];
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/") || PUBLIC_API_PATHS.includes(req.path)) {
    return next();
  }
  return authenticateToken(req, res, next);
});

// Khởi tạo file permissions.json mặc định nếu chưa tồn tại
if (!fs.existsSync(PERMISSIONS_FILE)) {
  const defaultPermissions = {
    Admin: [
      "MANAGE_USERS",
      "SYSTEM_SETTINGS",
    ],
    HR: ["MANAGE_USERS", "VIEW_REPORTS"],
    Mentor: ["ASSIGN_TASKS"],
    Intern: ["SUBMIT_WORK"],
  };
  writeJson(PERMISSIONS_FILE, defaultPermissions);
}

// Đọc / ghi file JSON an toàn (không throw khi file lỗi hoặc chưa tồn tại)
function readJson(filePath, defaultVal = []) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (e) {
    return defaultVal;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// Trim chuỗi an toàn: trả về "" nếu giá trị rỗng/undefined thay vì trim(undefined)
function trimOrDefault(value, fallback = "") {
  return value ? String(value).trim() : fallback;
}

// ============================================================================
//  TẠO & QUẢN LÝ TÀI KHOẢN (ADMIN & HR)
// ============================================================================

// API TẠO TÀI KHOẢN (POST /api/users) - chỉ vai trò có quyền MANAGE_USERS
app.post("/api/users", checkPermission("MANAGE_USERS"), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
      return res
        .status(400)
        .json({ error: "Vui lòng điền đầy đủ tất cả các trường!" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: "Mật khẩu phải từ 6 ký tự trở lên!" });
    }

    // Kiểm tra trùng email qua Database / JSON
    const existing = await db.findUserByEmail(email);
    if (existing) {
      return res
        .status(400)
        .json({ error: "Email này đã tồn tại trong hệ thống!" });
    }

    // Lưu vào MySQL & đồng bộ JSON qua db.insertUser
    const newUser = await db.insertUser({
      name: trimOrDefault(name),
      email: trimOrDefault(email).toLowerCase(),
      password_hash: await hashPassword(password),
      role: trimOrDefault(role),
      status: "ACTIVE",
    });

    res.status(201).json({
      message: "Tạo tài khoản thành công!",
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        status: newUser.status,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi server khi tạo tài khoản!" });
  }
});

// API LẤY DANH SÁCH TÀI KHOẢN (GET /api/users) - chỉ vai trò có quyền MANAGE_USERS
app.get("/api/users", checkPermission("MANAGE_USERS"), async (req, res) => {
  try {
    const users = await db.getAllUsers();
    // Ẩn mật khẩu hash khi trả về danh sách cho client
    const safeUsers = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role || "Intern",
      status: u.status || "ACTIVE",
      phone: u.phone || "",
      university: u.university || "",
      major: u.major || "",
      cvLink: u.cvLink || "",
      createdAt: u.createdAt || u.created_at,
    }));
    res.json(safeUsers);
  } catch (err) {
    res.status(500).json({ error: "Lỗi đọc danh sách tài khoản!" });
  }
});

// API XÓA TÀI KHOẢN (DELETE /api/users/:id) - chỉ vai trò có quyền MANAGE_USERS
app.delete(
  "/api/users/:id",
  checkPermission("MANAGE_USERS"),
  async (req, res) => {
    try {
      await db.deleteUser(req.params.id);
      res.json({ message: "Đã xóa tài khoản thành công!" });
    } catch (err) {
      res.status(500).json({ error: "Lỗi khi xóa tài khoản!" });
    }
  },
);

// API THỐNG KÊ DASHBOARD (GET /api/stats) - chỉ vai trò có quyền MANAGE_USERS
app.get("/api/stats", checkPermission("MANAGE_USERS"), async (req, res) => {
  try {
    const users = await db.getAllUsers();
    const stats = {
      totalUsers: users.length,
      adminCount: users.filter((u) => u.role === "Admin").length,
      hrCount: users.filter((u) => u.role === "HR").length,
      mentorCount: users.filter((u) => u.role === "Mentor").length,
      internCount: users.filter((u) => u.role === "Intern").length,
      candidatesCount: users.filter((u) => u.status === "PENDING").length,
    };
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: "Lỗi thống kê dữ liệu!" });
  }
});

// ============================================================================
//  PHÂN QUYỀN CHI TIẾT & MIDDLEWARE RBAC
// ============================================================================

function checkPermission(requiredPermission) {
  return (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ error: "Chưa xác thực (thiếu hoặc sai token đăng nhập)!" });
    }
    const userRole = req.user.role;

    const permissions = readJson(PERMISSIONS_FILE, {});
    const rolePermissions = permissions[userRole] || [];

    if (!rolePermissions.includes(requiredPermission)) {
      return res.status(403).json({
        error: `Từ chối truy cập: Vai trò [${userRole}] không có quyền [${requiredPermission}]!`,
        requiredPermission,
        userRole,
      });
    }

    next();
  };
}

app.get("/api/permissions", (req, res) => {
  try {
    const permissions = readJson(PERMISSIONS_FILE, {});
    if (!permissions.HR) permissions.HR = ["VIEW_REPORTS"];
    if (!permissions.Mentor) permissions.Mentor = ["ASSIGN_TASKS"];
    if (!permissions.Intern) permissions.Intern = [];
    res.json(permissions);
  } catch (err) {
    res.status(500).json({ error: "Lỗi đọc ma trận quyền!" });
  }
});

app.post("/api/permissions/update", requireRole("Admin"), (req, res) => {
  try {
    const { role, permissions } = req.body;
    if (!role || !Array.isArray(permissions)) {
      return res
        .status(400)
        .json({ error: "Dữ liệu cập nhật quyền không hợp lệ!" });
    }

    const allPermissions = readJson(PERMISSIONS_FILE, {});
    allPermissions[role] = permissions;
    writeJson(PERMISSIONS_FILE, allPermissions);

    res.json({
      message: `Cập nhật quyền cho vai trò [${role}] thành công!`,
      permissions: allPermissions,
    });
  } catch (err) {
    res.status(500).json({ error: "Lỗi lưu cấu hình quyền!" });
  }
});

// CÁC ROUTE ĐƯỢC BẢO VỆ BỞI MIDDLEWARE PHÂN QUYỀN
app.get("/api/reports", checkPermission("VIEW_REPORTS"), (req, res) => {
  res.json({
    message: "Dữ liệu báo cáo thống kê đào tạo mật!",
    data: [
      { month: "Tháng 1", interns: 12, completed: 10 },
      { month: "Tháng 2", interns: 15, completed: 14 },
      { month: "Tháng 3", interns: 20, completed: 18 },
    ],
  });
});

app.get("/api/tasks", checkPermission("ASSIGN_TASKS"), (req, res) => {
  res.json({
    message: "Danh sách nhiệm vụ đào tạo thực tập sinh",
    tasks: [
      {
        id: 1,
        title: "Tìm hiểu kiến trúc MVC",
        deadline: "2026-10-01",
        status: "In Progress",
      },
      {
        id: 2,
        title: "Xây dựng RESTful API",
        deadline: "2026-10-05",
        status: "Todo",
      },
    ],
  });
});

app.get("/api/submissions", checkPermission("SUBMIT_WORK"), (req, res) => {
  res.json({
    message: "Danh sách báo cáo công việc của thực tập sinh",
    submissions: [
      {
        id: 101,
        title: "Báo cáo tuần 1: Tổng quan dự án",
        date: "2026-09-20",
        status: "Đã nộp",
      },
    ],
  });
});

app.get("/api/settings", checkPermission("SYSTEM_SETTINGS"), (req, res) => {
  res.json({
    message: "Cài đặt tham số hệ thống nội bộ",
    settings: { allowPublicRegistration: true, maxInternPerMentor: 5 },
  });
});

// ============================================================================
// XÁC THỰC: ĐĂNG NHẬP & ĐĂNG KÝ ỨNG TUYỂN
// ============================================================================

// API ĐĂNG NHẬP HỆ THỐNG (POST /api/auth/login)
// API KIỂM TRA "SỨC KHỎE" SERVER (dùng cho run.bat / công cụ giám sát)
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", time: new Date().toISOString() });
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { account, email, password } = req.body;
    const loginUser = trimOrDefault(account || email);

    if (!loginUser || !password) {
      return res.status(400).json({
        error: "Vui lòng nhập đầy đủ mã tài khoản/email và mật khẩu!",
      });
    }

    const user = await db.findUserForLogin(loginUser);
    const passwordOk =
      user && (await verifyPassword(password, user.password_hash));

    if (!user || !passwordOk) {
      return res
        .status(401)
        .json({ error: "Mã tài khoản hoặc mật khẩu không chính xác!" });
    }

    if (user.status === "LOCKED") {
      return res.status(403).json({
        error: "Tài khoản của bạn đã bị khóa! Vui lòng liên hệ Admin.",
      });
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role || "Intern",
    });

    res.json({
      message: "Đăng nhập thành công!",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role || "Intern",
        status: user.status || "ACTIVE",
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi server khi xử lý đăng nhập!" });
  }
});

// API ĐĂNG KÝ HỒ SƠ THỰC TẬP SINH (POST /api/auth/register)
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, phone, university, major, cvLink } =
      req.body;

    // Validate dữ liệu bắt buộc
    if (!name || !email || !password || !phone || !university) {
      return res
        .status(400)
        .json({ error: "Vui lòng điền đầy đủ các thông tin bắt buộc (*)" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: "Mật khẩu phải từ 6 ký tự trở lên!" });
    }

    // Kiểm tra trùng email trong Database MySQL / JSON
    const existing = await db.findUserByEmail(email);
    if (existing) {
      return res.status(400).json({
        error: "Email này đã được sử dụng! Vui lòng nhập email khác.",
      });
    }

    // Lưu hồ sơ ứng tuyển vào MySQL & JSON
    const newCandidate = await db.insertCandidate({
      name: trimOrDefault(name),
      email: trimOrDefault(email).toLowerCase(),
      phone: trimOrDefault(phone),
      university: trimOrDefault(university),
      major: trimOrDefault(major, "Chưa cập nhật"),
      cvLink: trimOrDefault(cvLink),
      password_hash: await hashPassword(password),
      status: "Chờ duyệt",
    });

    res.status(201).json({
      message:
        "Nộp hồ sơ ứng tuyển thành công! Nhà tuyển dụng sẽ sớm liên hệ với bạn.",
      candidate: {
        id: newCandidate.id,
        name: newCandidate.name,
        email: newCandidate.email,
        status: newCandidate.status,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi server xử lý hồ sơ ứng tuyển!" });
  }
});

// ============================================================================
// QUẢN LÝ HỒ SƠ ỨNG TUYỂN (CANDIDATES) & MENTOR
// ============================================================================

// API LẤY DANH SÁCH HỒ SƠ ỨNG TUYỂN (Dành cho HR/Admin)
app.get("/api/candidates", async (req, res) => {
  // Vai trò lấy từ JWT đã xác thực (req.user), không còn tin vào header client tự gửi
  const role = req.user.role;
  if (role === "Intern") {
    return res
      .status(403)
      .json({ error: "Thực tập sinh không có quyền xem hồ sơ ứng tuyển!" });
  }
  try {
    const candidates = await db.getAllCandidates();
    res.json(candidates);
  } catch (err) {
    res.status(500).json({ error: "Lỗi đọc danh sách ứng viên!" });
  }
});

// API DUYỆT / CẬP NHẬT TRẠNG THÁI HỒ SƠ
app.put("/api/candidates/:id/status", async (req, res) => {
  // Vai trò lấy từ JWT đã xác thực (req.user), không còn tin vào header client tự gửi
  const role = req.user.role;
  if (role === "Intern") {
    return res
      .status(403)
      .json({ error: "Thực tập sinh không có quyền duyệt hồ sơ!" });
  }
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    const user = await db.updateCandidateStatus(id, status);
    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy hồ sơ ứng viên!" });
    }
    res.json({
      message: `Cập nhật trạng thái thành [${status}] thành công!`,
      candidate: user,
    });
  } catch (err) {
    res.status(500).json({ error: "Lỗi cập nhật trạng thái hồ sơ!" });
  }
});

// API LẤY DANH SÁCH MENTOR (GET /api/mentors) - mọi vai trò trừ Intern
app.get(
  "/api/mentors",
  requireRole("Admin", "HR", "Mentor"),
  async (req, res) => {
    try {
      const mentors = await db.getAllMentors();
      res.json(mentors);
    } catch (err) {
      res.status(500).json({ error: "Lỗi đọc danh sách mentor!" });
    }
  },
);

// API THÊM MỚI MENTOR (POST /api/mentors) - HR thêm mentor để phân công cho thực tập sinh
app.post("/api/mentors", requireRole("Admin", "HR"), async (req, res) => {
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
    console.error(err);
    res.status(500).json({ error: "Lỗi server khi thêm mentor!" });
  }
});

// API CHỈNH SỬA THÔNG TIN MENTOR (PUT /api/mentors/:id)
app.put("/api/mentors/:id", requireRole("Admin", "HR"), async (req, res) => {
  try {
    const { fullName, email, phone, department, specialization } = req.body;
    if (!fullName || !email || !department) {
      return res
        .status(400)
        .json({ error: "Vui lòng nhập đầy đủ Họ tên, Email và Phòng ban!" });
    }
    const updated = await db.updateMentor(req.params.id, {
      fullName,
      email,
      phone,
      department,
      specialization,
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
    res.status(500).json({ error: "Lỗi server khi cập nhật mentor!" });
  }
});

// API XÓA MENTOR (DELETE /api/mentors/:id)
app.delete("/api/mentors/:id", requireRole("Admin", "HR"), async (req, res) => {
  try {
    await db.deleteMentor(req.params.id);
    res.json({ message: "Đã xóa mentor khỏi hệ thống!" });
  } catch (err) {
    res.status(500).json({ error: "Lỗi khi xóa mentor!" });
  }
});

// ============================================================================
// : QUẢN LÝ HỒ SƠ THỰC TẬP SINH (INTERNS / STUDENTS)
// ============================================================================

// LẤY DANH SÁCH HỒ SƠ THỰC TẬP SINH (GET /api/interns & GET /api/students)
async function handleGetInterns(req, res) {
  try {
    const students = await db.getAllStudents();
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: "Lỗi đọc danh sách hồ sơ thực tập sinh!" });
  }
}
app.get("/api/interns", requireRole("Admin", "HR", "Mentor"), handleGetInterns);
app.get(
  "/api/students",
  requireRole("Admin", "HR", "Mentor"),
  handleGetInterns,
);

// THÊM MỚI HỒ SƠ THỰC TẬP SINH (POST /api/interns & POST /api/students)
// Lưu hồ sơ & kiểm tra trùng lặp (Mã SV / Email)
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

    // 1. Kiểm tra trùng Mã SV (nếu có cung cấp)
    if (studentCode && isDuplicateStudentCode(students, studentCode)) {
      return res
        .status(400)
        .json({ error: "Mã sinh viên này đã tồn tại trong hệ thống!" });
    }

    // 2. Kiểm tra trùng Email
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
    console.error(err);
    res.status(500).json({ error: "Lỗi server khi thêm hồ sơ thực tập sinh!" });
  }
}
app.post("/api/interns", requireRole("Admin", "HR"), handleCreateIntern);
app.post("/api/students", requireRole("Admin", "HR"), handleCreateIntern);

// CHỈNH SỬA HỒ SƠ THỰC TẬP SINH (PUT /api/interns/:id & PUT /api/students/:id)
// Cập nhật thông tin hồ sơ trong Database
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

    if (email && isDuplicateStudentEmail(students, email, currentId)) {
      return res
        .status(400)
        .json({ error: "Email này đã thuộc về thực tập sinh khác!" });
    }

    const updated = await db.updateStudent(req.params.id, {
      studentCode,
      fullName,
      email,
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
    res
      .status(500)
      .json({ error: "Lỗi server khi cập nhật hồ sơ thực tập sinh!" });
  }
}
app.put("/api/interns/:id", requireRole("Admin", "HR"), handleUpdateIntern);
app.put("/api/students/:id", requireRole("Admin", "HR"), handleUpdateIntern);

// XÓA HỒ SƠ THỰC TẬP SINH (DELETE /api/interns/:id & DELETE /api/students/:id)
async function handleDeleteIntern(req, res) {
  try {
    await db.deleteStudent(req.params.id);
    res.json({ message: "Đã xóa hồ sơ thực tập sinh!" });
  } catch (err) {
    res.status(500).json({ error: "Lỗi khi xóa hồ sơ thực tập sinh!" });
  }
}
app.delete("/api/interns/:id", requireRole("Admin", "HR"), handleDeleteIntern);
app.delete("/api/students/:id", requireRole("Admin", "HR"), handleDeleteIntern);

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

// ============================================================================
// ĐIỀU HƯỚNG TRANG WEB TĨNH
// ============================================================================

app.get("/login", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "login.html"));
});

app.get("/register", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "register.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "login.html"));
});

// ============================================================================
// KHỞI ĐỘNG SERVER
// ============================================================================

(async () => {
  try {
    await db.initDatabase();
  } catch (err) {
    console.error("[DATABASE] Không thể khởi tạo MySQL:", err.message);
    console.error(
      "Vui lòng kiểm tra backend/db_config.json và đảm bảo MySQL Server đang chạy.",
    );
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` Hệ thống Quản Lý & Phân Quyền đang chạy tại:`);
    console.log(` Web App URL : http://localhost:${PORT}`);
    console.log(` Backend API : http://127.0.0.1:${PORT}/api`);
    console.log(`====================================================`);
  });
})();
