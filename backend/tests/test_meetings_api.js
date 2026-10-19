// needsServer, explicit write opt-in. Only creates/removes this run's fixtures in a dedicated DB.
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { SMTPServer } = require("smtp-server");
const { BASE_URL, readDbConfig, loginAs } = require("./test_helpers");
const { hashPassword } = require("../auth");
const { toSql } = require("../services/meetingRules.service");
const { migrateMeetings } = require("../migrations/meetingsMigration");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, label, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  throw new Error("Timeout: " + label);
}
function subject(raw) {
  const h =
    /^Subject: (.*)$/im.exec(raw.replace(/\r\n[ \t]+/g, " "))?.[1] || "";
  return h
    .replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, s) =>
      Buffer.from(s, "base64").toString("utf8"),
    )
    .replace(/=\?UTF-8\?Q\?([^?]+)\?=/gi, (_, s) =>
      Buffer.from(
        s
          .replace(/_/g, " ")
          .replace(/=([\dA-F]{2})/gi, (_, h) =>
            String.fromCharCode(parseInt(h, 16)),
          ),
        "binary",
      ).toString("utf8"),
    );
}
function readable(raw) {
  let result =
    raw +
    "\n" +
    raw
      .replace(/=\r\n/g, "")
      .replace(/=([\dA-F]{2})/gi, (_, h) =>
        String.fromCharCode(parseInt(h, 16)),
      );
  for (const part of raw.split(/\r\n--[^\r\n]+\r\n/)) {
    if (/Content-Transfer-Encoding: base64/i.test(part)) {
      const data = part
        .split("\r\n\r\n")
        .slice(1)
        .join("\r\n\r\n")
        .split(/\r\n--/)[0];
      try {
        result +=
          "\n" +
          Buffer.from(data.replace(/\s/g, ""), "base64").toString("utf8");
      } catch {}
    }
  }
  return result;
}
async function main() {
  const cfg = readDbConfig();
  if (
    process.env.US8_TEST_DB_ALLOW_WRITES !== "1" ||
    !/^us[678]_test_[a-zA-Z0-9_]+$/.test(cfg.database)
  )
    throw new Error(
      "Requires US8_TEST_DB_ALLOW_WRITES=1 and us6_test_/us7_test_/us8_test_ DB. Never run on user data.",
    );
  const conn = await mysql.createConnection(cfg),
    prefix = "us8_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
  const meetingIds = new Set(),
    profileIds = [],
    emails = [],
    mentorIds = [];
  let secondary = null;
  let failCode = 0,
    delay = 0;
  const accepted = [],
    attempted = [];
  const smtp = new SMTPServer({
    secure: false,
    disabledCommands: ["STARTTLS"],
    authOptional: false,
    onAuth: (auth, session, cb) => cb(null, { user: "test" }),
    onData: (stream, session, cb) => {
      let raw = "";
      stream.on("data", (b) => (raw += b.toString()));
      stream.on("end", () => {
        attempted.push(raw);
        const code = failCode;
        failCode = 0;
        setTimeout(() => {
          if (code) {
            const e = new Error("Simulated SMTP rejection");
            e.responseCode = code;
            cb(e);
          } else {
            accepted.push(raw);
            cb(null);
          }
        }, delay);
      });
    },
  });
  const call = async (method, url, body, token) => {
    const res = await fetch(BASE_URL + url, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      body: await res.json().catch(() => ({})),
      headers: res.headers,
    };
  };
  const ok = (response, status) => {
    assert.equal(response.status, status, JSON.stringify(response.body));
    return response.body.data;
  };
  let admin, hr, mentor;
  const create = async (body, token = mentor) => {
    const r = await call("POST", "/meetings", body, token);
    if (r.body.data?.id) meetingIds.add(Number(r.body.data.id));
    return r;
  };
  const logs = async (id) => {
    const [rows] = await conn.query(
      "SELECT id,email_type AS emailType,status,attempts,recipient_email AS email,subject,payload_json AS payload FROM email_logs WHERE meeting_id=? ORDER BY id",
      [id],
    );
    return rows;
  };
  const body = (ids, patch = {}) => ({
    title: `${prefix} O'Brien <>&`,
    description: "Trao đổi tiếng Việt",
    start_at: toSql(new Date(Date.now() + 26 * 3600000)).replace(" ", "T"),
    end_at: toSql(new Date(Date.now() + 27 * 3600000)).replace(" ", "T"),
    location: "Phòng A",
    meeting_link: "https://example.test/hop?a=1&b=2",
    attendee_ids: ids,
    ...patch,
  });
  let smtpConfig;
  try {
    await new Promise((resolve) => smtp.listen(0, "127.0.0.1", resolve));
    [admin, hr, mentor] = await Promise.all([
      loginAs("Admin"),
      loginAs("HR"),
      loginAs("Mentor"),
    ]);
    const [[ownMentor]] = await conn.query(
      "SELECT id FROM mentors WHERE email=?",
      ["mentor@gmail.com"],
    );
    assert.ok(ownMentor);
    const [roleRows] = await conn.query(
      "SELECT id,role_name FROM roles WHERE role_name IN ('Intern','Mentor')",
    );
    const roles = Object.fromEntries(roleRows.map((r) => [r.role_name, r.id]));
    const hash = await hashPassword("password123");
    const foreignEmail = prefix + "_mentor@example.test";
    emails.push(foreignEmail);
    await conn.query(
      "INSERT INTO users(name,email,password_hash,role_id,status) VALUES(?,?,?,?,'ACTIVE')",
      ["Mentor Test", foreignEmail, hash, roles.Mentor],
    );
    const [mr] = await conn.query(
      "INSERT INTO mentors(full_name,email) VALUES(?,?)",
      ["Mentor Test", foreignEmail],
    );
    mentorIds.push(mr.insertId);
    async function intern(label, mentorId, valid = true) {
      const email = valid
        ? `${prefix}_${label}@example.test`
        : `${prefix}_${label}_invalid`;
      emails.push(email);
      const [r] = await conn.query(
        "INSERT INTO intern_profiles(full_name,email,university,major,mentor_id,status) VALUES(?,?,?,?,?,?)",
        [
          label + " O'Brien <>&",
          email,
          "Đại học Y",
          "CNTT",
          mentorId,
          "Đang thực tập",
        ],
      );
      profileIds.push(r.insertId);
      if (valid)
        await conn.query(
          "INSERT INTO users(name,email,password_hash,role_id,status) VALUES(?,?,?,?,'ACTIVE')",
          [label, email, hash, roles.Intern],
        );
      return { id: r.insertId, email };
    }
    const a = await intern("A", ownMentor.id),
      b = await intern("B", ownMentor.id),
      c = await intern("C", mr.insertId),
      invalid = await intern("D", ownMentor.id, false);
    const login = async (email) => {
      const r = await call("POST", "/auth/login", {
        account: email,
        password: "password123",
      });
      assert.equal(r.status, 200);
      return r.body.token;
    };
    const internA = await login(a.email),
      internC = await login(c.email),
      otherMentor = await login(foreignEmail);
    ok(await call("GET", "/meetings"), 401);
    ok(await call("GET", "/meetings", undefined, admin), 403);
    ok(await call("GET", "/meetings", undefined, internA), 403);
    ok(await call("GET", "/me/meetings", undefined, hr), 403);
    ok(await create(body([a.id]), admin), 403);
    ok(await create(body([a.id]), internA), 403);
    for (const query of [
      "?foo=x",
      "?status=Foo",
      "?page=0",
      "?from=2026-02-30",
      "?q=a&q=b",
    ])
      ok(await call("GET", "/meetings" + query, undefined, hr), 400);
    const input = body([a.id, invalid.id], { request_key: prefix + "_create" });
    const response = await create(input),
      m = ok(response, 201),
      id = m.id;
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    await waitFor(async () => {
      const rows = await logs(id);
      return rows.length === 2 && rows.every((r) => r.status === "FAILED");
    }, "missing SMTP fails email only");
    assert.equal(m.meeting.startAt, input.start_at.replace("T", " "));
    const duplicates = await Promise.all([create(input), create(input)]);
    duplicates.forEach((r) => assert.equal(ok(r, 201).id, id));
    assert.equal((await logs(id)).length, 2);
    ok(await create(body([c.id])), 403);
    ok(await create(body([a.id, 999999999])), 400);
    assert.equal(
      (
        await conn.query(
          "SELECT COUNT(*) AS n FROM meetings WHERE title LIKE ?",
          [prefix + "%"],
        )
      )[0][0].n,
      1,
    );
    ok(await call("GET", `/meetings/${id}`, undefined, otherMentor), 404);
    ok(await call("PUT", `/meetings/${id}`, body([c.id]), mentor), 403);
    ok(await call("POST", `/meetings/${id}/cancel`, {}, otherMentor), 403);
    const own = ok(
      await call("GET", `/me/meetings/${id}`, undefined, internA),
      200,
    );
    assert.equal(own.emailLogs, undefined);
    assert.equal(own.attendees, undefined);
    ok(await call("GET", `/me/meetings/${id}`, undefined, internC), 404);
    ok(
      await call("GET", `/me/meetings?intern_id=${a.id}`, undefined, internC),
      400,
    );
    assert.equal(
      ok(
        await call("GET", "/me/meetings", undefined, internA),
        200,
      ).items.filter((x) => x.id === id).length,
      1,
    );
    const options = ok(
      await call("GET", "/meetings/options", undefined, mentor),
      200,
    );
    assert.ok(options.interns.some((i) => i.id === a.id));
    assert.ok(!options.interns.some((i) => i.id === c.id));
    await waitFor(async () => {
      const [[r]] = await conn.query(
        "SELECT COUNT(*) AS n FROM notifications WHERE ref_id=? AND type=?",
        [id, "MEETING_INVITE"],
      );
      return r.n === 1;
    }, "in-app notification");
    console.log(
      "[PASS] RBAC, Mentor/Intern IDOR, invalid attendance rollback, timezone, missing SMTP, request idempotency and in-app notification",
    );
    const initialLogs = await logs(id),
      invite = initialLogs.find((r) => r.email === a.email),
      invalidLog = initialLogs.find((r) => r.email === invalid.email);
    ok(
      await call(
        "POST",
        `/meetings/${id}/emails/${invalidLog.id}/retry`,
        {},
        mentor,
      ),
      400,
    );
    smtpConfig = {
      host: "127.0.0.1",
      port: smtp.server.address().port,
      secure: false,
      user: "us8",
      pass: "test-only",
      fromEmail: "hr@example.test",
      fromName: "Test HR",
    };
    ok(await call("PUT", "/email/config", smtpConfig, admin), 200);
    // A persisted, never-delivered job is resumed by a second application process.
    await conn.query(
      "UPDATE email_logs SET status='PENDING',attempts=0,processing_token=NULL,processing_until=NULL,next_attempt_at=NULL WHERE id=?",
      [invite.id],
    );
    const runtime =
        process.env.MEETINGS_TEST_RUNTIME_DIR || path.join(__dirname, ".."),
      port = Number(new URL(BASE_URL).port || 5000) + 1;
    secondary = spawn(process.execPath, [path.join(runtime, "server.js")], {
      cwd: runtime,
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let bootLog = "";
    secondary.stdout.on("data", (d) => (bootLog = (bootLog + d).slice(-4000)));
    secondary.stderr.on("data", (d) => (bootLog = (bootLog + d).slice(-4000)));
    await waitFor(async () => {
      if (secondary.exitCode !== null) throw new Error(bootLog);
      try {
        return (await fetch(`http://127.0.0.1:${port}/api/health`)).ok;
      } catch {
        return false;
      }
    }, "secondary startup");
    await waitFor(
      async () =>
        (await logs(id)).find((r) => r.id === invite.id && r.status === "SENT"),
      "restart delivery",
    );
    await sleep(500);
    const sent = accepted.filter((raw) =>
      raw.includes(`meeting-email-${invite.id}@`),
    );
    assert.equal(sent.length, 1);
    assert.match(subject(sent[0]), /\[Lịch họp\]/);
    assert.match(readable(sent[0]), /METHOD:REQUEST/);
    assert.match(readable(sent[0]), /SEQUENCE:0/);
    secondary.kill();
    await new Promise((resolve) => secondary.once("exit", resolve));
    secondary = null;
    let count = (await logs(id)).length;
    ok(await call("PUT", `/meetings/${id}`, input, mentor), 200);
    assert.equal((await logs(id)).length, count);
    const renamed = {
      ...input,
      title: prefix + " chỉ sửa tiêu đề",
      description: "Chỉ sửa mô tả",
    };
    ok(await call("PUT", `/meetings/${id}`, renamed, mentor), 200);
    assert.equal((await logs(id)).length, count);
    const changed = { ...renamed, location: "Phòng B" };
    ok(await call("PUT", `/meetings/${id}`, changed, mentor), 200);
    await waitFor(
      async () =>
        (await logs(id)).some(
          (r) => r.emailType === "MEETING_UPDATED" && r.status === "SENT",
        ),
      "updated email",
    );
    assert.equal((await logs(id)).length, count + 2);
    count = (await logs(id)).length;
    ok(await call("PUT", `/meetings/${id}`, changed, mentor), 200);
    assert.equal((await logs(id)).length, count);
    const withB = { ...changed, attendee_ids: [a.id, b.id] };
    ok(await call("PUT", `/meetings/${id}`, withB, mentor), 200);
    await waitFor(
      async () =>
        (await logs(id)).some(
          (r) =>
            r.email === b.email &&
            r.emailType === "MEETING_INVITE" &&
            r.status === "SENT",
        ),
      "new attendee invitation",
    );
    const retainedLogs = await logs(id);
    const retainedInvite = retainedLogs.find(
      (r) => r.email === a.email && r.emailType === "MEETING_UPDATED",
    );
    await conn.query("UPDATE email_logs SET status='FAILED' WHERE id=?", [
      retainedInvite.id,
    ]);
    ok(
      await call(
        "POST",
        `/meetings/${id}/emails/${retainedInvite.id}/retry`,
        {},
        mentor,
      ),
      200,
    );
    await waitFor(
      async () =>
        (await logs(id)).some(
          (r) => r.id === retainedInvite.id && r.status === "SENT",
        ),
      "retained participant retry after attendee change",
    );
    const onlyB = { ...withB, attendee_ids: [b.id] };
    ok(await call("PUT", `/meetings/${id}`, onlyB, mentor), 200);
    const removal = await waitFor(
      async () =>
        (await logs(id)).find(
          (r) =>
            r.email === a.email &&
            r.emailType === "MEETING_CANCELLED" &&
            r.status === "SENT",
        ),
      "removed attendee cancellation",
    );
    assert.match(
      readable(
        accepted.find((raw) => raw.includes(`meeting-email-${removal.id}@`)),
      ),
      /METHOD:CANCEL/,
    );
    ok(await call("GET", `/me/meetings/${id}`, undefined, internA), 404);
    ok(await call("POST", `/meetings/${id}/cancel`, {}, mentor), 200);
    await waitFor(
      async () =>
        (await logs(id)).some(
          (r) =>
            r.email === b.email &&
            r.emailType === "MEETING_CANCELLED" &&
            r.status === "SENT",
        ),
      "cancel email",
    );
    count = (await logs(id)).length;
    ok(await call("POST", `/meetings/${id}/cancel`, {}, mentor), 409);
    ok(await call("PUT", `/meetings/${id}`, onlyB, mentor), 409);
    assert.equal((await logs(id)).length, count);
    await conn.query("UPDATE email_logs SET status='FAILED' WHERE id=?", [
      invite.id,
    ]);
    ok(
      await call(
        "POST",
        `/meetings/${id}/emails/${invite.id}/retry`,
        {},
        mentor,
      ),
      409,
    );
    console.log(
      "[PASS] Restart recovery, correct invitation/update/cancel ICS, unchanged/unrelated edits, attendee changes, immutable cancellation and stale retry protection",
    );
    // A real SMTP 550 failure must not fail meeting creation; manual HR retry keeps the meeting template.
    failCode = 550;
    const failBody = body([b.id]),
      failedMeeting = ok(await create(failBody), 201);
    const failedLog = await waitFor(
      async () =>
        (await logs(failedMeeting.id)).find(
          (r) => r.status === "FAILED" && r.attempts === 1,
        ),
      "SMTP 550",
    );
    delay = 2500;
    const started = Date.now();
    const concurrentRetries = await Promise.all([
      call("POST", `/email/logs/${failedLog.id}/retry`, {}, hr),
      call("POST", `/email/logs/${failedLog.id}/retry`, {}, hr),
    ]);
    assert.equal(concurrentRetries.filter((r) => r.status === 200).length, 1);
    assert.ok(concurrentRetries.some((r) => [400, 409].includes(r.status)));
    assert.ok(Date.now() - started < 1800, "HTTP must not await slow SMTP");
    await waitFor(
      async () =>
        (await logs(failedMeeting.id)).some(
          (r) => r.id === failedLog.id && r.status === "SENT",
        ),
      "manual retry",
    );
    delay = 0;
    assert.equal(
      accepted.filter((raw) => raw.includes(`meeting-email-${failedLog.id}@`))
        .length,
      1,
    );
    assert.match(
      subject(
        accepted.find((raw) => raw.includes(`meeting-email-${failedLog.id}@`)),
      ),
      /\[Lịch họp\]/,
    );
    ok(
      await call(
        "POST",
        `/meetings/${id}/emails/${failedLog.id}/retry`,
        {},
        mentor,
      ),
      404,
    );
    ok(
      await call("POST", `/email/logs/${failedLog.id}/retry`, {}, otherMentor),
      403,
    );
    failCode = 451;
    const transient = ok(await create(body([b.id])), 201);
    await waitFor(
      async () =>
        (await logs(transient.id)).some((r) => r.status === "RETRYING"),
      "SMTP temporary failure",
    );
    const automatic = await waitFor(
      async () => (await logs(transient.id)).find((r) => r.status === "SENT"),
      "automatic backoff retry",
    );
    assert.equal(automatic.attempts, 2);
    const meetingLogs = ok(
      await call("GET", "/email/logs?type=MEETING_INVITE", undefined, hr),
      200,
    );
    assert.ok(meetingLogs.every((r) => r.emailType === "MEETING_INVITE"));
    console.log(
      "[PASS] SMTP failures preserve API success; async manual retry, 5-second automatic retry and HR log filtering",
    );
    const hrMeeting = ok(await create(body([c.id]), hr), 201);
    ok(await call("GET", `/meetings/${hrMeeting.id}`, undefined, mentor), 404);
    ok(
      await call("GET", `/meetings/${hrMeeting.id}`, undefined, otherMentor),
      200,
    );
    ok(
      await call(
        "PUT",
        `/meetings/${hrMeeting.id}`,
        { ...body([c.id]), location: "Mentor phụ trách cập nhật" },
        otherMentor,
      ),
      200,
    );
    const mixed = ok(await create(body([a.id, c.id]), hr), 201);
    ok(await call("GET", `/meetings/${mixed.id}`, undefined, mentor), 404);
    ok(
      await call("POST", `/meetings/${mixed.id}/cancel`, {}, otherMentor),
      403,
    );
    const past = ok(await create(body([b.id])), 201);
    await conn.query(
      "UPDATE meetings SET start_at=DATE_SUB(NOW(),INTERVAL 2 HOUR),end_at=DATE_SUB(NOW(),INTERVAL 1 HOUR) WHERE id=?",
      [past.id],
    );
    ok(await call("PUT", `/meetings/${past.id}`, body([b.id]), mentor), 409);
    ok(await call("POST", `/meetings/${past.id}/cancel`, {}, hr), 409);
    const reminderInput = body([b.id], {
        start_at: toSql(new Date(Date.now() + 23 * 3600000)).replace(" ", "T"),
        end_at: toSql(new Date(Date.now() + 24 * 3600000)).replace(" ", "T"),
      }),
      reminder = ok(await create(reminderInput), 201);
    const runReminders = () => {
      const script = `const db=require('./db');(async()=>{try{await db.initDatabase();const run=require('./services/reminders.service').runMeetingReminders;await run({deps:{db}});await run({deps:{db}});}finally{await db.closePool();}})().catch(e=>{console.error(e);process.exitCode=1;});`;
      const result = spawnSync(process.execPath, ["-e", script], {
        cwd: runtime,
        env: process.env,
        encoding: "utf8",
        timeout: 30000,
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    };
    runReminders();
    let reminderRows = (await logs(reminder.id)).filter(
      (r) => r.emailType === "MEETING_REMINDER",
    );
    assert.equal(reminderRows.length, 1);
    const near = {
      ...reminderInput,
      start_at: toSql(new Date(Date.now() + 45 * 60000)).replace(" ", "T"),
      end_at: toSql(new Date(Date.now() + 105 * 60000)).replace(" ", "T"),
    };
    ok(await call("PUT", `/meetings/${reminder.id}`, near, mentor), 200);
    runReminders();
    reminderRows = (await logs(reminder.id)).filter(
      (r) => r.emailType === "MEETING_REMINDER",
    );
    assert.equal(reminderRows.length, 2);
    assert.deepEqual(
      reminderRows
        .map((r) => JSON.parse(r.payload).reminderHours)
        .sort((a, b) => a - b),
      [1, 24],
    );
    ok(await call("PUT", `/meetings/${reminder.id}`, near, mentor), 200);
    await waitFor(
      async () =>
        (await logs(reminder.id)).some(
          (r) =>
            r.emailType === "MEETING_REMINDER" &&
            JSON.parse(r.payload).reminderHours === 1 &&
            r.status === "SENT",
        ),
      "reminder send",
    );
    const beforeSchema = (await logs(id)).length;
    await migrateMeetings(conn);
    await migrateMeetings(conn);
    assert.equal((await logs(id)).length, beforeSchema);
    console.log(
      "[PASS] HR global access, past meeting lock, durable 24h/1h reminder dedupe across reloads and idempotent migration",
    );
  } finally {
    if (secondary && secondary.exitCode === null) {
      secondary.kill();
      await new Promise((resolve) => secondary.once("exit", resolve));
    }
    if (admin && smtpConfig)
      await call(
        "PUT",
        "/email/config",
        { ...smtpConfig, host: "127.0.0.1" },
        admin,
      ).catch(() => {});
    if (meetingIds.size) {
      await conn.query(
        "DELETE FROM notifications WHERE ref_id IN (?) AND type IN (?)",
        [
          [...meetingIds],
          [
            "MEETING_INVITE",
            "MEETING_UPDATED",
            "MEETING_CANCELLED",
            "MEETING_REMINDER",
          ],
        ],
      );
      await conn.query("DELETE FROM email_logs WHERE meeting_id IN (?)", [
        [...meetingIds],
      ]);
      await conn.query("DELETE FROM meetings WHERE id IN (?)", [
        [...meetingIds],
      ]);
    }
    if (profileIds.length)
      await conn.query("DELETE FROM intern_profiles WHERE id IN (?)", [
        profileIds,
      ]);
    if (mentorIds.length)
      await conn.query("DELETE FROM mentors WHERE id IN (?)", [mentorIds]);
    if (emails.length)
      await conn.query("DELETE FROM users WHERE email IN (?)", [emails]);
    await conn.end();
    await new Promise((resolve) => smtp.close(resolve));
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
