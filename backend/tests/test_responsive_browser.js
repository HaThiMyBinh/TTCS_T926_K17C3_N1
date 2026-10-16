// Optional: production HTML in Chromium, mocked APIs, no database or external assets.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const frontend = path.join(__dirname, "../../Frontend");
const shots = process.env.UI_SCREENSHOT_DIR || "/tmp/us6-responsive";
const summary = {
  total: 3,
  completed: 1,
  active: 1,
  notCompleted: 1,
  rate: 33.3,
};
async function main() {
  fs.mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      sessionStorage.setItem("authToken", "responsive-test");
      sessionStorage.setItem(
        "currentUser",
        JSON.stringify({
          id: 1,
          role: "HR",
          name: "Nhân sự Nguyễn Thị Minh",
          email: "hr@example.test",
        }),
      );
    });
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      const json = (body) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      if (url.hostname !== "ui.test") return route.abort();
      if (
        ["/index.html", "/login.html", "/register.html"].includes(url.pathname)
      )
        return route.fulfill({
          contentType: "text/html",
          body: fs.readFileSync(
            path.join(frontend, url.pathname.slice(1)),
            "utf8",
          ),
        });
      if (url.pathname === "/api/permissions")
        return json({
          HR: ["MANAGE_USERS", "VIEW_REPORTS"],
          Admin: [],
          Mentor: [],
          Intern: [],
        });
      if (url.pathname === "/api/users")
        return json([
          {
            id: 1,
            name: "Nguyễn Thị Minh",
            email: "hr@example.test",
            role: "HR",
            status: "Active",
          },
        ]);
      if (url.pathname === "/api/students")
        return json([
          {
            id: 9,
            studentCode: "SV009",
            fullName: "Nguyễn Văn Bình",
            email: "binh@example.test",
            university: "Đại học Công nghệ thông tin",
            major: "Kỹ thuật phần mềm",
            status: "Đang thực tập",
          },
        ]);
      if (url.pathname === "/api/interns/filter-options")
        return json({ universities: [], majors: [] });
      if (url.pathname === "/api/mentors") return json([]);
      if (url.pathname === "/api/interns/count") return json({ count: 0 });
      if (url.pathname === "/api/reports/completion-rate")
        return json({
          success: true,
          data: {
            summary,
            byProgram: [
              { key: "1", name: "Chương trình thực tập mùa hè", ...summary },
            ],
            byMentor: [{ key: "1", name: "Mentor Nguyễn Văn An", ...summary }],
            programs: [{ id: 1, name: "Chương trình thực tập mùa hè" }],
          },
        });
      if (url.pathname === "/api/notifications")
        return json({ data: { unread: 0, items: [] } });
      return json({
        success: true,
        data: {},
        applications: { total: 0, pending: 0, approved: 0, rejected: 0 },
        interns: { total: 0, assigned: 0 },
        contracts: { total: 0, confirmed: 0 },
      });
    });
    await page.goto("http://ui.test/index.html");
    await page
      .locator("#sidebarMenu .nav-link")
      .first()
      .waitFor({ state: "attached" });
    async function assertLayout(width) {
      const layout = await page.evaluate(() => {
        const main = document.querySelector("main"),
          content = document.querySelector(".content-scroll");
        return {
          mainWidth: main.getBoundingClientRect().width,
          mainX: main.getBoundingClientRect().x,
          documentWidth: document.documentElement.scrollWidth,
          contentWidth: content.clientWidth,
          contentScroll: content.scrollWidth,
        };
      });
      assert.equal(
        layout.mainX,
        width <= 1024 ? 0 : 272,
        JSON.stringify(layout),
      );
      assert.equal(
        layout.mainWidth,
        width <= 1024 ? width : width - 272,
        JSON.stringify(layout),
      );
      assert.ok(layout.documentWidth <= width + 1, JSON.stringify(layout));
      assert.ok(
        layout.contentScroll <= layout.contentWidth + 1,
        JSON.stringify(layout),
      );
    }
    for (const width of [390, 768, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await assertLayout(width);
      assert.equal(
        await page.locator("#appSidebar").getAttribute("aria-hidden"),
        "true",
      );
      await page.locator("#sidebarToggle").click();
      assert.equal(
        await page.locator("#sidebarToggle").getAttribute("aria-expanded"),
        "true",
      );
      assert.equal(await page.locator("main").evaluate((el) => el.inert), true);
      await page.waitForFunction(
        () =>
          document.getElementById("appSidebar").getBoundingClientRect().x === 0,
      );

      await page.waitForFunction(
        () => document.activeElement.id === "sidebarClose",
        null,
        { timeout: 2000 },
      );
      await page.locator("#sidebarClose").press("Shift+Tab");
      assert.equal(
        await page.evaluate(
          () => document.activeElement.closest(".sidebar-footer") !== null,
        ),
        true,
      );
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "sidebarClose",
      );
      await page.waitForFunction(
        () =>
          document.getElementById("appSidebar").getBoundingClientRect().x === 0,
      );
      await page.screenshot({ path: path.join(shots, `menu-${width}.png`) });
      await page.keyboard.press("Escape");
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "sidebarToggle",
      );
      assert.equal(
        await page.locator("main").evaluate((el) => el.inert),
        false,
      );
      await page.locator("#sidebarToggle").click();
      await page
        .locator("#sidebarBackdrop")
        .click({ position: { x: width - 10, y: 200 } });
      assert.equal(
        await page.locator("#sidebarToggle").getAttribute("aria-expanded"),
        "false",
      );
      await page.locator("#sidebarToggle").click();
      await page
        .locator("#sidebarMenu .nav-link")
        .filter({ hasText: "Báo cáo & Thống kê" })
        .press("Enter");
      assert.equal(
        await page.locator("#sidebarToggle").getAttribute("aria-expanded"),
        "false",
      );
      await page.locator("#crHubCard").click();
      await page.locator("#crPrograms table").waitFor();
      await assertLayout(width);
      const inputs = await page
        .locator("#crFilters input, #crFilters select")
        .evaluateAll((els) =>
          els.map((el) => ({
            left: el.getBoundingClientRect().left,
            right: el.getBoundingClientRect().right,
          })),
        );
      assert.ok(
        inputs.every((el) => el.left >= 0 && el.right <= width),
        JSON.stringify(inputs),
      );
      const wrapper = page.locator("#crPrograms .table-container");
      if (width <= 600) {
        assert.ok(
          await wrapper.evaluate((el) => el.scrollWidth > el.clientWidth),
        );
        await wrapper.evaluate((el) => {
          el.scrollLeft = el.scrollWidth;
        });
        const bounds = await wrapper.evaluate((el) => ({
          right: el.getBoundingClientRect().right,
          lastRight: el
            .querySelector("tr:last-child td:last-child")
            .getBoundingClientRect().right,
          left: el.scrollLeft,
        }));
        assert.ok(
          bounds.left > 0 && bounds.lastRight <= bounds.right + 1,
          JSON.stringify(bounds),
        );
      }
      await page.screenshot({ path: path.join(shots, `report-${width}.png`) });
      await page.evaluate(() => switchTab("tab-students"));
      await page
        .locator("#studentTableBody tr")
        .filter({ hasText: "Nguyễn Văn Bình" })
        .waitFor();
      await assertLayout(width);
      await page.screenshot({
        path: path.join(shots, `students-${width}.png`),
      });
      console.log(
        `[PASS] ${width}px: menu, keyboard/focus, Escape, backdrop, navigation, filters, table scrolling, layout`,
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#sidebarToggle").click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await assertLayout(1440);
    assert.equal(
      await page
        .locator("#appSidebar")
        .evaluate((el) => el.getBoundingClientRect().x),
      0,
    );
    assert.equal(
      await page.locator("#appSidebar").evaluate((el) => el.inert),
      false,
    );
    assert.equal(await page.locator("main").evaluate((el) => el.inert), false);
    assert.equal(await page.locator("#sidebarBackdrop").isHidden(), true);
    assert.equal(await page.locator("#sidebarToggle").isHidden(), true);
    await page.screenshot({ path: path.join(shots, "desktop-1440.png") });
    console.log(
      "[PASS] Desktop sidebar restored after resize; background remains interactive",
    );
    await page.evaluate(() => {
      currentRole = "Intern";
      renderUserMenu({
        name: "Thực tập sinh Nguyễn Văn Bình",
        email: "intern@example.test",
      });
      renderDynamicMenu();
      document.getElementById("pageTitle").textContent = "Hồ sơ của tôi";
    });
    for (const width of [390, 768, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await assertLayout(width);
      const actions = await page
        .locator(".header-actions > *")
        .evaluateAll((els) =>
          els
            .filter((el) => el.getClientRects().length)
            .map((el) => ({
              left: el.getBoundingClientRect().left,
              right: el.getBoundingClientRect().right,
            })),
        );
      assert.ok(
        actions.every((el) => el.left >= 0 && el.right <= width),
        JSON.stringify(actions),
      );
      assert.equal(await page.locator("#btnFormUngTuyen").isVisible(), true);
      assert.equal(
        await page
          .locator("#sidebarMenu .nav-link")
          .first()
          .evaluate((el) => getComputedStyle(el).visibility),
        "hidden",
      );
      await page.screenshot({ path: path.join(shots, `intern-${width}.png`) });
    }
    console.log(
      "[PASS] Intern header keeps application link, notifications and profile inside the viewport",
    );
    for (const name of ["index", "login", "register"]) {
      await page.goto(`http://ui.test/${name}.html`);
      const theme = await page.evaluate(() => {
        const css = getComputedStyle(document.documentElement);
        return [
          css.getPropertyValue("--primary").trim(),
          css.getPropertyValue("--primary-hover").trim(),
        ];
      });
      assert.deepEqual(theme, ["#2563eb", "#1d4ed8"]);
      if (name !== "index") {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(shots, `${name}-390.png`) });
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      "[PASS] Three pages share primary/hover colors; no uncaught JavaScript errors",
    );
  } finally {
    await browser.close();
  }
}
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
