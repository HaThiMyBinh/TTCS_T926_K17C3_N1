// Requires Playwright and Chromium. Exercises production renderers/listeners in an isolated DOM.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { frontendScripts, frontendStyles } = require("./frontend_static");
const script = frontendScripts();
function extract(start, end) {
  const first = script.indexOf(start);
  const last = script.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Production snippet exists: ${start}`);
  return script.slice(first, last);
}
async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1000, height: 700 },
    });
    await page.setContent(
      "<style>" +
        frontendStyles() +
        "</style>" +
        '<div style="width:700px"><div id="iorMatrixBody"></div></div><div id="iorUniChartBody"></div><div id="iorMajorChartBody"></div><div id="iorDetailModal" style="display:none"></div>',
    );
    await page.addScriptTag({
      content:
        extract("function escapeHtml(value)", "function getVietnamParts") +
        extract(
          "function iorIsClickable(",
          "function renderInternOriginCharts(data)",
        ) +
        extract(
          "function renderInternOriginCharts(data)",
          "function renderInternOriginTables(data)",
        ) +
        extract(
          "function renderInternOriginMatrix(data)",
          "function renderInternOriginFunnel(data)",
        ) +
        extract(
          'document.addEventListener("click", (event) => {\n  const trigger = event.target.closest(".ior-detail-trigger")',
          "// ---------- Lịch làm việc (HR thiết lập) ----------",
        ) +
        'window.calls=[]; function openInternOriginDetailModal(u,m,p) {calls.push([u,m,p]); document.getElementById("iorDetailModal").style.display="flex";} function closeInternOriginModal(){document.getElementById("iorDetailModal").style.display="none";}',
    });
    const name = 'O\'Brien "College" <Y> & Sons';
    await page.evaluate(
      (name) =>
        renderInternOriginCharts({
          byUniversity: [{ name, count: 3, percent: 100 }],
          byMajor: [],
        }),
      name,
    );
    await page.locator(".ior-detail-trigger span").first().click();
    assert.deepEqual(await page.evaluate(() => calls), [[name, "", 1]]);
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("#iorDetailModal").evaluate((el) => el.style.display),
      "none",
    );
    console.log(
      "[PASS] Apostrophe/quotes/HTML names round-trip through click; Escape closes modal",
    );
    await page.evaluate(() =>
      renderInternOriginCharts({
        byUniversity: [
          { name: "Khác", count: 4, percent: 40 },
          { name: "Đại học A", count: 6, percent: 60 },
        ],
        byMajor: [{ name: "Khác", count: 4, percent: 40 }],
      }),
    );
    assert.equal(
      await page.locator("#iorUniChartBody .ior-detail-trigger").count(),
      1,
    );
    assert.equal(
      await page.locator("#iorMajorChartBody .ior-detail-trigger").count(),
      0,
    );
    await page.evaluate(() =>
      renderInternOriginMatrix({
        matrix: {
          universities: ["Đại học A", "Khác"],
          majors: ["CNTT", "Khác"],
          data: {
            "Đại học A": { CNTT: 2, Khác: 1 },
            Khác: { CNTT: 3, Khác: 1 },
          },
          totals: {
            byUniversity: { "Đại học A": 3, Khác: 4 },
            byMajor: { CNTT: 5, Khác: 2 },
            grandTotal: 7,
          },
        },
      }),
    );
    assert.equal(
      await page.locator("#iorMatrixBody .ior-detail-trigger").count(),
      1,
    );
    assert.match(
      await page.locator("#iorMatrixBody tbody tr").nth(1).innerText(),
      /3/,
    );
    console.log(
      '[PASS] Nhóm "Khác" không bấm được ở biểu đồ và ma trận, ô ma trận vẫn hiện số',
    );
    await page.evaluate(() => {
      const majors = Array.from({ length: 30 }, (_, i) => `Chuyên ngành ${i}`);
      const data = Object.fromEntries(majors.map((m) => [m, 1]));
      renderInternOriginMatrix({
        matrix: {
          universities: ["Đại học Y"],
          majors,
          data: { "Đại học Y": data },
          totals: {
            byUniversity: { "Đại học Y": 30 },
            byMajor: data,
            grandTotal: 30,
          },
        },
      });
    });
    const sizes = await page.locator("#iorMatrixBody > div").evaluate((el) => {
      el.scrollLeft = 250;
      return {
        client: el.clientWidth,
        scroll: el.scrollWidth,
        left: el.scrollLeft,
        overflow: getComputedStyle(el).overflowX,
      };
    });
    assert.equal(sizes.overflow, "auto");
    assert.ok(sizes.scroll > sizes.client);
    assert.ok(sizes.left > 0);
    await page.screenshot({
      path: process.env.US5_SCREENSHOT || "/tmp/us5-matrix.png",
    });
    console.log("[PASS] 30-column matrix scrolls horizontally", sizes);
  } finally {
    await browser.close();
  }
}
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
