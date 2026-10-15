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
const workSchedulesRouter = require("./routes/workSchedules.routes");
const leavesRouter = require("./routes/leaves.routes");
const supportRequestsRouter = require("./routes/supportRequests.routes");
const notificationsRouter = require("./routes/notifications.routes");
const attendanceReportRouter = require("./routes/attendanceReport.routes");
const allowancesRouter = require("./routes/allowances.routes");
const {
  applicationEvents,
  REVIEWED_EVENT,
} = require("./services/applications.service");
const emailQueue = require("./services/email/emailQueue");
const { loadDemoIfNeeded } = require("./services/demoData");

// Email gá»­i ná»n Ä‘á»ƒ lá»—i SMTP khÃ´ng lÃ m há»ng thao tÃ¡c duyá»‡t há»“ sÆ¡.
applicationEvents.on(REVIEWED_EVENT, (payload) => {
  emailQueue.enqueueReviewEmail(payload).catch((err) => {
    console.error(
      "[EMAIL] KhÃ´ng thá»ƒ xáº¿p hÃ ng gá»­i email thÃ´ng bÃ¡o:",
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

// Giá»¯ nguyÃªn thá»© tá»± Ä‘Äƒng kÃ½ cÃ¡c route hiá»‡n cÃ³.
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
app.use("/api", workSchedulesRouter);
app.use("/api", leavesRouter);
app.use("/api", supportRequestsRouter);
app.use("/api", notificationsRouter);
app.use("/api", attendanceReportRouter);
app.use("/api", allowancesRouter);

app.get("/login", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "login.html"));
});

app.get("/register", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "register.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "login.html"));
});

// JSON khÃ´ng há»£p lá»‡ tráº£ vá» 400; cÃ¡c lá»—i khÃ¡c dÃ¹ng pháº£n há»“i server chung.
app.use((err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    const message = "Dá»¯ liá»‡u gá»­i lÃªn khÃ´ng pháº£i JSON há»£p lá»‡!";
    return res.status(400).json({ success: false, message, error: message });
  }

  console.error(err);
  const message = "Lá»—i server!";
  res.status(500).json({ success: false, message, error: message });
});

async function start() {
  try {
    await db.initDatabase();
  } catch (err) {
    console.error("[DATABASE] KhÃ´ng thá»ƒ khá»Ÿi táº¡o MySQL:", err.message);
    console.error(
      "Vui lÃ²ng kiá»ƒm tra backend/db_config.json vÃ  Ä‘áº£m báº£o MySQL Server Ä‘ang cháº¡y.",
    );
    process.exit(1);
  }

  // Náº¿u cÃ³ thÆ° má»¥c demo/ (gÃ³i dá»¯ liá»‡u + file máº«u) thÃ¬ tá»± náº¡p 1 láº§n; lá»—i khÃ´ng lÃ m sáº­p server.
  try {
    await loadDemoIfNeeded(db.getPool());
  } catch (err) {
    console.error("[DEMO] KhÃ´ng náº¡p Ä‘Æ°á»£c dá»¯ liá»‡u demo:", err.message);
  }

  // Báº£n demo cÅ© cÃ³ thá»ƒ chá»‰ lÆ°u mentor_name; sau khi náº¡p, ná»‘i tÃªn duy nháº¥t sang mentor_id.
  try {
    await db.backfillInternMentorIds();
  } catch (err) {
    console.error(
      "[DATABASE] KhÃ´ng thá»ƒ Ä‘á»“ng bá»™ mentor_id cho dá»¯ liá»‡u demo:",
      err.message,
    );
  }

  // GÃ³i demo cÅ© khÃ´ng cÃ³ departments; náº¡p láº¡i danh má»¥c tá»« mentors náº¿u Ä‘ang trá»‘ng.
  try {
    await db.seedDepartmentsFromMentors();
  } catch (err) {
    console.error("[DATABASE] KhÃ´ng thá»ƒ náº¡p danh má»¥c phÃ²ng ban:", err.message);
  }

  try {
    const resumed = await emailQueue.loadPendingJobsFromDb();
    if (resumed > 0) {
      console.log(
        `[EMAIL] ÄÃ£ náº¡p láº¡i ${resumed} email Ä‘ang dang dá»Ÿ Ä‘á»ƒ tiáº¿p tá»¥c xá»­ lÃ½.`,
      );
    }
  } catch (err) {
    console.error("[EMAIL] KhÃ´ng náº¡p láº¡i Ä‘Æ°á»£c cÃ¡c email dang dá»Ÿ:", err.message);
  }

  try {
    require("./services/reminders.service").start();
  } catch (err) {
    console.error("[REMINDER] KhÃ´ng khá»Ÿi Ä‘á»™ng Ä‘Æ°á»£c nháº¯c lá»‹ch:", err.message);
  }

  app.listen(PORT, () => {
    console.log("====================================================");
    console.log(" Há»‡ thá»‘ng Quáº£n LÃ½ & PhÃ¢n Quyá»n Ä‘ang cháº¡y táº¡i:");
    console.log(` Web App URL : http://localhost:${PORT}`);
    console.log(` Backend API : http://127.0.0.1:${PORT}/api`);
    console.log("====================================================");
  });
}

if (require.main === module) {
  start();
}

module.exports = app;

