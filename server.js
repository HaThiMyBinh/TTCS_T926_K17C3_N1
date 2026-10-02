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
const {
  applicationEvents,
  REVIEWED_EVENT,
} = require("./services/applications.service");
const emailQueue = require("./services/email/emailQueue");

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

  try {
    const resumed = await emailQueue.loadPendingJobsFromDb();
    if (resumed > 0) {
      console.log(
        `[EMAIL] Đã nạp lại ${resumed} email đang dang dở để tiếp tục xử lý.`,
      );
    }
  } catch (err) {
    console.error(
      "[EMAIL] Không nạp lại được các email dang dở:",
      err.message,
    );
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
