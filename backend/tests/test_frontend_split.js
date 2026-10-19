// optionalBrowser: static HTTP, classic-script globals, inline handlers and all default role views.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const http = require("node:http");
const express = require("express");
const { chromium } = require("playwright");
const { FRONTEND_DIR, serveFrontendStatic } = require("./frontend_static");
const {
  preparePage,
  settle,
  scope,
  handlers,
} = require("./frontend_split_fixture");
async function main() {
  const html = fs.readFileSync(path.join(FRONTEND_DIR, "index.html"), "utf8");
  const tags = [...html.matchAll(/<(script|link)\b([^>]*)>/g)];
  const attributes = (value) =>
    Object.fromEntries(
      [...value.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
    );
  const scripts = tags
    .filter((m) => m[1] === "script")
    .map((m) => attributes(m[2]));
  const styles = tags
    .filter((m) => m[1] === "link")
    .map((m) => attributes(m[2]))
    .filter((a) => a.rel === "stylesheet");
  assert.ok(scripts.length > 1);
  assert.equal(scripts[0].src, "assets/js/core.js");
  assert.equal(scripts.at(-1).src, "assets/js/entry.js");
  assert.equal(
    /<style\b/i.test(html),
    false,
    "Static CSS is external; dynamic print styles stay in JS",
  );
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))
    assert.equal(match[1].trim(), "");
  const sources = [];
  for (const script of scripts) {
    assert.ok(script.src && !script.type && !script.defer && !script.async);
    const tag = tags.find(
      (m) => m[1] === "script" && attributes(m[2]).src === script.src,
    )[2];
    assert.ok(!/\b(?:defer|async)\b/.test(tag));
    const source = fs.readFileSync(path.join(FRONTEND_DIR, script.src), "utf8");
    assert.ok(source.split("\n").length <= 1500, script.src);
    new vm.Script(source, { filename: script.src });
    sources.push(source);
  }
  const names = sources.flatMap((source) =>
    [...source.matchAll(/^(?:async )?function ([\w$]+)\(/gm)].map((m) => m[1]),
  );
  assert.equal(
    new Set(names).size,
    names.length,
    "No duplicate top-level function names",
  );
  const app = express();
  app.use(express.static(FRONTEND_DIR));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const resource of [
      ...scripts.map((s) => s.src),
      ...styles.map((s) => s.href),
    ]) {
      const response = await fetch(`${origin}/${resource}`);
      assert.equal(response.status, 200, resource);
      assert.match(response.headers.get("content-type"), /(?:javascript|css)/);
      assert.equal(response.headers.get("cache-control"), "public, max-age=0");
      assert.deepEqual(
        Buffer.from(await response.arrayBuffer()),
        fs.readFileSync(path.join(FRONTEND_DIR, resource)),
      );
      const cachedStatus = await new Promise((resolve, reject) => {
        http
          .get(
            `${origin}/${resource}`,
            { headers: { "If-None-Match": response.headers.get("etag") } },
            (cached) => {
              cached.resume();
              resolve(cached.statusCode);
            },
          )
          .on("error", reject);
      });
      assert.equal(cachedStatus, 304, `${resource} revalidates`);
    }
    console.log(
      `[PASS] ${scripts.length} JS and ${styles.length} CSS files exist, compile and serve with ETag revalidation`,
    );
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
    });
    for (const role of ["HR", "Mentor", "Intern", "Admin"]) {
      const page = await browser.newPage({
        viewport: { width: 390, height: 900 },
        locale: "vi-VN",
        timezoneId: "Asia/Ho_Chi_Minh",
      });
      page.setDefaultTimeout(10000);
      const logs = { console: [], pageerror: [] },
        loaded = [];
      page.on("pageerror", (e) => logs.pageerror.push(e.message));
      page.on("console", (m) =>
        logs.console.push({ type: m.type(), text: m.text() }),
      );
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Debugger.enable");
      cdp.on("Debugger.scriptParsed", (event) => {
        if (event.url.startsWith("http://split.test/assets/js/"))
          loaded.push(new URL(event.url).pathname.slice(1));
      });
      await preparePage(page, role, { serveFrontendStatic });
      await settle(page);
      assert.deepEqual(
        loaded,
        scripts.map((s) => s.src),
        "Classic scripts execute in HTML order",
      );
      assert.deepEqual(logs.pageerror, []);
      assert.deepEqual(
        logs.console.filter((m) => ["error", "warning"].includes(m.type)),
        [],
      );
      const snapshot = {
        scope: await scope(page),
        handlers: await handlers(page),
        logs,
      };
      assert.deepEqual(
        await page.evaluate(
          (names) => names.filter((n) => typeof window[n] !== "function"),
          names,
        ),
        [],
      );
      const allHandlers = await handlers(
        page,
        html + "\n" + sources.join("\n"),
      );
      assert.deepEqual(
        allHandlers.missing,
        [],
        "Handlers in static HTML and generated HTML keep global function access",
      );
      const baselineDir = process.env.FRONTEND_SPLIT_BASELINE_DIR;
      if (baselineDir) {
        assert.deepEqual(
          snapshot,
          JSON.parse(fs.readFileSync(path.join(baselineDir, `${role}.json`))),
          role + " scope/handlers/logs unchanged",
        );
        assert.deepEqual(
          allHandlers,
          await handlers(
            page,
            fs.readFileSync(path.join(baselineDir, "index.html"), "utf8"),
          ),
          "Static and generated inline handlers unchanged from the original source",
        );
      }
      for (const width of [390, 768, 1366]) {
        await page.setViewportSize({ width, height: 900 });
        const image = await page.screenshot({
          animations: "disabled",
          caret: "hide",
        });
        if (baselineDir)
          assert.deepEqual(
            image,
            fs.readFileSync(path.join(baselineDir, `${role}-${width}.png`)),
            `${role}-${width}: unchanged pixels`,
          );
      }
      console.log(
        `[PASS] ${role}: ${names.length} declared functions and ${allHandlers.names.length} inline call targets available; classic order, console, 390/768/1366px${baselineDir ? "; baseline scope and screenshots identical" : ""}`,
      );
      await cdp.detach();
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
