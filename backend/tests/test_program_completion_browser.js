// Optional real-browser + real-API test; writes only its own fixtures in a guarded test DB.
/* global document, programItems, programMentorOpen, switchTab */
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const { chromium } = require("playwright");
const { BASE_URL, readDbConfig } = require("./test_helpers");
async function main() {
  const cfg = readDbConfig();
  if (
    process.env.US6_TEST_DB_ALLOW_WRITES !== "1" ||
    !/^us6_test_[A-Za-z0-9_]+$/.test(cfg.database)
  )
    throw new Error(
      "Requires a dedicated us6_test_* DB and US6_TEST_DB_ALLOW_WRITES=1.",
    );
  const conn = await mysql.createConnection(cfg),
    prefix = "US6_UI_" + Date.now();
  let browser, department, intern;
  const programs = [];
  const login = await (
    await fetch(BASE_URL + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account: "hr@company.com",
        password: "password123",
      }),
    })
  ).json();
  assert.ok(login.token);
  async function call(url, body) {
    const res = await fetch(BASE_URL + url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + login.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    assert.ok(res.ok, await res.clone().text());
    return res.json();
  }
  try {
    const [d] = await conn.query("INSERT INTO departments (name) VALUES (?)", [
      prefix,
    ]);
    department = d.insertId;
    for (const [label, start, end] of [
      ["A", "2018-01-01", "2018-01-31"],
      ["B", "2018-02-01", "2018-02-28"],
    ]) {
      const r = await call("/programs", {
        department_id: department,
        name: prefix + " " + label + " O'Brien <>&",
        start_date: start,
        end_date: end,
        status: "CLOSED",
        capacity: 5,
      });
      programs.push(r.data.id);
    }
    const [person] = await conn.query(
      "INSERT INTO intern_profiles (full_name,email,status) VALUES (?,?,'Hoàn thành')",
      [prefix + " O'Brien <>&", prefix + "@example.test"],
    );
    intern = person.insertId;
    await call(`/programs/${programs[0]}/interns`, { intern_ids: [intern] });
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("https://**/*", (route) => route.abort());
    await page.addInitScript((token) => {
      sessionStorage.setItem("authToken", token);
      sessionStorage.setItem(
        "currentUser",
        JSON.stringify({ role: "HR", name: "HR", email: "hr@company.com" }),
      );
    }, login.token);
    await page.goto(new URL("/index.html", BASE_URL).href);
    await page.locator("#crHubCard").waitFor({ state: "visible" });
    await page.evaluate(
      ({ id, name }) => {
        programItems = [{ id, name }];
        return programMentorOpen(programItems[0].id);
      },
      { id: programs[0], name: prefix + " A O'Brien <>&" },
    );
    await page.locator(".pm-save-result").waitFor();
    assert.equal(
      await page.locator(".pm-result select").inputValue(),
      "IN_PROGRESS",
    );
    await page.locator(".pm-result select").selectOption("COMPLETED");
    await page.locator(".pm-result input").fill("HR xác nhận khóa A");
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator(".pm-save-result").click();
    await page.waitForFunction(() =>
      document
        .querySelector(".pm-result")
        ?.textContent.includes("HR xác nhận khóa A"),
    );
    assert.equal(await page.locator(".pm-save-result").count(), 0);
    assert.ok(await page.locator("#pmRows button.btn-danger").isDisabled());
    if (process.env.US6_UI_SCREENSHOT)
      await page.screenshot({ path: process.env.US6_UI_SCREENSHOT });
    await call(`/programs/${programs[1]}/interns`, { intern_ids: [intern] });
    await page.evaluate(() => {
      document.getElementById("programMentorModal").style.display = "none";
      switchTab("tab-completion-rate");
    });
    await page.locator("#crExport").waitFor({ state: "visible" });
    await page.locator("#crQ").fill(prefix);
    await page.locator("#crFilters button[type=submit]").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#crSummary .stat-card h3")?.textContent === "2",
    );
    assert.deepEqual(
      await page.locator("#crSummary .stat-card h3").allTextContents(),
      ["2", "1", "1", "0", "50.0%"],
    );
    const a = page.locator(`#crPrograms .cr-group[data-key="${programs[0]}"]`),
      b = page.locator(`#crPrograms .cr-group[data-key="${programs[1]}"]`);
    assert.match(await a.innerText(), /100\.0%/);
    assert.match(await b.innerText(), /0\.0%/);
    assert.equal(await page.locator("#crPrograms img").count(), 0);
    await a.click();
    await page.locator("#crDetails table").waitFor();
    assert.ok(
      (await page.locator("#crDetails").innerText()).includes(
        "HR xác nhận khóa A",
      ),
    );
    await page.keyboard.press("Escape");
    const [[result]] = await conn.query(
      "SELECT completion_status,completed_at,completed_by FROM program_interns WHERE program_id=? AND intern_id=?",
      [programs[0], intern],
    );
    assert.equal(result.completion_status, "COMPLETED");
    assert.ok(result.completed_at);
    assert.ok(result.completed_by);
    assert.deepEqual(errors, []);
    console.log(
      "[PASS] Real Chromium/API/MySQL: HR confirms A, A history locked, B starts active, report 2 enrollments/1 person/50%, drill-down and escaped names.",
    );
  } finally {
    if (browser) await browser.close();
    if (programs.length) {
      await conn.query("DELETE FROM program_interns WHERE program_id IN (?)", [
        programs,
      ]);
      await conn.query("DELETE FROM internship_programs WHERE id IN (?)", [
        programs,
      ]);
    }
    if (intern)
      await conn.query("DELETE FROM intern_profiles WHERE id=?", [intern]);
    if (department)
      await conn.query("DELETE FROM departments WHERE id=?", [department]);
    await conn.end();
  }
}
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
