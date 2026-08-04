"use strict";

// Tiny static server for the dashboard.
//
// web/index.html is self-contained and normally opens straight from disk, but
// some browsers restrict file:// pages. If that happens, run:
//
//   npm run web
//
// No dependencies, nothing is built, the file is served exactly as it is.

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "web");
const PORT = Number(process.env.PORT) || 8080;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const rel = url === "/" ? "index.html" : url.replace(/^\/+/, "");

  // Resolve inside ROOT only, so a crafted path cannot escape the directory.
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(path.resolve(ROOT))) {
    res.writeHead(403).end("forbidden");
    return;
  }

  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  });
});

server.listen(PORT, () => {
  console.log(`NivGuard dashboard: http://localhost:${PORT}`);
  console.log("Ctrl+C to stop.");
});
