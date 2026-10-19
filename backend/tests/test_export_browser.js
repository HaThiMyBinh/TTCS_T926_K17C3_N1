const { serveFrontendStatic } = require("./frontend_static");
// optionalBrowser: real production page, mocked JSON/XLSX APIs; never opens the real print dialog.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const ExcelJS = require("exceljs");
const { fixtures, name, now } = require("./export_fixtures");
const models = require("../services/export/reportModels");
const { renderXlsx, filenames, MIME } = require("../services/export/xlsx");
const finalService = require("../services/finalReports.service");
const originService = require("../services/internOriginReport.service");
const completionService = require("../services/completionRate.service");
async function main() {
  const model = fixtures();
  const final = {
    id: 7,
    title: name,
    status: "DRAFT",
    scopeType: "ALL",
    scopeLabel: "Tất cả",
    sends: [],
    data: finalService.summarizeRows(
      [
        {
          fullName: name,
          studentCode: "00009",
          university: "Đại học Y",
          skillScore: 4,
          attitudeScore: 5,
          weeklyReports: [],
        },
      ],
      { today: "2026-10-17" },
    ),
  };
  final.exportModel = model.final = models.finalReport(final, now);
  const origin = originService.buildOriginReport([
    { university: name, major: "CNTT", count: 3 },
  ]);
  origin.exportModel = model.origin;
  const completion = {
    ...completionService.buildReport([
      {
        id: 1,
        programId: 1,
        programName: name,
        mentorName: "Mentor",
        status: "Hoàn thành",
      },
    ]),
    programs: [],
    exportModel: model.completion,
  };
  const attendance = {
    summary: {
      totalInterns: 1,
      requiredDays: 3,
      presentDays: 1,
      leaveDays: 0,
      absentDays: 2,
      lateCount: 0,
      attendanceRate: 33.3,
    },
    groups: [],
    interns: [
      {
        intern: { id: 1, fullName: name, studentCode: "00009" },
        totalWorkMinutes: 120,
        attendanceRate: 33.3,
      },
    ],
    exportModel: model.attendance,
  };
  const reportData = { final, origin, completion, attendance };
  const bases = {
    final: "/api/final-reports/7",
    origin: "/api/reports/interns-by-origin",
    completion: "/api/reports/completion-rate",
    attendance: "/api/attendance/report",
  };
  const buffers = {};
  for (const kind of Object.keys(bases))
    buffers[kind] = await renderXlsx(model[kind]);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 900 },
      acceptDownloads: true,
    });
    const errors = [],
      requests = [];
    let failure = 0;
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      sessionStorage.setItem("authToken", "export-test-token");
      sessionStorage.setItem(
        "currentUser",
        JSON.stringify({
          id: 1,
          role: "HR",
          name: "HR",
          email: "hr@example.test",
        }),
      );
      window.__printed = [];
      window.print = () => {
        throw new Error("Must print inside isolated iframe");
      };
      document.addEventListener(
        "load",
        (event) => {
          const frame = event.target;
          if (
            frame.tagName !== "IFRAME" ||
            !frame.classList.contains("report-print-frame")
          )
            return;
          frame.contentWindow.print = () => {
            if (window.__throwPrint)
              throw new Error("Simulated unavailable print");
            const d = frame.contentDocument;
            window.__printed.push({
              title: d.title,
              text: d.body.textContent,
              html: d.body.innerHTML,
              css: d.querySelector("style").textContent,
              tables: d.querySelectorAll("table").length,
              scripts: d.querySelectorAll("script").length,
            });
          };
        },
        true,
      );
    });
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      const json = (data, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(data),
        });
      assert.equal(
        url.hostname,
        "us7.test",
        "No runtime CDN/network dependencies",
      );
      const served = serveFrontendStatic(route);
      if (served) return served;
      if (url.pathname === "/api/permissions")
        return json({
          HR: ["VIEW_REPORTS"],
          Admin: [],
          Mentor: [],
          Intern: [],
        });
      if (url.pathname === "/api/final-reports")
        return json({
          success: true,
          data: { reports: [], options: { universities: [], programs: [] } },
        });
      if (url.pathname === "/api/notifications")
        return json({ data: { unread: 0, items: [] } });
      if (url.pathname === "/api/mentors") return json([]);
      for (const [kind, base] of Object.entries(bases)) {
        if (
          url.pathname === base ||
          url.pathname === base + "/export.xlsx" ||
          url.pathname === base + "/export.csv"
        ) {
          assert.equal(
            route.request().headers().authorization,
            "Bearer export-test-token",
          );
          requests.push(url.pathname + url.search);
          if (failure)
            return json(
              {
                message:
                  failure === 500
                    ? "PRIVATE_SQL"
                    : "Không có quyền xuất báo cáo.",
              },
              failure,
            );
          if (url.pathname.endsWith(".xlsx")) {
            const n = filenames(model[kind]);
            return route.fulfill({
              contentType: MIME,
              headers: {
                "content-disposition": `attachment; filename="${n.ascii}"; filename*=UTF-8''${encodeURIComponent(n.unicode)}`,
              },
              body: buffers[kind],
            });
          }
          if (url.pathname.endsWith(".csv"))
            return route.fulfill({
              contentType: "text/csv",
              body: '\uFEFF"CSV"\r\n',
              headers: {
                "content-disposition": 'attachment; filename="legacy.csv"',
              },
            });
          return json({ success: true, data: reportData[kind] });
        }
      }
      return json({
        success: true,
        data: {},
        applications: { total: 0, pending: 0, approved: 0, rejected: 0 },
        interns: { total: 0, assigned: 0 },
        contracts: { total: 0, confirmed: 0 },
      });
    });
    await page.goto("http://us7.test/index.html");
    await page.locator("#crHubCard").waitFor();
    for (const width of [390, 768, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [kind, tab] of [
        ["completion", "tab-completion-rate"],
        ["origin", "tab-intern-origin-report"],
        ["attendance", "tab-attendance-report"],
        ["final", "tab-final-reports"],
      ]) {
        await page.evaluate((tab) => switchTab(tab), tab);
        if (kind === "completion")
          await page.waitForFunction(() => crAppliedFilters !== null);
        if (kind === "origin") await page.locator("#iorViewButton").waitFor();
        if (kind === "final") await page.evaluate(() => openFinalReport(7));
        const excel = page.locator(
          `[data-report-export="${kind}"][data-export-format="xlsx"]`,
        );
        const pdf = page.locator(
          `[data-report-export="${kind}"][data-export-format="pdf"]`,
        );
        await excel.waitFor();
        await pdf.waitFor();
        for (const button of [excel, pdf]) {
          const box = await button.boundingBox();
          assert.ok(
            box.x >= 0 && box.x + box.width <= width + 1,
            `${kind} ${width}`,
          );
        }
        const downloadPromise = page.waitForEvent("download");
        await excel.click();
        const download = await downloadPromise;
        assert.equal(
          download.suggestedFilename(),
          filenames(model[kind]).unicode,
        );
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(await download.path());
        assert.equal(workbook.worksheets.length, model[kind].tables.length);
        const originalTitle = await page.title();
        await pdf.click();
        await page.waitForFunction(() => window.__printed.length > 0);
        assert.equal(await pdf.isDisabled(), true);
        const printed = await page.evaluate(() => window.__printed.shift());
        assert.equal(printed.tables, model[kind].tables.length);
        assert.equal(
          await page.title(),
          `${model[kind].fileBase}_${model[kind].exportedDate}`,
        );
        const exportRequest = requests.findLast((p) =>
          p.includes("/export.xlsx"),
        );
        assert.equal(
          requests.at(-1),
          exportRequest.replace("/export.xlsx", ""),
        );
        for (const line of model[kind].info)
          assert.ok(printed.text.includes(line));
        assert.equal(printed.scripts, 0);
        assert.ok(printed.text.includes(name), kind);
        assert.ok(printed.text.includes("giờ Việt Nam"));
        assert.ok(printed.html.includes("&lt;script&gt;"));
        assert.ok(!printed.html.includes("<script>"));
        assert.ok(!printed.text.includes("Menu Chức Năng"));
        assert.ok(!printed.text.includes("PRIVATE"));
        assert.match(printed.css, /counter\(page\)/);
        assert.match(printed.css, /table-header-group/);
        assert.match(printed.css, /break-inside: avoid/);
        if (model[kind].tables.some((t) => t.columns.length > 6))
          assert.match(printed.css, /A4 landscape/);
        await page.evaluate(() =>
          document
            .querySelector("iframe.report-print-frame")
            .contentWindow.dispatchEvent(new Event("afterprint")),
        );
        await page.waitForFunction(
          () => !document.querySelector("iframe.report-print-frame"),
        );
        assert.equal(await pdf.isDisabled(), false);
        assert.equal(await page.title(), originalTitle);
        if (process.env.US7_SCREENSHOT_DIR) {
          fs.mkdirSync(process.env.US7_SCREENSHOT_DIR, { recursive: true });
          await page.screenshot({
            path: path.join(
              process.env.US7_SCREENSHOT_DIR,
              `${kind}-${width}.png`,
            ),
          });
        }
      }
      console.log(
        `[PASS] ${width}px: all four Excel downloads and isolated PDF print pages; labels, escaping, page layout and cleanup`,
      );
    }
    failure = 403;
    await page
      .locator('[data-report-export="final"][data-export-format="xlsx"]')
      .click();
    await page.waitForFunction(() =>
      document
        .getElementById("finalReportError")
        .textContent.includes("Không có quyền"),
    );
    failure = 500;
    await page
      .locator('[data-report-export="final"][data-export-format="pdf"]')
      .click();
    await page.waitForFunction(() =>
      document
        .getElementById("finalReportError")
        .textContent.includes("thử lại sau"),
    );
    assert.ok(
      !(await page.locator("#finalReportError").innerText()).includes(
        "PRIVATE",
      ),
    );
    failure = 0;
    await page.evaluate(() => (window.__throwPrint = true));
    await page
      .locator('[data-report-export="final"][data-export-format="pdf"]')
      .click();
    await page.waitForFunction(() =>
      document
        .getElementById("finalReportError")
        .textContent.includes("Không mở được"),
    );
    assert.equal(await page.locator("iframe.report-print-frame").count(), 0);
    assert.equal(
      await page
        .locator('[data-report-export="final"][data-export-format="pdf"]')
        .isDisabled(),
      false,
    );
    assert.deepEqual(errors, []);
    assert.ok(
      requests.some((p) =>
        p.startsWith("/api/attendance/report/export.xlsx?from="),
      ),
    );
    console.log(
      "[PASS] Permission/server/print failures show friendly messages, release buttons and leave no iframe",
    );
  } finally {
    await browser.close();
  }
}
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
