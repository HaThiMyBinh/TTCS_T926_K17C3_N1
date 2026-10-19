// Shared deterministic API data for the before/after comparison and split smoke test.
const permissions = {
  Admin: ["MANAGE_USERS", "SYSTEM_SETTINGS"],
  HR: ["VIEW_REPORTS"],
  Mentor: ["ASSIGN_TASKS"],
  Intern: ["SUBMIT_WORK"],
};
function fixture(pathname) {
  if (pathname === "/api/permissions") return permissions;
  if (
    [
      "/api/users",
      "/api/mentors",
      "/api/tasks",
      "/api/me/interns",
      "/api/students",
    ].includes(pathname)
  )
    return [];
  if (pathname === "/api/applications/me/documents")
    return {
      success: true,
      data: {
        application: { status: "PENDING", is_locked: false },
        documents: [],
        progress: { totalUploaded: 0, percent: 0, isComplete: false },
      },
    };
  if (pathname === "/api/notifications")
    return { data: { unread: 0, items: [] } };
  return {
    success: true,
    data: [],
    applications: { total: 0, pending: 0, approved: 0, rejected: 0 },
    interns: { total: 0, assigned: 0 },
    contracts: { total: 0, confirmed: 0 },
    rates: {
      applicationApproval: 0,
      contractConfirmation: 0,
      internMentorAssigned: 0,
    },
  };
}
async function preparePage(page, role, { serveFrontendStatic }) {
  await page.clock.install({ time: new Date("2026-10-17T01:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-17T01:00:00Z"));
  await page.addInitScript((role) => {
    sessionStorage.setItem("authToken", "frontend-split-test");
    sessionStorage.setItem(
      "currentUser",
      JSON.stringify({
        id: 1,
        role,
        name: role + " Nguyễn",
        email: role.toLowerCase() + "@example.test",
      }),
    );
  }, role);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "split.test") return route.abort();
    const served = serveFrontendStatic(route);
    if (served) return served;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(fixture(url.pathname)),
    });
  });
}
async function settle(page) {
  await page.goto("http://split.test/index.html");
  await page.waitForFunction(
    () => document.querySelectorAll("#sidebarMenu .nav-link").length > 0,
  );
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}
async function scope(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Runtime.enable");
  const { names } = await cdp.send("Runtime.globalLexicalScopeNames");
  const functions = await page.evaluate(() =>
    Object.getOwnPropertyNames(window)
      .filter((n) => {
        try {
          return typeof window[n] === "function";
        } catch {
          return false;
        }
      })
      .sort(),
  );
  await cdp.detach();
  return { functions, lexical: names.sort() };
}
async function handlers(page, extraSource = "") {
  return page.evaluate((source) => {
    const reserved = new Set([
        "if",
        "for",
        "while",
        "switch",
        "catch",
        "function",
        "return",
        "with",
      ]),
      code = [];
    for (const el of document.querySelectorAll("*"))
      for (const a of el.attributes)
        if (/^on/i.test(a.name)) code.push(a.value);
    for (const match of source.matchAll(/\bon[a-z]+\s*=\s*(["'])([\s\S]*?)\1/g))
      code.push(match[2]);
    const names = [
      ...new Set(
        code
          .flatMap((s) =>
            [...s.matchAll(/(?<![\w$.])([a-zA-Z_$][\w$]*)\s*\(/g)].map(
              (m) => m[1],
            ),
          )
          .filter((n) => !reserved.has(n)),
      ),
    ].sort();
    return {
      count: code.length,
      names,
      missing: names.filter((n) => {
        try {
          return typeof (0, eval)(n) !== "function";
        } catch {
          return true;
        }
      }),
    };
  }, extraSource);
}
module.exports = { preparePage, settle, scope, handlers };
