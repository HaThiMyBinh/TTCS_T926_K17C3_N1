const { serveFrontendStatic } = require("./frontend_static");
// optionalBrowser: production HTML with isolated API fixtures; no database writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const rules = require("../services/meetingRules.service");
const name = `Họp O'Brien <img src=x onerror="window.__xss=1"> & trao đổi`;
async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    for (const role of ["HR", "Mentor", "Intern", "Admin"]) {
      const page = await browser.newPage({
        viewport: { width: 390, height: 900 },
      });
      page.setDefaultTimeout(10000);
      const errors = [],
        actions = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript((role) => {
        sessionStorage.setItem("authToken", "meeting-test");
        sessionStorage.setItem(
          "currentUser",
          JSON.stringify({
            id: 1,
            role,
            name: role,
            email: "user@example.test",
          }),
        );
      }, role);
      let meeting = {
        id: 7,
        title: name,
        description: "<script>window.__xss=1</script>\nMô tả",
        startAt: rules.toSql(Date.now() + 48 * 3600000),
        endAt: rules.toSql(Date.now() + 49 * 3600000),
        location: "Phòng <>&",
        meetingLink: "https://example.test/?a=1&b=2",
        organizerName: "HR <>&",
        status: "SCHEDULED",
        attendees: [
          {
            id: 2,
            fullName: "Nguyễn O'Brien <>&",
            email: "intern@example.test",
          },
        ],
        emailLogs: [
          {
            id: 9,
            recipientName: "Nguyễn <>&",
            recipientEmail: "intern@example.test",
            emailType: "MEETING_INVITE",
            status: "FAILED",
            errorMessage: "SMTP <>&",
          },
          {
            id: 10,
            recipientName: "Nguyễn",
            recipientEmail: "intern@example.test",
            emailType: "<UNKNOWN>",
            status: "<UNKNOWN>",
            errorMessage: "",
          },
        ],
      };
      await page.route("**/*", (route) => {
        const u = new URL(route.request().url()),
          method = route.request().method();
        const json = (data, status = 200) =>
          route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify(data),
          });
        assert.equal(u.hostname, "us8.test", "No external runtime dependency");
        const served = serveFrontendStatic(route);
        if (served) return served;
        if (u.pathname === "/api/permissions")
          return json({
            HR: ["VIEW_REPORTS"],
            Mentor: [],
            Intern: [],
            Admin: [],
          });
        if (u.pathname === "/api/notifications")
          return json({ data: { items: [], unread: 0 } });
        if (u.pathname === "/api/mentors") return json([]);
        if (/^\/api\/(me\/)?meetings/.test(u.pathname)) {
          assert.equal(
            route.request().headers().authorization,
            "Bearer meeting-test",
          );
          if (u.pathname.endsWith("/options"))
            return json({ data: { interns: meeting.attendees, programs: [] } });
          if (u.pathname.endsWith("/retry")) {
            actions.push("retry");
            meeting.emailLogs[0].status = "SENT";
            return json({ data: { queued: true } });
          }
          if (u.pathname.endsWith("/cancel")) {
            actions.push("cancel");
            meeting.status = "CANCELLED";
            return json({ data: { id: 7 } });
          }
          if (["POST", "PUT"].includes(method)) {
            const body = route.request().postDataJSON();
            actions.push(method);
            assert.deepEqual(body.attendee_ids, [2]);
            meeting = {
              ...meeting,
              title: body.title,
              location: body.location,
              description: body.description,
              startAt: body.start_at.replace("T", " ") + ":00",
              endAt: body.end_at.replace("T", " ") + ":00",
            };
            return json({ data: { id: 7 } });
          }
          if (u.pathname.endsWith("/7")) return json({ data: meeting });
          return json({
            data: {
              items: [meeting],
              pagination: { page: 1, totalPages: 1, total: 1 },
            },
          });
        }
        return json({
          success: true,
          data: {},
          applications: { total: 0, pending: 0, approved: 0, rejected: 0 },
          interns: { total: 0, assigned: 0 },
          contracts: { total: 0, confirmed: 0 },
        });
      });
      await page.goto("http://us8.test/index.html");
      const tab = role === "Intern" ? "tab-my-meetings" : "tab-meetings";
      await page.waitForFunction(
        () => document.querySelector("#sidebarMenu")?.children.length > 0,
      );
      if (role === "Admin") {
        assert.equal(
          await page
            .locator('[data-tab="tab-meetings"], [data-tab="tab-my-meetings"]')
            .count(),
          0,
        );
        await page.close();
        console.log("[PASS] Admin has no meetings menu");
        continue;
      }
      await page.evaluate((tab) => switchTab(tab), tab);
      await page.locator('[data-meeting-action="detail"]').waitFor();
      for (const width of [390, 768, 1366]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${role} ${width}: no page overflow`,
        );
        assert.ok(
          (await page.locator("#meetingList").innerText()).includes(name),
        );
        assert.equal(await page.locator("#meetingList img").count(), 0);
        await page.locator('[data-meeting-action="detail"]').click();
        await page.locator("#meetingModalBody h3").waitFor();
        assert.ok(
          (await page.locator("#meetingModalBody").innerText()).includes(name),
        );
        assert.equal(
          await page
            .locator("#meetingModalBody img, #meetingModalBody script")
            .count(),
          0,
        );
        const box = await page.locator(".meeting-modal").boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
        if (role === "Intern") {
          assert.equal(
            await page
              .locator(
                '[data-meeting-action="edit"], [data-meeting-action="retry"], [data-meeting-action="create"]',
              )
              .count(),
            0,
          );
        } else {
          await page.locator('[data-meeting-action="edit"]').click();
          await page.locator("#meetingTitle").waitFor();
          assert.equal(await page.locator("#meetingTitle").inputValue(), name);
          const field = await page.locator("#meetingTitle").boundingBox();
          assert.ok(field.x >= 0 && field.x + field.width <= width + 1);
          assert.equal(
            await page.locator("#meetingAttendees input:checked").count(),
            1,
          );
        }
        if (process.env.US8_SCREENSHOT_DIR) {
          fs.mkdirSync(process.env.US8_SCREENSHOT_DIR, { recursive: true });
          await page.screenshot({
            path: path.join(
              process.env.US8_SCREENSHOT_DIR,
              `${role}-${width}.png`,
            ),
          });
        }
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("#meetingModal").isVisible(), false);
      }
      if (role !== "Intern") {
        await page.locator('[data-meeting-action="create"]').click();
        await page.locator("#meetingTitle").fill(name);
        await page
          .locator("#meetingStart")
          .fill(meeting.startAt.slice(0, 16).replace(" ", "T"));
        await page
          .locator("#meetingEnd")
          .fill(meeting.endAt.slice(0, 16).replace(" ", "T"));
        await page.locator("#meetingAttendees input").check();
        await page.locator("#meetingSave").click();
        await page.locator('[data-meeting-action="retry"]').click();
        await page.waitForFunction(() =>
          document
            .getElementById("meetingModalBody")
            .textContent.includes("Đã gửi"),
        );
        await page.locator('[data-meeting-action="edit"]').click();
        await page.locator("#meetingLocation").fill("Địa điểm mới <>&");
        await page.locator("#meetingSave").click();
        await page.locator('[data-meeting-action="cancel"]').waitFor();
        page.once("dialog", (dialog) => dialog.accept());
        await page.locator('[data-meeting-action="cancel"]').click();
        await page.waitForFunction(() =>
          document
            .getElementById("meetingModalBody")
            .textContent.includes("Đã hủy"),
        );
        assert.deepEqual(actions, ["POST", "retry", "PUT", "cancel"]);
        assert.equal(
          await page.locator('[data-meeting-action="edit"]').count(),
          0,
        );
      }
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => window.__xss), undefined);
      console.log(
        `[PASS] ${role}: 390/768/1366px, safe text, modal/Esc and ${role === "Intern" ? "read-only" : "create/edit/cancel/retry"}`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
