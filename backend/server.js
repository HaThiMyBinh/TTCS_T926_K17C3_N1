const express = require("express");
const cors = require("cors");
const path = require("path");
const db = require("./db");
const apiAuthentication = require("./middleware/apiAuthentication");
const { ensurePermissionsFile } = require("./middleware/permissions");
const applicationsRouter = require("./routes/applications.routes");
const emailRouter = require("./routes/email.routes");
const usersRouter = require("./routes/users.routes");
const permissionsRouter = require("./routes/permissions.routes");
const authRouter = require("./routes/auth.routes");
const mentorsRouter = require("./routes/mentors.routes");
const internsRouter = require("./routes/interns.routes");
const contractsRouter = require("./routes/contracts.routes");
const programsRouter = require("./routes/programs.routes");
const scheduleRouter = require("./routes/schedule.routes");
const tasksRouter = require("./routes/tasks.routes");
const weeklyReportsRouter = require("./routes/weeklyReports.routes");
const evaluationsRouter = require("./routes/evaluations.routes");
const attendanceRouter = require("./routes/attendance.routes");
const finalReportsRouter = require("./routes/finalReports.routes");
const {
  applicationEvents,
  REVIEWED_EVENT,
} = require("./services/applications.service");
const emailQueue = require("./services/email/emailQueue");
const { loadDemoIfNeeded } = require("./services/demoData");

// Email gửi nền để lỗi SMTP không làm hỏng thao tác duyệt hồ sơ.
applicationEvents.on(REVIEWED_EVENT, (payload) => {
  emailQueue.enqueueReviewEmail(payload).catch((err) => {
    console.error(
      "[EMAIL] Không thể xếp hàng gửi email thông báo:",
      err.message,
    );
  });
});

const app = express();
const FRONTEND_DIR = path.join(__dirname, "..", "Frontend");
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(FRONTEND_DIR));
app.use("/api/final-reports", (req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
app.use("/api/me/attendance", (req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
app.use(apiAuthentication);
ensurePermissionsFile();

// Giữ nguyên thứ tự đăng ký các route hiện có.
app.use("/api", usersRouter);
app.use("/api", permissionsRouter);
app.use("/api", authRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/email", emailRouter);
app.use("/api", mentorsRouter);
app.use("/api", internsRouter);
app.use("/api", contractsRouter);
app.use("/api", programsRouter);
app.use("/api", scheduleRouter);
app.use("/api", tasksRouter);
app.use("/api", weeklyReportsRouter);
app.use("/api", evaluationsRouter);
app.use("/api", attendanceRouter);
app.use("/api", finalReportsRouter);

app.get("/login", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "login.html"));
});

app.get("/register", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "register.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "login.html"));
});

// JSON không hợp lệ trả về 400; các lỗi khác dùng phản hồi server chung.
app.use((err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    const message = "Dữ liệu gửi lên không phải JSON hợp lệ!";
    return res.status(400).json({ success: false, message, error: message });
  }

  console.error(err);
  const message = "Lỗi server!";
  res.status(500).json({ success: false, message, error: message });
});

async function start() {
  try {
    await db.initDatabase();
  } catch (err) {
    console.error("[DATABASE] Không thể khởi tạo MySQL:", err.message);
    console.error(
      "Vui lòng kiểm tra backend/db_config.json và đảm bảo MySQL Server đang chạy.",
    );
    process.exit(1);
  }

  // Nếu có thư mục demo/ (gói dữ liệu + file mẫu) thì tự nạp 1 lần; lỗi không làm sập server.
  try {
    await loadDemoIfNeeded(db.getPool());
  } catch (err) {
    console.error("[DEMO] Không nạp được dữ liệu demo:", err.message);
  }

  // Bản demo cũ có thể chỉ lưu mentor_name; sau khi nạp, nối tên duy nhất sang mentor_id.
  try {
    await db.backfillInternMentorIds();
  } catch (err) {
    console.error(
      "[DATABASE] Không thể đồng bộ mentor_id cho dữ liệu demo:",
      err.message,
    );
  }

  // Gói demo cũ không có departments; nạp lại danh mục từ mentors nếu đang trống.
  try {
    await db.seedDepartmentsFromMentors();
  } catch (err) {
    console.error("[DATABASE] Không thể nạp danh mục phòng ban:", err.message);
  }

  try {
    const resumed = await emailQueue.loadPendingJobsFromDb();
    if (resumed > 0) {
      console.log(
        `[EMAIL] Đã nạp lại ${resumed} email đang dang dở để tiếp tục xử lý.`,
      );
    }
  } catch (err) {
    console.error("[EMAIL] Không nạp lại được các email dang dở:", err.message);
  }

  app.listen(PORT, () => {
    console.log("====================================================");
    console.log(" Hệ thống Quản Lý & Phân Quyền đang chạy tại:");
    console.log(` Web App URL : http://localhost:${PORT}`);
    console.log(` Backend API : http://127.0.0.1:${PORT}/api`);
    console.log("====================================================");
  });
}

if (require.main === module) {
  start();
}

module.exports = app;
