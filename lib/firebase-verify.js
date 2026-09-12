// Firebase ID token verification using only Node's built-in crypto.
//
// Firebase ID tokens (from client-side sign-in) must be validated against the
// project's public signing keys, NOT Google's OAuth tokeninfo endpoint (which
// rejects them). This module:
//   1. Decodes the JWT (header + payload).
//   2. Checks aud == projectId, iss == securetoken.google.com/<project>,
//      exp not expired, and sub present.
//   3. Verifies the RS256 signature with the project's cached x509 certs.
//
// No third-party dependencies required (safe for cPanel).
const https = require("https");
const crypto = require("crypto");

const CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const CERTS_TTL_MS = 5 * 60 * 1000;

let cachedCerts = null;
let cachedAt = 0;

function fetchCertificates() {
  return new Promise((resolve) => {
    const req = https.get(CERTS_URL, { timeout: 8000 }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

function fromB64Url(str) {
  const b = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = b.length % 4 ? 4 - (b.length % 4) : 0;
  return Buffer.from(b + "=".repeat(pad), "base64");
}

// Returns the verified token payload ({ email, name, picture, aud, sub, ... })
// or null if the token is not a valid Firebase ID token for `projectId`.
function verifyFirebaseIdToken(idToken, projectId) {
  return new Promise((resolve) => {
    (async () => {
      try {
        const parts = String(idToken || "").split(".");
        if (parts.length !== 3) return resolve(null);

        const header = JSON.parse(fromB64Url(parts[0]).toString("utf8"));
        const payload = JSON.parse(fromB64Url(parts[1]).toString("utf8"));

        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < now) return resolve(null);
        if (!payload.sub) return resolve(null);
        if (payload.aud !== projectId) return resolve(null);
        if (payload.iss !== "https://securetoken.google.com/" + projectId) return resolve(null);

        const kid = header.kid;
        if (header.alg !== "RS256") return resolve(null);

        if (!cachedCerts || Date.now() - cachedAt > CERTS_TTL_MS) {
          cachedCerts = await fetchCertificates();
          cachedAt = Date.now();
        }
        if (!cachedCerts || !cachedCerts[kid]) return resolve(null);

        const publicKey = crypto.createPublicKey(cachedCerts[kid]);
        const data = Buffer.from(parts[0] + "." + parts[1], "utf8");
        const signature = fromB64Url(parts[2]);
        const valid = crypto.verify("RSA-SHA256", data, publicKey, signature);
        if (!valid) return resolve(null);

        resolve(payload);
      } catch (e) {
        resolve(null);
      }
    })();
  });
}

module.exports = { verifyFirebaseIdToken };
