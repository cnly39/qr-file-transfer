const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4177);
const publicDir = path.join(__dirname, "public");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon",
};

function getLanUrls() {
  const urls = [`http://127.0.0.1:${port}`];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254.")) {
        urls.push(`http://${entry.address}:${port}`);
      }
    }
  }
  return [...new Set(urls)];
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function serveFile(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const urlPath = decodeURIComponent(requestUrl.pathname);
  const normalized = path.normalize(urlPath === "/" ? "/index.html" : urlPath);
  const filePath = path.join(publicDir, normalized);

  if (!filePath.startsWith(publicDir)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      send(res, 404, "Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" || req.method === "HEAD") {
    serveFile(req, res);
    return;
  }
  send(res, 405, "Method not allowed");
});

server.listen(port, host, () => {
  console.log("QR File Transfer is running.");
  console.log("Open one of these URLs in a browser:");
  for (const url of getLanUrls()) {
    console.log(`  ${url}`);
  }
  console.log("");
  console.log("Press Ctrl+C to stop.");
});
