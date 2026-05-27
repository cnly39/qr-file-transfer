const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");

const root = __dirname;
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT || 4177);
const httpsPort = Number(process.env.HTTPS_PORT || 4443);
const host = process.env.HOST || "0.0.0.0";
const certPath = process.env.TLS_CERT || path.join(root, "certs", "localhost-cert.pem");
const keyPath = process.env.TLS_KEY || path.join(root, "certs", "localhost-key.pem");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
};

function getLanUrls(protocol, selectedPort) {
  const os = require("os");
  const urls = [`${protocol}://127.0.0.1:${selectedPort}`];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`${protocol}://${entry.address}:${selectedPort}`);
      }
    }
  }
  return [...new Set(urls)];
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  res.end(body);
}

function readJson(req, maxBytes = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function serveFile(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);

  if (urlPath === "/vendor/jsQR.js") {
    const jsqrPath = path.join(root, "node_modules", "jsqr", "dist", "jsQR.js");
    fs.createReadStream(jsqrPath)
      .on("error", () => send(res, 404, "Not found"))
      .pipe(res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }));
    return;
  }

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

async function handleRequest(req, res) {
  try {
    if (req.method === "POST" && req.url === "/api/qr") {
      const { payload, errorCorrectionLevel } = await readJson(req, 12 * 1024);
      if (typeof payload !== "string" || payload.length < 1) {
        send(res, 400, JSON.stringify({ error: "Missing payload" }), "application/json; charset=utf-8");
        return;
      }

      const ec = ["L", "M", "Q", "H"].includes(errorCorrectionLevel) ? errorCorrectionLevel : "M";
      let qr;
      try {
        qr = QRCode.create(payload, { errorCorrectionLevel: ec });
      } catch (error) {
        send(res, 400, JSON.stringify({ error: `分片太大，${ec} 级纠错装不下：${error.message}` }), "application/json; charset=utf-8");
        return;
      }
      const size = qr.modules.size;
      const data = qr.modules.data;
      const packed = Buffer.alloc((data.length + 7) >> 3);
      for (let i = 0; i < data.length; i += 1) {
        if (data[i]) packed[i >> 3] |= 1 << (i & 7);
      }
      send(res, 200, JSON.stringify({ size, modules: packed.toString("base64") }), "application/json; charset=utf-8");
      return;
    }

    if (req.method === "GET") {
      serveFile(req, res);
      return;
    }

    send(res, 405, "Method not allowed");
  } catch (error) {
    send(res, 500, JSON.stringify({ error: error.message }), "application/json; charset=utf-8");
  }
}

const server = http.createServer(handleRequest);

server.listen(port, host, () => {
  console.log("HTTP server running:");
  for (const url of getLanUrls("http", port)) {
    console.log(`  ${url}`);
  }
  console.log("Set HOST=127.0.0.1 if you want local-only access again.");
});

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const httpsServer = https.createServer({
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  }, handleRequest);

  httpsServer.listen(httpsPort, host, () => {
    console.log("HTTPS server running:");
    for (const url of getLanUrls("https", httpsPort)) {
      console.log(`  ${url}`);
    }
  });
} else {
  console.log("HTTPS certificate not found. Run `npm run cert` to generate one.");
}
