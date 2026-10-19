const fs = require("node:fs");
const path = require("node:path");
const FRONTEND_DIR = path.resolve(__dirname, "../../Frontend");
const TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};
// Returns null for API/other requests; static assets never fall through to mocked JSON.
function serveFrontendStatic(route) {
  const pathname = new URL(route.request().url()).pathname;
  if (
    !["/index.html", "/login.html", "/register.html"].includes(pathname) &&
    !pathname.startsWith("/assets/")
  )
    return null;
  let filename;
  try {
    filename = path.resolve(FRONTEND_DIR, "." + decodeURIComponent(pathname));
  } catch {
    return route.fulfill({ status: 400, body: "Invalid path" });
  }
  if (
    !filename.startsWith(FRONTEND_DIR + path.sep) ||
    !fs.existsSync(filename) ||
    !fs.statSync(filename).isFile()
  )
    return route.fulfill({ status: 404, body: "Not found" });
  return route.fulfill({
    contentType: TYPES[path.extname(filename)] || "application/octet-stream",
    body: fs.readFileSync(filename),
  });
}
function frontendScripts() {
  const html = fs.readFileSync(path.join(FRONTEND_DIR, "index.html"), "utf8");
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .map(([, attributes, inline]) => {
      const src = /\bsrc="([^"]+)"/.exec(attributes)?.[1];
      return src
        ? fs.readFileSync(path.join(FRONTEND_DIR, src.split("?")[0]), "utf8")
        : inline;
    })
    .join("\n");
}
function frontendStyles() {
  const html = fs
    .readFileSync(path.join(FRONTEND_DIR, "index.html"), "utf8")
    .split("</head>")[0];
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>|<link\b[^>]*>/g)]
    .map(([tag, inline]) => {
      if (inline !== undefined) return inline;
      const href = /\bhref="([^"]+)"/.exec(tag)?.[1];
      return /rel="stylesheet"/.test(tag) && href
        ? fs.readFileSync(path.join(FRONTEND_DIR, href.split("?")[0]), "utf8")
        : "";
    })
    .join("\n");
}
module.exports = {
  FRONTEND_DIR,
  serveFrontendStatic,
  frontendScripts,
  frontendStyles,
};
