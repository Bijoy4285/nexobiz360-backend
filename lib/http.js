const zlib = require('zlib');

const MAX_BODY_BYTES = 16 * 1024 * 1024;
const AUTH_BODY_LIMIT = 100 * 1024;
const SMALL_BODY_PATHS = [
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/google",
  "/api/auth/forgot-password",
  "/api/auth/reset-password"
];

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Content-Encoding": "gzip"
  };

  zlib.gzip(body, function (err, compressed) {
    if (err) {
      // Compression fail করলে normal ভাবে পাঠানো (fallback, safe)
      res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
      });
      res.end(body);
      return;
    }
    res.writeHead(statusCode, headers);
    res.end(compressed);
  });
}

function bodyLimitFor(req) {
  const p = String(req.url || "").split("?")[0];
  return SMALL_BODY_PATHS.indexOf(p) >= 0 ? AUTH_BODY_LIMIT : MAX_BODY_BYTES;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const limit = bodyLimitFor(req);
    const declared = Number((req.headers && req.headers["content-length"]) || 0);
    if (declared > limit) {
      reject(new Error("Payload too large"));
      return;
    }
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", chunk => {
      if (tooLarge) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        reject(new Error("Payload too large"));
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (tooLarge) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      req.rawBody = raw;
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

module.exports = { json, parseBody };
