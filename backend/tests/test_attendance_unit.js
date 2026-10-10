function check(name, condition) {
  if (!condition) {
    console.error(`[FAIL] ${name}`);
    process.exitCode = 1;
  } else console.log(`[PASS] ${name}`);
}
const s = require("../services/attendance.service");
check(
  "check-in body accepts note",
  s.validateCheckInBody({ note: " ca sáng " }) === "ca sáng",
);
check(
  "check-in rejects unexpected fields",
  (() => {
    try {
      s.validateCheckInBody({ intern_id: 2 });
      return false;
    } catch (e) {
      return e.status === 400;
    }
  })(),
);
check(
  "check-in rejects long note",
  (() => {
    try {
      s.validateCheckInBody({ note: "x".repeat(256) });
      return false;
    } catch (e) {
      return e.status === 400;
    }
  })(),
);
check(
  "empty check-out body accepted",
  (() => {
    try {
      s.validateEmptyBody({});
      return true;
    } catch {
      return false;
    }
  })(),
);
check(
  "check-out rejects client time",
  (() => {
    try {
      s.validateEmptyBody({ check_out_at: "x" });
      return false;
    } catch (e) {
      return e.status === 400;
    }
  })(),
);
check(
  "history validates days and maximum range",
  (() => {
    try {
      s.validateHistoryQuery({ from: "2026-01-01", to: "2026-01-02" });
      return true;
    } catch {
      return false;
    }
  })(),
);
check(
  "history rejects reversed dates",
  (() => {
    try {
      s.validateHistoryQuery({ from: "2026-02-01", to: "2026-01-01" });
      return false;
    } catch (e) {
      return e.status === 400;
    }
  })(),
);
check(
  "duration counts elapsed minutes",
  s.durationMinutes(
    "2026-01-01T09:00:00+07:00",
    "2026-01-01T17:45:00+07:00",
  ) === 525,
);
check(
  "missing checkout is never counted",
  s.durationMinutes("2026-01-01T09:00:00+07:00", null) === null,
);
check(
  "yesterday open record is missing checkout",
  s.classifyStatus(
    { workDate: "2026-10-08", checkOutAt: null },
    "2026-10-09",
  ) === "MISSING_CHECKOUT",
);
check(
  "overnight open record within 16h is still working",
  s.classifyStatus(
    {
      workDate: "2026-10-08",
      checkInAt: "2026-10-08 22:00:00",
      checkOutAt: null,
    },
    "2026-10-09",
    s.parseSqlDateTime("2026-10-09 00:30:00"),
  ) === "WORKING",
);
check(
  "open record older than 16h is missing checkout",
  s.classifyStatus(
    {
      workDate: "2026-10-08",
      checkInAt: "2026-10-08 09:00:00",
      checkOutAt: null,
    },
    "2026-10-09",
    s.parseSqlDateTime("2026-10-09 09:00:00"),
  ) === "MISSING_CHECKOUT",
);
check(
  "correction body parses datetime and reason",
  (() => {
    const r = s.validateCorrectionBody({
      check_out_at: "2026-10-08T17:30",
      reason: " quên ",
    });
    return r.checkOutAt === "2026-10-08 17:30:00" && r.reason === "quên";
  })(),
);
check(
  "correction rejects bad datetime",
  (() => {
    try {
      s.validateCorrectionBody({
        check_out_at: "2026-13-40 25:00",
        reason: "x",
      });
      return false;
    } catch (e) {
      return e.status === 400;
    }
  })(),
);
check(
  "correction requires reason",
  (() => {
    try {
      s.validateCorrectionBody({
        check_out_at: "2026-10-08 17:30",
        reason: " ",
      });
      return false;
    } catch (e) {
      return e.status === 400;
    }
  })(),
);
check(
  "correction rejects unknown fields",
  (() => {
    try {
      s.validateCorrectionBody({
        check_out_at: "2026-10-08 17:30",
        reason: "x",
        intern_id: 1,
      });
      return false;
    } catch (e) {
      return e.status === 400;
    }
  })(),
);
check(
  "recent missing checkout can request correction",
  s.formatRow(
    {
      workDate: "2026-10-08",
      checkInAt: "2026-10-08 09:00:00",
      checkOutAt: null,
    },
    "2026-10-09",
    s.parseSqlDateTime("2026-10-09 09:00:00"),
  ).canRequestCorrection === true,
);
check(
  "pending correction cannot be requested again",
  s.formatRow(
    {
      workDate: "2026-10-08",
      checkInAt: "2026-10-08 09:00:00",
      checkOutAt: null,
      correctionStatus: "PENDING",
    },
    "2026-10-09",
    s.parseSqlDateTime("2026-10-09 09:00:00"),
  ).canRequestCorrection === false,
);
console.log("[PASS] attendance unit checks");
