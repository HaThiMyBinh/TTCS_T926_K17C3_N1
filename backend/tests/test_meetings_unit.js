const assert = require("node:assert/strict");
const { test } = require("node:test");
const rules = require("../services/meetingRules.service");
const events = require("../services/meetingEvents.service");
const templates = require("../services/email/templates");
const { foldLine, renderMeetingIcs } = require("../services/email/meetingIcs");
const queue = require("../services/email/emailQueue");
const db = require("../db");
const { migrateMeetings } = require("../migrations/meetingsMigration");
const now = new Date("2026-10-17T01:00:00Z");
const body = () => ({
  title: "Họp O'Brien <>&",
  description: "Tiếng Việt",
  start_at: "2026-10-18T08:00",
  end_at: "2026-10-18T09:00",
  location: "Phòng A",
  meeting_link: "https://example.test/hop?a=1&b=2",
  attendee_ids: [1, 2],
});
const meeting = () => ({
  id: 10,
  sequence: 0,
  title: "Họp <script>alert(1)</script> & O'Brien\r\nBcc: evil",
  description: "Mô tả; có dấu, ký tự \\ và\n dòng mới",
  startAt: "2026-10-18 08:00:00",
  endAt: "2026-10-18 09:00:00",
  location: "A <>&",
  meetingLink: "https://example.test/?a=1&b=2",
  organizerName: "HR <>&",
  organizerEmail: "hr@example.test",
});
const attendee = (id) => ({
  id,
  fullName: "Nguyễn O'Brien <>& " + id,
  email: `i${id}@example.test`,
});
test("strict input and query validation, participant uniqueness and duration", () => {
  assert.deepEqual(rules.validateInput(body(), { now }).attendeeIds, [1, 2]);
  for (const patch of [
    { program_id: [1] },
    { program_id: {} },
    { start_at: "9999-12-31T23:00Z" },
    { title: "" },
    { title: "x".repeat(201) },
    { title: {} },
    { start_at: "2026-02-30T08:00" },
    { start_at: "2026-10-18T25:00" },
    { start_at: "2020-01-01T08:00" },
    { end_at: "2026-10-18T07:59" },
    { end_at: "2026-10-19T09:00" },
    { meeting_link: "javascript:alert(1)" },
    { meeting_link: "https://u:p@example.test" },
    { attendee_ids: [] },
    { attendee_ids: [1, 1] },
    { attendee_ids: ["1"] },
    { attendee_ids: Array.from({ length: 201 }, (_, i) => i + 1) },
    { organizer_user_id: 1 },
    { request_key: "bad" },
  ])
    assert.throws(
      () => rules.validateInput({ ...body(), ...patch }, { now }),
      (e) => e.status === 400,
    );
  for (const query of [
    { foo: "x" },
    { page: "0" },
    { pageSize: "51" },
    { status: "foo" },
    { from: "2026-02-30" },
    { from: "2026-10-20", to: "2026-10-18" },
    { q: ["x", "y"] },
  ])
    assert.throws(
      () => rules.validateQuery(query),
      (e) => e.status === 400,
    );
});
test("timezone is independent of server timezone; SQL values mean Vietnam time", () => {
  const a = rules.validateInput(body(), { now });
  const b = rules.validateInput(
    { ...body(), start_at: "2026-10-18T01:00Z", end_at: "2026-10-18T02:00Z" },
    { now },
  );
  const c = rules.validateInput(
    {
      ...body(),
      start_at: "2026-10-18T08:00+07:00",
      end_at: "2026-10-18T09:00+07:00",
    },
    { now },
  );
  assert.equal(a.startAt, "2026-10-18 08:00:00");
  assert.equal(a.startAt, b.startAt);
  assert.equal(a.startAt, c.startAt);
  assert.equal(
    rules.toDate(a.startAt).toISOString(),
    "2026-10-18T01:00:00.000Z",
  );
  assert.equal(rules.toSql(now), "2026-10-17 08:00:00");
});
test("events only for material changes; added/removed attendees get invite/cancel", () => {
  const m = meeting(),
    before = [attendee(1), attendee(2)];
  assert.equal(events.buildJobs(m, [], before, { created: true }).length, 2);
  assert.equal(
    events.buildJobs({ ...m, title: "Tên mới" }, before, before, { old: m })
      .length,
    0,
  );
  assert.equal(
    events.buildJobs({ ...m, description: "Ghi chú mới" }, before, before, {
      old: m,
    }).length,
    0,
  );
  assert.equal(
    events
      .buildJobs({ ...m, location: "Phòng B" }, before, before, { old: m })
      .filter((j) => j.emailType === "MEETING_UPDATED").length,
    2,
  );
  const changed = events.buildJobs(
    { ...m, sequence: 1 },
    before,
    [attendee(1), attendee(3)],
    { old: m },
  );
  assert.deepEqual(changed.map((j) => j.emailType).sort(), [
    "MEETING_CANCELLED",
    "MEETING_INVITE",
  ]);
  assert.ok(
    JSON.parse(
      changed.find((j) => j.emailType === "MEETING_CANCELLED").payloadJson,
    ).removed,
  );
  const invalid = events.buildJobs(
    m,
    [],
    [{ ...attendee(1), email: "bad\r\n@example.test" }],
    { created: true },
  )[0];
  assert.equal(invalid.status, "FAILED");
  assert.match(invalid.errorMessage, /không hợp lệ/);
  assert.equal(events.calendarChanged(m, m, before, before), false);
  assert.equal(events.calendarChanged(m, m, before, [attendee(3)]), true);
});
test("Vietnamese email escaping, safe subjects, text and RFC5545 calendar data", () => {
  const payload = {
    meeting: meeting(),
    recipient: { id: 1, name: "<b>Nguyễn</b>", email: "i1@example.test" },
    type: "MEETING_INVITE",
    issuedAt: now.toISOString(),
  };
  const built = templates.renderMeetingEmail(payload);
  assert.ok(!built.html.includes("<script>"));
  assert.ok(built.html.includes("&lt;script&gt;"));
  assert.ok(!/[\r\n]/.test(built.subject));
  assert.match(built.text, /08:00:00/);
  assert.match(built.text, /60 phút/);
  assert.match(built.ics, /DTSTART;TZID=Asia\/Ho_Chi_Minh:20261018T080000/);
  assert.match(built.ics, /METHOD:REQUEST/);
  assert.match(built.ics, /SEQUENCE:0/);
  const cancelled = renderMeetingIcs({
    ...payload,
    type: "MEETING_CANCELLED",
    meeting: { ...payload.meeting, sequence: 1 },
  });
  assert.equal(cancelled.method, "CANCEL");
  assert.match(cancelled.content, /STATUS:CANCELLED/);
  assert.match(cancelled.content, /SEQUENCE:1/);
  assert.equal(
    /UID:(.*)\r/.exec(built.ics)[1],
    /UID:(.*)\r/.exec(cancelled.content)[1],
  );
  const folded = foldLine("SUMMARY:" + "Cuộc họp tiếng Việt 😊 ".repeat(50));
  for (const line of folded.split("\r\n"))
    assert.ok(Buffer.byteLength(line) <= 75);
  assert.equal(
    folded.replace(/\r\n /g, ""),
    "SUMMARY:" + "Cuộc họp tiếng Việt 😊 ".repeat(50),
  );
  for (const line of built.ics.split("\r\n"))
    assert.ok(Buffer.byteLength(line) <= 75);
  assert.ok(built.ics.includes("\\;"));
  assert.ok(built.ics.includes("\\n"));
});
test("reminder horizons and keys survive reruns while rescheduling gets a new key", () => {
  const m = { id: 1, sequence: 0, startAt: "2026-10-18 08:00:00" };
  assert.equal(rules.reminderSlot(m, new Date("2026-10-17T02:00:00Z")), 24);
  assert.equal(rules.reminderSlot(m, new Date("2026-10-18T00:30:00Z")), 1);
  assert.equal(rules.reminderSlot(m, new Date("2026-10-18T01:00:00Z")), null);
  assert.equal(rules.reminderSlot(m, new Date("2026-10-16T01:00:00Z")), null);
  assert.equal(rules.reminderKey(m, 24, 1), rules.reminderKey({ ...m }, 24, 1));
  assert.notEqual(
    rules.reminderKey(m, 24, 1),
    rules.reminderKey({ ...m, sequence: 1 }, 24, 1),
  );
});
test("_rebuildJob uses every explicit template; unknown types never become rejection", async () => {
  const originalPayload = db.findMeetingEmailPayload,
    originalApplication = db.findApplicationById;
  try {
    for (const type of rules.EMAIL_TYPES) {
      db.findMeetingEmailPayload = async () => ({
        meeting: meeting(),
        recipient: { id: 1, name: "Nguyễn", email: "i1@example.test" },
        type,
        reminderHours: 24,
      });
      const job = await queue._rebuildJob({
        id: 50,
        meetingId: 10,
        emailType: type,
        recipientName: "Nguyễn",
        recipientEmail: "i1@example.test",
      });
      assert.ok(job.built.subject.includes("[Lịch họp]"));
      assert.ok(job.built.ics);
      assert.ok(!job.built.subject.includes("[Tuyển Dụng]"));
      assert.equal(
        job.built.icsMethod,
        type === "MEETING_CANCELLED" ? "CANCEL" : "REQUEST",
      );
    }
    db.findApplicationById = async () => ({
      name: "Ứng viên",
      email: "c@example.test",
    });
    for (const type of ["APPROVED", "REJECTED"]) {
      const result = await queue._rebuildJob({
        applicationId: 1,
        emailType: type,
        recipientEmail: "c@example.test",
      });
      assert.ok(!result.built.meeting);
      assert.match(
        result.built.subject,
        type === "APPROVED" ? /trúng tuyển/ : /kết quả/i,
      );
    }
    for (const type of ["UNKNOWN", "constructor", "toString", "__proto__"])
      await assert.rejects(
        queue._rebuildJob({ emailType: type }),
        (e) => e.status === 400,
      );
  } finally {
    db.findMeetingEmailPayload = originalPayload;
    db.findApplicationById = originalApplication;
  }
});
test("migration is additive and repeatable, preserving unknown legacy enum values", async () => {
  let type = "enum('APPROVED','REJECTED','FUTURE_TYPE')",
    alters = 0;
  const names = new Set(["email_type"]),
    indexes = new Set();
  const fake = {
    query: async (sql, params) => {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("information_schema.COLUMNS"))
        return [
          [...names].map((name) => ({
            COLUMN_NAME: name,
            COLUMN_TYPE: type,
            IS_NULLABLE: "NO",
            COLUMN_DEFAULT: null,
          })),
        ];
      if (sql.startsWith("SHOW INDEX"))
        return [[...indexes].map((Key_name) => ({ Key_name }))];
      if (sql.startsWith("ALTER TABLE")) {
        alters++;
        if (sql.includes("MODIFY COLUMN")) {
          assert.ok(sql.includes("'FUTURE_TYPE'"));
          type = /ENUM\((.*?)\)/.exec(sql)[0];
        }
        const c = /ADD COLUMN (\w+)/.exec(sql);
        if (c) names.add(c[1]);
        const k = /ADD (?:UNIQUE KEY|INDEX) (\w+)/.exec(sql);
        if (k) indexes.add(k[1]);
      }
      return [{ affectedRows: 0 }];
    },
  };
  await migrateMeetings(fake);
  const count = alters;
  await migrateMeetings(fake);
  assert.equal(alters, count);
  assert.ok(names.has("payload_json"));
  assert.ok(indexes.has("uq_email_event"));
});
