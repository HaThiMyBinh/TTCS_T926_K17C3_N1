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
const notificationsRouter = require("./routes/notifications.routes");
const attendanceReportRouter = require("./routes/attendanceReport.routes");

// Story 2.3: API phu cap thuc tap sinh.
const allowancesRouter = require("./routes/allowances.routes");

const {
  applicationEvents,
  REVIEWED_EVENT,
} = require("./services/applications.service");
const emailQueue = require("./services/email/emailQueue");
const { loadDemoIfNeeded } = require("./services/demoData");

// Email gui nen de loi SMTP khong lam hong thao tac duyet ho so.
applicationEvents.on(REVIEWED_EVENT, (payload) => {
  emailQueue.enqueueReviewEmail(payload).catch((err) => {
    console.error(
      "[EMAIL] Khong the xep hang gui email thong bao:",
      err.message
    );
  });
});

const app = express();
const FRONTEND_DIR = path.join(__dirname, "..", "Frontend");
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(FRONTEND_DIR));

// Khong cache du lieu bao cao ca nhan.
app.use("/api/final-reports", (req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});

app.use("/api/me/attendance", (req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});

// Story 2.3: khong cache lich su phu cap ca nhan.
app.use("/api/me/allowances", (req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});

app.use(apiAuthentication);
ensurePermissionsFile();

// Giu nguyen cac route hien co.
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
app.use("/api", notificationsRouter);
app.use("/api", attendanceReportRouter);

// Story 2.3: dang ky API phu cap.
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

// Xu ly loi JSON khong hop le va loi server chung.
app.use((err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    const message = "Du lieu gui len khong phai JSON hop le!";
    return res.status(400).json({
      success: false,
      message,
      error: message,
    });
  }

  console.error(err);
  const message = "Loi server!";
  return res.status(500).json({
    success: false,
    message,
    error: message,
  });
});

async function start() {
  try {
    await db.initDatabase();
  } catch (err) {
    console.error("[DATABASE] Khong the khoi tao MySQL:", err.message);
    console.error(
      "Vui long kiem tra backend/db_config.json va dam bao MySQL Server dang chay."
    );
    process.exit(1);
    return;
  }

  // Nap du lieu demo neu can.
  try {
    await loadDemoIfNeeded(db.getPool());
  } catch (err) {
    console.error("[DEMO] Khong nap duoc du lieu demo:", err.message);
  }

  // Dong bo mentor_id cho du lieu demo cu.
  try {
    await db.backfillInternMentorIds();
  } catch (err) {
    console.error(
      "[DATABASE] Khong the dong bo mentor_id cho du lieu demo:",
      err.message
    );
  }

  // Nap danh muc phong ban neu dang trong.
  try {
    await db.seedDepartmentsFromMentors();
  } catch (err) {
    console.error(
      "[DATABASE] Khong the nap danh muc phong ban:",
      err.message
    );
  }

  try {
    const resumed = await emailQueue.loadPendingJobsFromDb();

    if (resumed > 0) {
      console.log(
        "[EMAIL] Da nap lai " +
          resumed +
          " email dang do de tiep tuc xu ly."
      );
    }
  } catch (err) {
    console.error(
      "[EMAIL] Khong nap lai duoc cac email dang do:",
      err.message
    );
  }

  try {
    require("./services/reminders.service").start();
  } catch (err) {
    console.error(
      "[REMINDER] Khong khoi dong duoc nhac lich:",
      err.message
    );
  }

  app.listen(PORT, () => {
    console.log("====================================================");
    console.log(" He thong Quan Ly & Phan Quyen dang chay tai:");
    console.log(" Web App URL : http://localhost:" + PORT);
    console.log(" Backend API : http://127.0.0.1:" + PORT + "/api");
    console.log("====================================================");
  });
}

if (require.main === module) {
  start();
}

module.exports = app;
