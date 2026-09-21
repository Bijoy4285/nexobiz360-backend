const http = require("http");
const fs = require("fs");
const path = require("path");

try { require("dotenv").config(); } catch (e) {}

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.resolve(__dirname, "..");
const BOOT_STATUS_FILE = path.join(ROOT, "backend-status.txt");

// Writes startup status to a file in the web root so it can be read in a
// browser at https://domain/backend-status.txt (no terminal required).
function writeBootStatus(msg) {
  try { fs.writeFileSync(BOOT_STATUS_FILE, msg + "\n", "utf8"); } catch (e) {}
}
writeBootStatus("BOOTING " + new Date().toISOString());

const { readDb, writeDb, initDb } = require("./lib/db");
const { restoreAllDbFiles, backupAllDbFiles } = require("./lib/sqlite-cloud-sync");
const { json, parseBody } = require("./lib/http");
const { makeUser, makeGoogleUser, verifyPassword, createPasswordHash, sanitizeUser, createSession, getSessionUser, requireAdmin, isAdminEmail, ADMIN_EMAILS, isSubscriptionActive, getSubscriptionDaysLeft, setSubscription, migrateUsers } = require("./lib/auth");
const { seedAdmins } = require("./services/seed");
const { recordSystemLog, recordMonitoringEvent, getMonitoringStatus } = require("./services/monitoring");
const { runAgentCycle } = require("./services/ai-agent");
const { handleTool } = require("./services/tool-handlers");
const { createTicket, addTicketMessage, summarizeTicket, updateTicketPriority } = require("./services/ticketing");
const { initEcosystemDb, migrateLegacyData, SQLITE_OK: ECO_SQLITE_OK, SQLITE_DRIVER: ECO_SQLITE_DRIVER } = require("./lib/ecosystem-db");
const { handleEcosystem } = require("./services/ecosystem-api");
const { createRole, getUserRole, getUserPermissions, hasPermission, requirePermission, listRoles } = require("./lib/rbac");
const { isStripeConfigured, createCheckoutSession, createPaymentIntent, recordPayment } = require("./services/payments");
const { sendEmail, sendSMS, notifyOrderUpdate, notifyBookingUpdate, isGmailConfigured } = require("./services/notifications");
const { exportToCSV, exportToJSON, parseImportFile, getModuleData } = require("./services/export-import");
const { isWhatsAppConfigured, sendWhatsAppMessage, processWebhookPayload, broadcastMessage } = require("./services/whatsapp-ai");
const { aiChat, generateReport, predictSales, isAIConfigured } = require("./services/ai-provider");

const PUBLIC_FILES = new Set([
  ".env.example",
  ".firebaserc",
  "oceansft-logo.jpeg",
  "account.html",
  "accounting.html",
  "admin-login.html",
  "admin.html",
  "alph-nexxus.png",
  "app-api.js",
  "barber-shop.html",
  "components.css",
  "components.js",
  "crm.html",
  "dashboard.html",
  "error-handler.js",
  "favicon.ico",
  "firebase-config.js",
  "gym.html",
  "hotel.html",
  "hr-payroll.html",
  "hr-payroll-accounting.html",
  "index.html",
  "invoice.html",
  "laundry.html",
  "locator.html",
  "login.html",
  "loyalty.html",
  "marketing.html",
  "medicines.json",
  "monitoring-client.js",
  "ocean-sft-logo.png",
  "onboarding.html",
  "owner-account.html",
  "parking.html",
  "pharmacy-pos.html",
  "pos.html",
  "qr-menu.html",
  "restaurant.html",
  "scanner.html",
  "store.html",
  "supply-chain.html",
  "supershop.html",
  "supershop-dashboard.html",
  "sync-client.js",
  "tailor.html",
  "tool1.png",
  "tool2.png",
  "tool3.png",
  "warehouses.html",
  "warehouse-shared.js",
  "food-detail.html",
  "website-builder.html",
  "whatsapp.html",
  "version.json",
  "user-onboarding.html",
  "backend-status.txt"
]);

function applyCors(req, res) {
  const origin = req.headers.origin || "";
  const host = req.headers.host || "";
  const allowed = !origin || origin.indexOf("://" + host) !== -1 || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (allowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "false");
  }
  return allowed;
}

const RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  maxAttempts: 10,
  hits: new Map()
};

function rateLimited(ip, key) {
  const now = Date.now();
  const bucketKey = ip + "|" + key;
  const entry = RATE_LIMIT.hits.get(bucketKey);
  if (!entry || now - entry.start > RATE_LIMIT.windowMs) {
    RATE_LIMIT.hits.set(bucketKey, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT.maxAttempts) {
    RATE_LIMIT.hits.delete(bucketKey);
    return true;
  }
  return false;
}

function verifyGoogleToken(credential) {
  const projectId = process.env.FIREBASE_PROJECT_ID || "ocensft";
  return new Promise((resolve) => {
    // Prefer Firebase ID-token verification (client Firebase sign-in).
    require("./lib/firebase-verify")
      .verifyFirebaseIdToken(credential, projectId)
      .then((firebaseInfo) => {
        if (firebaseInfo) {
          return resolve(Object.assign({}, firebaseInfo, { firebase: true }));
        }
        // Fallback: Google OAuth ID token (web-client sign-in).
        const https = require("https");
        const url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential);
        const req = https.get(url, { timeout: 6000 }, (res) => {
          let body = "";
          res.on("data", c => { body += c; });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(body);
              resolve(parsed && parsed.error ? null : parsed);
            } catch (e) { resolve(null); }
          });
        });
        req.on("error", () => resolve(null));
        req.on("timeout", () => { req.destroy(); resolve(null); });
      })
      .catch(() => resolve(null));
  });
}

function isValidGoogleAudience(aud) {
  const expected = process.env.GOOGLE_CLIENT_ID;
  if (expected) return String(aud) === expected;
  // Fallback: ensure the token was minted for a Google web (OAuth) client.
  // Google web client IDs look like "<senderId>-<random>.apps.googleusercontent.com".
  return /^\d+[A-Za-z0-9-]*\.apps\.googleusercontent\.com$/.test(String(aud || ""));
}

function verifyWebhookSignature(req) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (appSecret) {
    const crypto = require("crypto");
    const signature = req.headers["x-hub-signature-256"] || "";
    const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(req.rawBody || "").digest("hex");
    const a = Buffer.from(signature, "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "ocean-sft-verify";
  let param = "";
  try { param = new URL(req.url, "http://localhost").searchParams.get("verify_token") || ""; } catch (e) {}
  return param === verifyToken;
}

async function bootDb() {
  await initDb();
  const db = readDb();
  seedAdmins(db);
  migrateUsers(db.users);
  writeDb(db);

  // Restore SQLite store files from MongoDB before using them.
  await restoreAllDbFiles();

  initEcosystemDb();
  migrateLegacyData();

  // Backup every 5 minutes so recent store data is never lost.
  setInterval(function () {
    backupAllDbFiles().catch(function (e) {
      console.error("[sqlite-cloud-sync] periodic backup failed:", e.message);
    });
  }, 5 * 60 * 1000);

  // Backup immediately when Render sends a shutdown signal
  // (this happens right before every redeploy/restart/sleep).
  var shuttingDown = false;
  function handleShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("[sqlite-cloud-sync] " + signal + " received — backing up before shutdown...");
    backupAllDbFiles()
      .then(function () {
        console.log("[sqlite-cloud-sync] Final backup complete.");
        process.exit(0);
      })
      .catch(function (e) {
        console.error("[sqlite-cloud-sync] Final backup failed:", e.message);
        process.exit(0);
      });
  }
  process.on("SIGTERM", function () { handleShutdown("SIGTERM"); });
  process.on("SIGINT", function () { handleShutdown("SIGINT"); });
}

function resolveFilePath(urlPath) {
  let cleaned = urlPath.split("?")[0].split("#")[0];
  cleaned = decodeURIComponent(cleaned);
  cleaned = cleaned.replace(/^(\.\.[/\\])+/, "");
  cleaned = path.normalize(cleaned);
  cleaned = cleaned.replace(/^[/\\]+/, "");

if (!PUBLIC_FILES.has(cleaned) && !PUBLIC_FILES.has(cleaned + ".html")) {
    return null;
  }

  let filePath = path.join(ROOT, cleaned);
  if (filePath.startsWith(ROOT) && fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
    return filePath;
  }

  if (!path.extname(filePath)) {
    filePath = path.join(ROOT, cleaned + ".html");
    if (filePath.startsWith(ROOT) && fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
      return filePath;
    }
  }

  return null;
}

function serveStatic(req, res) {
const requested = req.url === "/" ? "/index.html" : req.url;
  const urlPath = requested.split("?")[0].split("#")[0];

  // Canonical clean URLs: drop ".html" so visitors never see it.
  // /locator.html  ->  /locator   (301, permanent, keeps query string)
  if (urlPath !== "/" && urlPath !== "/index.html" && urlPath.endsWith(".html")) {
    const clean = urlPath.slice(0, -5);
    const query = requested.includes("?") ? requested.slice(requested.indexOf("?")) : "";
    res.writeHead(301, { "Location": (clean || "/") + query });
    res.end();
    return;
  }

  const filePath = resolveFilePath(requested);

  if (!filePath) {
    // Never return 404 — redirect to login instead
    // This prevents Edge from caching stale "Not found" responses
    res.writeHead(302, { "Location": "/login" });
    res.end();
    return;
  }

  const ext = path.extname(filePath).toLowerCase();

  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".md": "text/markdown; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
  };

  const headers = { "Content-Type": types[ext] || "application/octet-stream" };
  if (ext === ".html") {
    headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate";
    headers["Pragma"] = "no-cache";
    headers["Expires"] = "0";
  }
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

function apiSummary(db) {
  return {
    tickets: db.tickets.slice(0, 100),
    ticket_messages: db.ticket_messages.slice(0, 200),
    incidents: db.incidents.slice(0, 100),
    ai_actions: db.ai_actions.slice(0, 200),
    alerts: db.alerts.slice(0, 100),
    monitoring_events: db.monitoring_events.slice(0, 200),
    system_logs: db.system_logs.slice(0, 100),
    escalation_queue: db.escalation_queue.slice(0, 100),
    monitoring_status: getMonitoringStatus(db)
  };
}

bootDb().catch(function(e) {
  writeBootStatus("BOOT FAILED (node " + process.version + "): " + (e && e.stack ? e.stack : e));
  process.exit(1);
});

// ============ SUBSCRIPTION CRON ============
// Scans every hour for expiring/expired subscriptions and sends emails.
function runSubscriptionCron() {
  try {
    var db2 = readDb();
    var emailTemplates = require("./services/email-templates");
    var now = Date.now();
    var DAY_MS = 24 * 60 * 60 * 1000;
    var sentKey = "_cron_emails_sent";
    var sent = {};
    try { sent = JSON.parse(db2[sentKey] || "{}"); } catch(e) { sent = {}; }

    db2.users.forEach(function(u) {
      if (!u.email || isAdminEmail(u.email)) return;
      if (!u.paid || u.plan === "Free") return;
      if (!u.subscriptionExpiry) return;
      var expiryMs = new Date(u.subscriptionExpiry).getTime();
      if (isNaN(expiryMs)) return;
      var daysLeft = Math.ceil((expiryMs - now) / DAY_MS);
      var emailKey = u.email + "_";
      var expiryDate = new Date(u.subscriptionExpiry).toLocaleDateString();
      var planLabel = u.company || u.email.split("@")[0];

      // 7-day reminder (range so restarts never miss it)
      if (daysLeft > 3 && daysLeft <= 7 && !sent[emailKey + "7d"]) {
        sendEmail(u.email, "Subscription expires in " + daysLeft + " days - Ocean SFT", emailTemplates.subscriptionRenewalReminderEmail(planLabel, daysLeft, expiryDate)).catch(function(){});
        sent[emailKey + "7d"] = now;
      }
      // 3-day reminder (range so restarts never miss it)
      if (daysLeft > 1 && daysLeft <= 3 && !sent[emailKey + "3d"]) {
        sendEmail(u.email, "Subscription expires in " + daysLeft + " days - Ocean SFT", emailTemplates.subscriptionRenewalReminderEmail(planLabel, daysLeft, expiryDate)).catch(function(){});
        sent[emailKey + "3d"] = now;
      }
      // 1-day reminder (range so restarts never miss it)
      if (daysLeft === 1 && !sent[emailKey + "1d"]) {
        sendEmail(u.email, "Subscription expires tomorrow - Ocean SFT", emailTemplates.subscriptionRenewalReminderEmail(planLabel, 1, expiryDate)).catch(function(){});
        sent[emailKey + "1d"] = now;
      }
      // Expired notification
      if (daysLeft <= 0 && !sent[emailKey + "expired"]) {
        sendEmail(u.email, "Subscription expired - Ocean SFT", emailTemplates.subscriptionExpiredEmail(planLabel, expiryDate)).catch(function(){});
        sent[emailKey + "expired"] = now;
      }
    });
    db2[sentKey] = JSON.stringify(sent);
    writeDb(db2);
  } catch(e) {
    console.error("Subscription cron error:", e.message);
  }
}

// Every hour, reminds owners about store-registration payments still pending
// (payment due), escalating only once per payment so it never spams.
function runPaymentDueCron() {
  try {
    var emailTemplates = require("./services/email-templates");
    var ecoLib = require("./lib/ecosystem-db");
    var ecoDb = ecoLib.getDb();
    var now = Date.now();
    var DAY_MS = 24 * 60 * 60 * 1000;
    var dueDb = readDb();
    var sentKey = "_pay_due_sent";
    var sent = {};
    try { sent = JSON.parse(dueDb[sentKey] || "{}"); } catch(e) { sent = {}; }
    var pending;
    try { pending = ecoDb.prepare("SELECT * FROM payments WHERE status = 'pending'").all(); } catch(e) { pending = []; }
    var changed = false;
    pending.forEach(function(p) {
      if (!p.email) return;
      var key = String(p.id);
      var created = new Date(p.created_at || now);
      var daysOld = Math.floor((now - created.getTime()) / DAY_MS);
      if (daysOld < 2 || sent[key]) return; // give 48h before nudging, then once
      var storeName = '';
      try { var s = ecoDb.prepare('SELECT name FROM stores WHERE id = ?').get(p.store_id || ''); storeName = s ? s.name : ''; } catch(e){}
      var mods = '';
      try { var arr = JSON.parse(p.module_names || '[]'); mods = (Array.isArray(arr) ? arr : []).join(', '); } catch(e) {}
      sendEmail(p.email, "Action Required: Your payment is still pending - Ocean SFT",
        emailTemplates.paymentDueEmail(p.email, p.amount, null, storeName, p.id, mods)).catch(function(){});
      sent[key] = now;
      changed = true;
    });
    ecoDb.close();
    if (changed) { dueDb[sentKey] = JSON.stringify(sent); writeDb(dueDb); }
  } catch(e) {
    console.error("Payment due cron error:", e.message);
  }
}

// Every few hours, scans all stores' inventory and alerts the owner when an
// item's stock is low. Uses reg.stores owner emails so it keeps running 24/7.
function runLowStockCron() {
  try {
    var notify = require("./services/notifications");
    var ecoLib = require("./lib/ecosystem-db");
    var ecoDb = ecoLib.getDb();
    var stores = [];
    try { stores = ecoDb.prepare('SELECT * FROM stores WHERE is_active = 1').all(); } catch(e) { stores = []; }
    var sentDb = readDb();
    var users = sentDb.users || [];
    var sentKey = "_lowstock_sent";
    var sent = {};
    try { sent = JSON.parse(sentDb[sentKey] || "{}"); } catch(e) { sent = {}; }
    var changed = false;
    var now = Date.now();
    var RESEND_MS = 6 * 60 * 60 * 1000; // re-alert at most every 6h per item
    stores.forEach(function(st) {
      var items = [];
      try { items = ecoDb.prepare('SELECT id, name, stock_qty FROM menu_items WHERE store_id = ? AND stock_qty >= 0 AND stock_qty <= 5').all(st.id); } catch(e) { items = []; }
      items.forEach(function(it) {
        var key = String(st.id) + '|' + String(it.id);
        var last = sent[key] || 0;
        if (now - last < RESEND_MS) return;
        var owner = st.owner_id;
        var ownerEmail = '';
        try { var u = users.find(function(x){ return String(x.id) === String(owner) || (x.email && x.email.toLowerCase() === String(owner).toLowerCase()); }); ownerEmail = u ? u.email : ''; } catch(e){}
        notify.notifyLowStock(null, it.name, it.stock_qty, st.name);
        if (ownerEmail) {
          try { notify.sendEmail(ownerEmail, 'Low Stock Alert - ' + st.name, require('./services/email-templates').notificationEmail('Low Stock', '<p>' + it.name + ' has only <strong>' + it.stock_qty + '</strong> units left at <strong>' + st.name + '</strong>.</p>')).catch(function(){}); } catch(e){}
        }
        sent[key] = now;
        changed = true;
      });
    });
    ecoDb.close();
    if (changed) { sentDb[sentKey] = JSON.stringify(sent); writeDb(sentDb); }
  } catch(e) {
    console.error("Low stock cron error:", e.message);
  }
}

// Run on boot (after 60s delay) then every hour
setTimeout(runSubscriptionCron, 60 * 1000);
setInterval(runSubscriptionCron, 60 * 60 * 1000);
// Payment-due reminders: every hour
setTimeout(runPaymentDueCron, 90 * 1000);
setInterval(runPaymentDueCron, 60 * 60 * 1000);
// Low-stock alerts: every 3 hours
setTimeout(runLowStockCron, 120 * 1000);
setInterval(runLowStockCron, 3 * 60 * 60 * 1000);

const server = http.createServer(async (req, res) => {
 res.setHeader("Access-Control-Allow-Origin", "https://weavestackit.online");
res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("ETag", '"' + Date.now() + '"');
  if (req.method === "OPTIONS") return json(res, 200, { ok: true });

  const urlPath = req.url.split("?")[0];

  try {
  const db = readDb();
  const user = getSessionUser(db, req);

  if (urlPath === "/api/auth/signup" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const company = String(body.company || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const phone = String(body.phone || "").trim();
      const country = String(body.country || "").trim();
      const password = String(body.password || "").trim();
      const identifier = email || phone;
      if (!company || !identifier || !password) return json(res, 400, { error: "Missing required fields." });
      if (password.length < 6) return json(res, 400, { error: "Password must be at least 6 characters." });
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: "Invalid email address." });
      if (phone && !/^[+]?[\d\s()-]{7,20}$/.test(phone)) return json(res, 400, { error: "Invalid phone number." });
      if (db.users.some(item => item.email && item.email === email)) return json(res, 409, { error: "Email already registered." });
      if (phone && db.users.some(item => item.phone && item.phone === phone)) return json(res, 409, { error: "Phone number already registered." });
      const next = makeUser(company, email, phone, country, password, false);
      db.users.push(next);
      db.storage[next.id] = {};
      const token = createSession(db, next.id);
      writeDb(db);
      // Send welcome email (non-blocking, branded Ocean SFT template)
      if (email) {
        const emailTemplates = require("./services/email-templates");
        sendEmail(email, "Welcome to Ocean SFT 👋", emailTemplates.welcomeEmail(company, email)).catch(function(){});
      }
      return json(res, 201, { ok: true, token, user: sanitizeUser(next) });
    } catch (error) {
      console.error('SIGNUP ERROR:', error);
      return json(res, 400, { error: "Invalid signup payload." });
    }
  }

  if (urlPath === "/api/auth/login" && req.method === "POST") {
    try {
      const ip = req.socket.remoteAddress || "unknown";
      if (rateLimited(ip, "login")) return json(res, 429, { error: "Too many login attempts. Try again later." });
      const body = await parseBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const phone = String(body.phone || "").trim();
      const password = String(body.password || "").trim();
      const found = db.users.find(item => (email && item.email === email) || (phone && item.phone === phone));
      if (!found || !verifyPassword(found, password)) return json(res, 401, { error: "Invalid email/phone or password." });
      const token = createSession(db, found.id);
      writeDb(db);
      return json(res, 200, { ok: true, token, user: sanitizeUser(found) });
    } catch (error) {
      return json(res, 400, { error: "Invalid login payload." });
    }
  }

  if (urlPath === "/api/auth/me" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    return json(res, 200, { ok: true, user: sanitizeUser(user) });
  }

if (urlPath === "/api/auth/logout" && req.method === "POST") {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    db.sessions = db.sessions.filter(item => item.token !== token);
    writeDb(db);
    return json(res, 200, { ok: true });
  }

  if (urlPath === "/api/auth/profile" && req.method === "PUT") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    try {
      const body = await parseBody(req);
      const nextCompany = String(body.company == null ? user.company : body.company).trim();
      const nextPhone = String(body.phone == null ? user.phone : body.phone).trim();
      const nextCountry = String(body.country == null ? user.country : body.country).trim();
      const nextPhoto = String(body.photoURL == null ? (user.photoURL || "") : body.photoURL).trim();
      if (nextPhone && !/^[+]?[\d\s()-]{7,20}$/.test(nextPhone)) return json(res, 400, { error: "Invalid phone number." });
      if (nextPhoto && !/^https?:\/\//.test(nextPhoto)) return json(res, 400, { error: "Photo URL must start with http(s)." });
      if (nextCompany) user.company = nextCompany;
      user.phone = nextPhone;
      user.country = nextCountry;
      user.photoURL = nextPhoto;
      if (body.currentPassword && body.newPassword) {
        if (!verifyPassword(user, String(body.currentPassword))) return json(res, 401, { error: "Current password is incorrect." });
        if (String(body.newPassword).length < 6) return json(res, 400, { error: "New password must be at least 6 characters." });
        if (String(body.newPassword) !== String(body.confirmPassword)) return json(res, 400, { error: "Passwords do not match." });
        user.salt = require("crypto").randomBytes(16).toString("hex");
        user.passwordHash = createPasswordHash(String(body.newPassword), user.salt);
      }
      writeDb(db);
      return json(res, 200, { ok: true, user: sanitizeUser(user) });
    } catch (error) {
      return json(res, 400, { error: "Invalid profile payload." });
    }
  }

  if (urlPath === "/api/auth/settings" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    return json(res, 200, { ok: true, settings: user.settings || {} });
  }

  if (urlPath === "/api/auth/settings" && req.method === "PUT") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    try {
      const body = await parseBody(req);
      if (!user.settings || typeof user.settings !== "object") user.settings = {};
      Object.keys(body).forEach(function(k) {
        if (k === "id" || k === "email") return;
        user.settings[k] = body[k];
      });
      writeDb(db);
      return json(res, 200, { ok: true, settings: user.settings });
    } catch (error) {
      return json(res, 400, { error: "Invalid settings payload." });
    }
  }

  if (urlPath === "/api/auth/google" && req.method === "POST") {
    try {
      const ip = req.socket.remoteAddress || "unknown";
      if (rateLimited(ip, "google")) return json(res, 429, { error: "Too many attempts. Try again later." });
      const body = await parseBody(req);
      const credential = String(body.credential || "").trim();
      // A valid Google ID token is REQUIRED for both login and signup.
      // We never trust client-supplied email/name for existing accounts.
      if (!credential) return json(res, 400, { error: "A valid Google credential is required." });

      const info = await verifyGoogleToken(credential);
      if (!info || !info.email) return json(res, 401, { error: "Invalid Google credential." });
      // Firebase ID tokens identify the token by projectId (info.aud === projectId);
      // Google OAuth tokens identify it by an OAuth web-client id. Only enforce the
      // OAuth audience check for the non-Firebase (tokeninfo) path.
      if (!info.firebase && !isValidGoogleAudience(info.aud)) return json(res, 401, { error: "Google credential is not for this application." });

      const email = String(info.email || "").trim().toLowerCase();
      const name = String(info.name || email.split("@")[0]).trim();
      const photo = String(info.picture || "").trim();

      let found = db.users.find(item => item.email === email);
      if (!found) {
        found = makeGoogleUser(name, email, photo);
        db.users.push(found);
        db.storage[found.id] = {};
      }
      const token = createSession(db, found.id);
      writeDb(db);
      return json(res, 200, { ok: true, token, user: sanitizeUser(found) });
    } catch (error) {
      return json(res, 400, { error: "Invalid Google login payload." });
    }
  }

  if (urlPath === "/api/storage" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    return json(res, 200, { ok: true, data: db.storage[user.id] || {} });
  }

  if (urlPath === "/api/storage" && (req.method === "PUT" || req.method === "POST")) {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    try {
      const body = await parseBody(req);
      const incoming = body && body.data && typeof body.data === "object" ? body.data : {};
      db.storage[user.id] = req.method === "POST" ? incoming : Object.assign({}, db.storage[user.id] || {}, incoming);
      writeDb(db);
      return json(res, 200, { ok: true, data: db.storage[user.id] });
    } catch (error) {
      return json(res, 400, { error: "Invalid storage payload." });
    }
  }

  if (urlPath === "/api/pharmacy/upload" && req.method === "POST") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    try {
      const body = await parseBody(req);
      const dataUrl = String(body.dataUrl || "");
      const recordType = String(body.recordType || "medicine").replace(/[^a-z0-9_-]/gi, "");
      const recordId = String(body.recordId || "").replace(/[^a-z0-9_-]/gi, "");
      const note = String(body.note || "").slice(0, 500);
      if (!dataUrl || !dataUrl.startsWith("data:image") || recordId.length < 1) {
        return json(res, 400, { error: "Invalid upload payload." });
      }
      const allowed = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif" };
      const match = dataUrl.match(/^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/);
      if (!match || !allowed[match[1]]) {
        return json(res, 400, { error: "Unsupported image type." });
      }
      const ext = allowed[match[1]];
      const b64 = match[2];
      if (b64.length > 2 * 1024 * 1024) return json(res, 413, { error: "File too large." });
      const uploadsRoot = path.join(ROOT, "uploads", "pharmacy", String(user.id));
      const recordDir = path.join(uploadsRoot, recordType, recordId);
      fs.mkdirSync(recordDir, { recursive: true });
       const ts = Date.now() + "_" + Math.random().toString(36).slice(2, 8);
       const safeFile = ts + "." + ext;
       const absPath = path.join(recordDir, safeFile);
       const relPath = path.join(String(user.id), recordType, recordId, safeFile).replace(/\\/g, "/");
       const docId = "phdoc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
       fs.writeFileSync(absPath, Buffer.from(b64, "base64"));
       if (!Array.isArray(db.pharmacy_docs)) db.pharmacy_docs = [];
       db.pharmacy_docs.push({
         id: docId,
         user: user.id,
         recordType,
         recordId,
         filename: safeFile,
         url: "/api/pharmacy/doc/" + relPath,
         note,
         ext,
         size: Buffer.byteLength(b64, "base64"),
         createdAt: new Date().toISOString()
       });
       writeDb(db);
       return json(res, 201, { ok: true, id: docId, url: "/api/pharmacy/doc/" + relPath });
    } catch (err) {
      return json(res, 500, { error: "Upload failed." });
    }
  }

  if (urlPath === "/api/pharmacy/docs" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    const parsed = new URL(urlPath + req.url.replace(urlPath, ""), "http://x");
    const q = parsed.searchParams.get("type") || "";
    if (!Array.isArray(db.pharmacy_docs)) db.pharmacy_docs = [];
    const docs = q ? db.pharmacy_docs.filter(d => d.user === user.id && d.recordType === q)
                   : db.pharmacy_docs.filter(d => d.user === user.id);
    return json(res, 200, { ok: true, docs: docs });
  }

  if (urlPath === "/api/pharmacy/docs" && req.method === "DELETE") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    try {
      const body = await parseBody(req);
      const docId = String(body.id || "");
      const rel = String(body.url || "").match(/^\/api\/pharmacy\/doc\/(.+)$/);
      if (!Array.isArray(db.pharmacy_docs)) db.pharmacy_docs = [];
      const docs = db.pharmacy_docs.filter(d => d.user === user.id);
      const idx = docs.findIndex(d => d.id === docId || (rel && d.url === body.url));
      if (idx < 0) return json(res, 404, { error: "Document not found." });
      const doc = docs[idx];
      const fileAbs = path.join(ROOT, "uploads", "pharmacy", doc.url);
      if (fileAbs.startsWith(path.join(ROOT, "uploads", "pharmacy", doc.user)) && fs.existsSync(fileAbs) && fs.statSync(fileAbs).isFile()) {
        fs.unlinkSync(fileAbs);
      }
      db.pharmacy_docs = db.pharmacy_docs.filter(d => d.id !== doc.id);
      writeDb(db);
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, 500, { error: "Delete failed." });
    }
  }

  if (urlPath.startsWith("/api/pharmacy/doc/") && req.method === "GET" && !user) {
    return json(res, 401, { error: "Unauthorized" });
  }

  if (urlPath.startsWith("/api/pharmacy/doc/") && req.method === "GET") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    let cleaned = urlPath.split("?")[0].split("#")[0];
    cleaned = decodeURIComponent(cleaned);
    const rel = cleaned.replace(/^\/api\/pharmacy\/doc\/(.*)$/, "$1").replace(/\\/g, "/");
    const parts = rel.split("/");
    const uid = parts[0], rtype = parts[1], rid = parts[2], file = parts[3];
    if (!uid || uid !== String(user.id) || !rtype || !rid || !file) {
      return json(res, 403, { error: "Forbidden." });
    }
    const abs = path.join(ROOT, "uploads", "pharmacy", uid, rtype, rid, file);
    if (!abs.startsWith(path.join(ROOT, "uploads", "pharmacy", uid)) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      return json(res, 404, { error: "Not found." });
    }
    const ext = path.extname(abs).toLowerCase();
    const types = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(abs).pipe(res);
    return;
  }

  if (urlPath === "/api/gym/upload" && req.method === "POST") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    try {
      const body = await parseBody(req);
      const dataUrl = String(body.dataUrl || "");
      const recordType = String(body.recordType || "library").replace(/[^a-z0-9_-]/gi, "");
      const recordId = String(body.recordId || "").replace(/[^a-z0-9_-]/gi, "");
      const title = String(body.title || "").slice(0, 200);
      const category = String(body.category || "").replace(/[^a-z0-9_ -]/gi, "").slice(0, 60);
      const note = String(body.note || "").slice(0, 500);
      if (!dataUrl || !dataUrl.startsWith("data:")) {
        return json(res, 400, { error: "Invalid upload payload." });
      }
      const allowed = {
        "image/png": { ext: "png", mime: "image/png", kind: "image" },
        "image/jpeg": { ext: "jpg", mime: "image/jpeg", kind: "image" },
        "image/gif": { ext: "gif", mime: "image/gif", kind: "image" },
        "application/pdf": { ext: "pdf", mime: "application/pdf", kind: "doc" },
        "application/msword": { ext: "doc", mime: "application/msword", kind: "doc" },
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "doc" },
        "application/vnd.ms-excel": { ext: "xls", mime: "application/vnd.ms-excel", kind: "sheet" },
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "sheet" },
        "text/csv": { ext: "csv", mime: "text/csv", kind: "sheet" },
        "text/plain": { ext: "txt", mime: "text/plain", kind: "doc" }
      };
      const match = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
      if (!match || !allowed[match[1]]) {
        return json(res, 400, { error: "Unsupported file type." });
      }
      const meta = allowed[match[1]];
      const ext = meta.ext;
      const b64 = match[2];
      if (b64.length > 10 * 1024 * 1024) return json(res, 413, { error: "File too large (max 10MB)." });
      const uploadsRoot = path.join(ROOT, "uploads", "gym", String(user.id));
      const recordDir = path.join(uploadsRoot, recordType, recordId || "general");
      fs.mkdirSync(recordDir, { recursive: true });
      const ts = Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      const safeFile = ts + "." + ext;
      const absPath = path.join(recordDir, safeFile);
      const relPath = path.join(String(user.id), recordType, recordId || "general", safeFile).replace(/\\/g, "/");
      const docId = "gymdoc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      fs.writeFileSync(absPath, Buffer.from(b64, "base64"));
      if (!Array.isArray(db.gym_docs)) db.gym_docs = [];
      db.gym_docs.push({
        id: docId,
        user: user.id,
        recordType,
        recordId: recordId || "general",
        title,
        category,
        filename: safeFile,
        mime: meta.mime,
        kind: meta.kind,
        url: "/api/gym/doc/" + relPath,
        note,
        ext,
        size: Buffer.byteLength(b64, "base64"),
        createdAt: new Date().toISOString()
      });
      writeDb(db);
      return json(res, 201, { ok: true, id: docId, url: "/api/gym/doc/" + relPath });
    } catch (err) {
      return json(res, 500, { error: "Upload failed." });
    }
  }

  if (urlPath === "/api/gym/docs" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    const parsed = new URL(urlPath + req.url.replace(urlPath, ""), "http://x");
    const q = parsed.searchParams.get("type") || "";
    const cat = parsed.searchParams.get("category") || "";
    if (!Array.isArray(db.gym_docs)) db.gym_docs = [];
    let docs = db.gym_docs.filter(d => d.user === user.id);
    if (q) docs = docs.filter(d => d.recordType === q);
    if (cat) docs = docs.filter(d => String(d.category || "") === cat);
    docs = docs.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return json(res, 200, { ok: true, docs: docs });
  }

  if (urlPath === "/api/gym/docs" && req.method === "DELETE") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    try {
      const body = await parseBody(req);
      const docId = String(body.id || "");
      const rel = String(body.url || "").match(/^\/api\/gym\/doc\/(.+)$/);
      if (!Array.isArray(db.gym_docs)) db.gym_docs = [];
      const docs = db.gym_docs.filter(d => d.user === user.id);
      const idx = docs.findIndex(d => d.id === docId || (rel && d.url === body.url));
      if (idx < 0) return json(res, 404, { error: "Document not found." });
      const doc = docs[idx];
      const fileAbs = path.join(ROOT, "uploads", "gym", doc.url);
      if (fileAbs.startsWith(path.join(ROOT, "uploads", "gym", doc.user)) && fs.existsSync(fileAbs) && fs.statSync(fileAbs).isFile()) {
        fs.unlinkSync(fileAbs);
      }
      db.gym_docs = db.gym_docs.filter(d => d.id !== doc.id);
      writeDb(db);
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, 500, { error: "Delete failed." });
    }
  }

  if (urlPath.startsWith("/api/gym/doc/") && req.method === "GET" && !user) {
    return json(res, 401, { error: "Unauthorized" });
  }

  if (urlPath.startsWith("/api/gym/doc/") && req.method === "GET") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    let cleaned = urlPath.split("?")[0].split("#")[0];
    cleaned = decodeURIComponent(cleaned);
    const rel = cleaned.replace(/^\/api\/gym\/doc\/(.*)$/, "$1").replace(/\\/g, "/");
    const parts = rel.split("/");
    const uid = parts[0], rtype = parts[1], rid = parts[2], file = parts[3];
    if (!uid || uid !== String(user.id) || !rtype || !rid || !file) {
      return json(res, 403, { error: "Forbidden." });
    }
    const abs = path.join(ROOT, "uploads", "gym", uid, rtype, rid, file);
    if (!abs.startsWith(path.join(ROOT, "uploads", "gym", uid)) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      return json(res, 404, { error: "Not found." });
    }
    const ext = path.extname(abs).toLowerCase();
    const types = {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xls": "application/vnd.ms-excel",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".csv": "text/csv",
      ".txt": "text/plain"
    };
    const mime = types[ext] || "application/octet-stream";
    const inline = mime.indexOf("image/") === 0 || mime === "application/pdf";
    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Disposition": (inline ? "inline" : "attachment") + "; filename=\"" + path.basename(file) + "\"",
      "Cache-Control": "no-store"
    });
    fs.createReadStream(abs).pipe(res);
    return;
  }

  if (urlPath === "/api/monitoring/event" && req.method === "POST") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    try {
      const body = await parseBody(req);
      const event = recordMonitoringEvent(db, {
        type: body.type || "generic",
        issueType: body.issueType || body.type || "technical",
        severity: body.severity || "low",
        source: body.source || "client",
        customerId: body.customerId || "",
        orderId: body.orderId || "",
        message: body.message || "No message provided",
        metadata: body.metadata || {}
      });
      if (body.log) {
        recordSystemLog(db, {
          level: body.log.level || "error",
          serviceName: body.source || "client",
          orderId: body.orderId || "",
          message: body.log.message || body.message || "Client log",
          details: body.log.details || {}
        });
      }
      writeDb(db);
      return json(res, 201, { ok: true, event });
    } catch (error) {
      return json(res, 400, { error: "Invalid monitoring payload." });
    }
  }

  if (urlPath === "/api/monitoring/status" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    return json(res, 200, { ok: true, status: getMonitoringStatus(db) });
  }

  if (urlPath === "/api/ai/run" && req.method === "POST") {
    if (!requireAdmin(user)) return json(res, 403, { error: "Admin only." });
    const output = runAgentCycle(db);
    writeDb(db);
    return json(res, 200, { ok: true, output, summary: apiSummary(db) });
  }

  if (urlPath === "/api/ai/dashboard" && req.method === "GET") {
    if (!requireAdmin(user)) return json(res, 403, { error: "Admin only." });
    return json(res, 200, { ok: true, data: apiSummary(db) });
  }

  if (urlPath === "/api/ai/tools" && req.method === "POST") {
    if (!requireAdmin(user)) return json(res, 403, { error: "Admin only." });
    try {
      const body = await parseBody(req);
      const result = handleTool(db, body.tool, body.args || {});
      writeDb(db);
      return json(res, 200, { ok: true, result });
    } catch (error) {
      return json(res, 400, { error: "Invalid tool request." });
    }
  }

  if (urlPath === "/api/tickets" && req.method === "GET") {
    if (!requireAdmin(user)) return json(res, 403, { error: "Admin only." });
    return json(res, 200, { ok: true, tickets: db.tickets, messages: db.ticket_messages });
  }

  if (urlPath === "/api/tickets" && req.method === "POST") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    try {
      const body = await parseBody(req);
      const ticket = createTicket(db, body);
      writeDb(db);
      return json(res, 201, { ok: true, ticket });
    } catch (error) {
      return json(res, 400, { error: "Invalid ticket payload." });
    }
  }

  if (urlPath.startsWith("/api/tickets/") && req.method === "POST") {
    if (!requireAdmin(user)) return json(res, 403, { error: "Admin only." });
    const parts = urlPath.split("/").filter(Boolean);
    const ticketId = parts[2];
    const action = parts[3] || "";
    try {
      const body = await parseBody(req);
      if (action === "message") {
        const message = addTicketMessage(db, ticketId, body.sender || "admin", body.message || "");
        summarizeTicket(db, ticketId);
        writeDb(db);
        return json(res, 200, { ok: true, message });
      }
      if (action === "priority") {
        const ticket = updateTicketPriority(db, ticketId, body.priority || "normal");
        writeDb(db);
        return json(res, 200, { ok: true, ticket });
      }
      return json(res, 404, { error: "Unknown ticket action." });
    } catch (error) {
      return json(res, 400, { error: "Invalid ticket action payload." });
    }
  }

  if (urlPath === "/api/admin/users" && req.method === "GET") {
    if (!requireAdmin(user)) return json(res, 403, { error: "Admin only." });
    return json(res, 200, { ok: true, users: db.users.map(sanitizeUser) });
  }

  // ============ PLANS & MODULES ============
  const DEFAULT_PLATFORM_MODULES = [
    { key: "core", label: "Storefront" }, { key: "restaurant", label: "Restaurant" },
    { key: "pharmacy", label: "Pharmacy" }, { key: "hotel", label: "Hotel" },
    { key: "barber", label: "Barber" }, { key: "laundry", label: "Laundry" },
    { key: "pos", label: "POS" }, { key: "gym", label: "Gym" }, { key: "salon", label: "Salon" },
    { key: "tailor", label: "Tailor" }, { key: "website", label: "Website" },
    { key: "whatsapp", label: "WhatsApp" }, { key: "qr-menu", label: "QR Menu" },
    { key: "invoice", label: "Invoice" }, { key: "accounting", label: "Accounting" },
    { key: "crm", label: "CRM" }, { key: "marketing", label: "Marketing" },
    { key: "loyalty", label: "Loyalty" }, { key: "hr-payroll", label: "HR & Payroll" },
    { key: "warehouses", label: "Warehouses" }, { key: "supply-chain", label: "Supply Chain" },
    { key: "scanner", label: "Scanner" }, { key: "parking", label: "Parking" },
    { key: "supershop", label: "SuperShop" }
  ];
  function defaultPlatformModules() { return DEFAULT_PLATFORM_MODULES.map(function(m){ return { key: m.key, label: m.label }; }); }
  function defaultModuleMap(enabledKeys) {
    var out = {};
    DEFAULT_PLATFORM_MODULES.forEach(function(m){ out[m.key] = { enabled: enabledKeys.indexOf(m.key) !== -1, price: "", duration: "" }; });
    return out;
  }
  function ensurePlatform(db2) {
    if (!db2.platform || typeof db2.platform !== "object") db2.platform = {};
    if (!Array.isArray(db2.platform.modules) || !db2.platform.modules.length) db2.platform.modules = defaultPlatformModules();
    if (!Array.isArray(db2.platform.plans) || !db2.platform.plans.length) {
      db2.platform.plans = [
        { id: "free", name: "Free", price: 0, currency: "$", billingUnit: "one-time", billingValue: 0, modules: defaultModuleMap(["core"]) },
        { id: "pro", name: "Pro", price: 49, currency: "$", billingUnit: "month", billingValue: 1, modules: defaultModuleMap(DEFAULT_PLATFORM_MODULES.map(function(m){ return m.key; })) },
        { id: "admin", name: "Admin", price: 0, currency: "$", billingUnit: "one-time", billingValue: 0, modules: defaultModuleMap(DEFAULT_PLATFORM_MODULES.map(function(m){ return m.key; })) }
      ];
    }
    return db2.platform;
  }

  if (urlPath === "/api/platform/plans" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    var plat = ensurePlatform(db);
    return json(res, 200, { ok: true, modules: plat.modules, plans: plat.plans });
  }

  if (urlPath === "/api/platform/plans" && req.method === "PUT") {
    if (!requireAdmin(user)) return json(res, 403, { error: "Admin only." });
    try {
      const body = await parseBody(req);
      if (!body || typeof body !== "object") return json(res, 400, { error: "Invalid payload." });
      const plat = ensurePlatform(db);
      if (Array.isArray(body.modules)) plat.modules = body.modules;
      if (Array.isArray(body.plans)) plat.plans = body.plans;
      writeDb(db);
      return json(res, 200, { ok: true, modules: plat.modules, plans: plat.plans });
    } catch (e) {
      return json(res, 400, { error: "Invalid plans payload." });
    }
  }


  // ============ RBAC ============
  if (urlPath === "/api/rbac/roles" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    if (!requireAdmin(user)) return json(res, 403, { error: "Admin only." });
    return json(res, 200, { ok: true, roles: listRoles(db) });
  }

  if (urlPath === "/api/rbac/roles" && req.method === "POST") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    if (!requireAdmin(user)) return json(res, 403, { error: "Admin only." });
    try {
      const body = await parseBody(req);
      if (!body.userId || !body.role) return json(res, 400, { error: "userId and role required." });
      const entry = createRole(db, body.userId, body.role, user.id);
      writeDb(db);
      return json(res, 201, { ok: true, role: entry });
    } catch (e) {
      return json(res, 400, { error: "Invalid payload." });
    }
  }

  if (urlPath === "/api/rbac/my-permissions" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    const role = getUserRole(db, user.id);
    const permissions = getUserPermissions(db, user.id);
    return json(res, 200, { ok: true, role, permissions });
  }

  // ============ PAYMENTS ============
  if (urlPath === "/api/payments/config" && req.method === "GET") {
    return json(res, 200, { ok: true, stripe: isStripeConfigured(), whatsapp: isWhatsAppConfigured(), ai: isAIConfigured(), gmail: isGmailConfigured() });
  }

  if (urlPath === "/api/payments/checkout" && req.method === "POST") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    try {
      const body = await parseBody(req);
      const session = await createCheckoutSession(body);
      if (session.ok) {
        const payment = recordPayment(db, { orderId: body.orderId, storeId: body.storeId, amount: body.amount, currency: body.currency, stripeSessionId: session.sessionId, customerEmail: user.email });
        writeDb(db);
      }
      return json(res, 200, session);
    } catch (e) {
      return json(res, 400, { error: "Invalid payment request." });
    }
  }

  if (urlPath === "/api/payments/intent" && req.method === "POST") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    try {
      const body = await parseBody(req);
      const intent = await createPaymentIntent(body.amount, body.currency, body.metadata);
      return json(res, 200, intent);
    } catch (e) {
      return json(res, 400, { error: "Invalid payment intent." });
    }
  }

  if (urlPath === "/api/payments/history" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    const payments = (db.payments || []).filter(p => user.isAdmin || p.customerEmail === user.email).slice(0, 100);
    return json(res, 200, { ok: true, payments });
  }

  // ============ COUPONS ============
  if (urlPath === "/api/coupons/daily" && req.method === "GET") {
    const coupons = require("./services/coupons");
    return json(res, 200, { ok: true, date: coupons.dateKey(), codes: coupons.getDailyCodes(), trials: coupons.getTrialCodes() });
  }

  // Validate a coupon and compute the discounted total for the current modules.
  if (urlPath === "/api/coupons/validate" && req.method === "POST") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    try {
      const body = await parseBody(req);
      const coupons = require("./services/coupons");
      const resolved = coupons.resolveCoupon(body.code);
      const moduleCount = Math.max(0, Number(body.moduleCount) || 0);
      const baseTotal = moduleCount * (Number(body.pricePerModule) || 1000);
      if (!resolved) return json(res, 404, { ok: false, error: "Invalid coupon code." });
      if (resolved.type === "percent") {
        const discount = Math.round((baseTotal * resolved.pct) / 100);
        return json(res, 200, { ok: true, type: "percent", code: resolved.code, pct: resolved.pct, base_total: baseTotal, discount, total: baseTotal - discount });
      }
      // Trial code: needs admin approval via email.
      return json(res, 200, { ok: true, type: "trial", code: resolved.code, months: resolved.months, founder: resolved.founder, label: resolved.label, requiresApproval: true });
    } catch (e) {
      return json(res, 400, { ok: false, error: "Validation failed" });
    }
  }

  // Create a free-trial coupon approval request and email the admin an approve/reject link.
  if (urlPath === "/api/coupons/trial-request" && req.method === "POST") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    try {
      const body = await parseBody(req);
      const coupons = require("./services/coupons");
      const resolved = coupons.resolveCoupon(body.code);
      if (!resolved || resolved.type !== "trial") return json(res, 404, { ok: false, error: "Invalid or non-trial coupon." });
      if (!body.storeId) return json(res, 400, { ok: false, error: "storeId required" });
      if (!Array.isArray(body.modules) || body.modules.length === 0) return json(res, 400, { ok: false, error: "Modules required" });

      const ecoDb = require("./lib/ecosystem-db").getDb();
      const store = ecoDb.prepare('SELECT * FROM stores WHERE id = ?').get(body.storeId);
      if (!store) { ecoDb.close(); return json(res, 404, { ok: false, error: "Store not found" }); }

      const approvalId = 'ca_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
      const token = coupons.randomToken(24);
      const moduleNames = Array.isArray(body.moduleNames) ? body.moduleNames.join(', ') : (body.moduleNames || '');
      const existing = ecoDb.prepare('SELECT * FROM coupon_approvals WHERE store_id = ? AND status = ?').get(store.id, 'pending');
      if (existing) { ecoDb.close(); return json(res, 200, { ok: true, approvalId: existing.id, alreadyPending: true }); }

      ecoDb.prepare('INSERT INTO coupon_approvals (id, store_id, user_id, email, code, months, modules, module_names, amount, token, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'pending\', datetime(\'now\'))')
        .run(approvalId, store.id, user.id, user.email, resolved.code, resolved.months, JSON.stringify(body.modules), moduleNames, Number(body.amount) || 0, token);

      const baseUrl = (req.headers['x-forwarded-proto'] || 'http') + '://' + (req.headers.host || 'localhost:3000');
      const approveUrl = baseUrl + '/api/coupons/approve/' + approvalId + '?t=' + token;
      const rejectUrl = baseUrl + '/api/coupons/reject/' + approvalId + '?t=' + token;
      const adminEmail = process.env.ADMIN_EMAIL || "";
      if (adminEmail) {
        const emailTemplates = require("./services/email-templates");
        const { sendEmail } = require("./services/notifications");
        const detail =
          '<p>A store owner has requested a <strong>free trial</strong> using coupon <strong>' + resolved.code + '</strong> (' + resolved.months + ' month).</p>' +
          '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;font-size:13px;color:#334155;">' +
            '<tr><td style="padding:4px 0;">Owner</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + (user.email || '—') + '</td></tr>' +
            '<tr><td style="padding:4px 0;">Store</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + (store.name || '—') + '</td></tr>' +
            '<tr><td style="padding:4px 0;">Modules</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + (moduleNames || JSON.stringify(body.modules)) + '</td></tr>' +
            '<tr><td style="padding:4px 0;">Coupon</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + resolved.code + '</td></tr>' +
          '</table><br/>' +
          emailTemplates.btn(approveUrl, 'Approve Free Trial') + '<br/><br/>' +
          emailTemplates.btn(rejectUrl, 'Reject Request');
        sendEmail(adminEmail, "Free Trial Coupon Approval Request — Ocean SFT", emailTemplates.wrapper(detail)).catch(function(){});
      }
      ecoDb.close();
      return json(res, 201, { ok: true, approvalId });
    } catch (e) {
      console.error('Trial request error:', e);
      return json(res, 400, { ok: false, error: "Request failed" });
    }
  }

  // Poll the approval status for a store from the client.
  if (urlPath === "/api/coupons/trial-status" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    const storeId = new URL(req.url, 'http://x').searchParams.get('storeId') || '';
    const ecoDb = require("./lib/ecosystem-db").getDb();
    const row = ecoDb.prepare('SELECT id, status, store_id, email, created_at FROM coupon_approvals WHERE store_id = ? ORDER BY created_at DESC LIMIT 1').get(storeId);
    ecoDb.close();
    if (!row) return json(res, 200, { ok: true, status: 'none' });
    return json(res, 200, { ok: true, status: row.status, approvalId: row.id });
  }

  // Admin approval list (for the admin panel).
  if (urlPath === "/api/coupons/approvals" && req.method === "GET") {
    if (!user || !user.isAdmin) return json(res, 403, { error: "Admin only." });
    const ecoDb = require("./lib/ecosystem-db").getDb();
    const rows = ecoDb.prepare('SELECT * FROM coupon_approvals ORDER BY created_at DESC').all();
    ecoDb.close();
    return json(res, 200, { ok: true, approvals: rows });
  }

  // Grant a trial: enable modules, activate store, mark user as trial/paid.
  async function grantTrial(approval) {
    const ecoDb = require("./lib/ecosystem-db").getDb();
    const months = Number(approval.months) || 1;
    const modules = JSON.parse(approval.modules || '[]');
    const upsert = ecoDb.prepare('INSERT INTO user_modules (id, user_id, module_key, enabled, created_at) VALUES (?, ?, ?, 1, datetime(\'now\')) ON CONFLICT(user_id, module_key) DO UPDATE SET enabled=1');
    (Array.isArray(modules) ? modules : []).forEach(function (m) { upsert.run('um_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6), approval.user_id, m); });
    upsert.run('um_core_' + Math.random().toString(36).substr(2, 6), approval.user_id, 'core');
    const mainUser = db.users && db.users.find(function (u) { return String(u.id) === String(approval.user_id) || (u.email && u.email.toLowerCase() === String(approval.email || '').toLowerCase()); });
    if (mainUser) {
      setSubscription(mainUser, months);
      writeDb(db);
    }
    if (approval.store_id) {
      const trialUntil = new Date(Date.now() + months * 30 * 24 * 3600 * 1000).toISOString();
      ecoDb.prepare('UPDATE stores SET is_active = 1, website_published = 1, trial_until = ?, updated_at = datetime(\'now\') WHERE id = ?').run(trialUntil, approval.store_id);
    }
    ecoDb.close();
  }

  // Self-service free trial: instant 1-month access, no admin approval needed.
  if (urlPath === "/api/trial/start" && req.method === "POST") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    try {
      const body = await parseBody(req);
      const modules = Array.isArray(body.modules) ? body.modules : [];
      const storeId = String(body.storeId || "").trim();
      if (modules.length === 0) return json(res, 400, { ok: false, error: "At least one module is required." });
      if (!storeId) return json(res, 400, { ok: false, error: "storeId is required." });

      const ecoDb = require("./lib/ecosystem-db").getDb();
      const store = ecoDb.prepare('SELECT * FROM stores WHERE id = ?').get(storeId);
      if (!store) { ecoDb.close(); return json(res, 404, { ok: false, error: "Store not found." }); }

      // Enable modules
      const upsert = ecoDb.prepare('INSERT INTO user_modules (id, user_id, module_key, enabled, created_at) VALUES (?, ?, ?, 1, datetime(\'now\')) ON CONFLICT(user_id, module_key) DO UPDATE SET enabled=1');
      modules.forEach(function (m) { upsert.run('um_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6), user.id, m); });
      upsert.run('um_core_' + Math.random().toString(36).substr(2, 6), user.id, 'core');

      // Set 1-month subscription
      setSubscription(user, 1);
      writeDb(db);

      // Activate store
      const trialUntil = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      ecoDb.prepare('UPDATE stores SET is_active = 1, website_published = 1, trial_until = ?, updated_at = datetime(\'now\') WHERE id = ?').run(trialUntil, storeId);

      // Record as an auto-approved trial in coupon_approvals for history
      const approvalId = 'ca_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
      const moduleNames = Array.isArray(body.moduleNames) ? body.moduleNames.join(', ') : modules.join(', ');
      ecoDb.prepare('INSERT INTO coupon_approvals (id, store_id, user_id, email, code, months, modules, module_names, amount, token, status, decided_by, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'approved\', ?, datetime(\'now\'), datetime(\'now\'))')
        .run(approvalId, storeId, user.id, user.email, 'self-trial', 1, JSON.stringify(modules), moduleNames, 0, require("./services/coupons").randomToken(12), String(user.email));

      ecoDb.close();

      // Send welcome email
      const emailTemplates = require("./services/email-templates");
      const { sendEmail } = require("./services/notifications");
      const welcomeDetail = '<p>Your <strong>1-month free trial</strong> is now active!</p>' +
        '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px;font-size:13px;color:#166534;">' +
          '<tr><td style="padding:4px 0;">Modules</td><td style="padding:4px 0;text-align:right;font-weight:700;">' + moduleNames + '</td></tr>' +
          '<tr><td style="padding:4px 0;">Expires</td><td style="padding:4px 0;text-align:right;font-weight:700;">' + new Date(Date.now() + 30 * 24 * 3600 * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + '</td></tr>' +
        '</table><br/>' +
        '<p style="font-size:13px;color:#475569;">Your store and website are now live. You can start using your dashboard right away.</p>';
      if (user.email) sendEmail(user.email, "Your Free Trial is Active 🎉", emailTemplates.wrapper(welcomeDetail)).catch(function () { });

      return json(res, 200, { ok: true, expiry: trialUntil });
    } catch (e) {
      console.error('Self-service trial error:', e);
      return json(res, 500, { ok: false, error: "Failed to start trial." });
    }
  }

  // Email-link approval (GET, no session) — opens in the admin's browser.
  if (urlPath.match(/^\/api\/coupons\/approve\/[^/]+$/) && req.method === "GET") {
    const approvalId = urlPath.split('/').pop();
    const token = new URL(req.url, 'http://x').searchParams.get('t') || '';
    const ecoDb = require("./lib/ecosystem-db").getDb();
    const row = ecoDb.prepare('SELECT * FROM coupon_approvals WHERE id = ?').get(approvalId);
    let message = '';
    if (!row || row.token !== token) {
      message = 'This approval link is invalid or has expired.';
    } else if (row.status === 'approved') {
      message = 'This free trial was already approved.';
    } else if (row.status === 'rejected') {
      message = 'This free trial was already rejected.';
    } else {
      await grantTrial(row);
      ecoDb.prepare('UPDATE coupon_approvals SET status = \'approved\', decided_at = datetime(\'now\'), decided_by = ? WHERE id = ?').run(String(process.env.ADMIN_EMAIL || 'admin'), approvalId);
      message = 'Approved! The store is now live on a free trial.';
      const emailTemplates = require("./services/email-templates");
      const { sendEmail } = require("./services/notifications");
      if (row.email) sendEmail(row.email, "Your Free Trial is Approved 🎉", emailTemplates.wrapper('<p>Congratulations, your free trial is approved and your store & website are now live.</p>')).catch(function(){});
    }
    ecoDb.close();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Free Trial</title></head><body style="font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;"><div style="background:#fff;border-radius:16px;padding:40px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.08);max-width:420px;"><div style="font-size:46px;margin-bottom:12px;">' + (message.startsWith('Approved') ? '✅' : (message.includes('invalid') ? '⚠️' : 'ℹ️')) + '</div><h2 style="color:#0f1e3d;margin:0 0 8px;">' + (message.startsWith('Approved') ? 'Store Activated' : 'Status') + '</h2><p style="color:#475569;font-size:14px;line-height:1.5;margin:0;">' + message + '</p></div></body></html>');
    return;
  }

  // Email-link rejection (GET, no session).
  if (urlPath.match(/^\/api\/coupons\/reject\/[^/]+$/) && req.method === "GET") {
    const approvalId = urlPath.split('/').pop();
    const token = new URL(req.url, 'http://x').searchParams.get('t') || '';
    const ecoDb = require("./lib/ecosystem-db").getDb();
    const row = ecoDb.prepare('SELECT * FROM coupon_approvals WHERE id = ?').get(approvalId);
    let message = '';
    if (!row || row.token !== token) {
      message = 'This link is invalid or has expired.';
    } else if (row.status === 'approved') {
      message = 'This request was already approved.';
    } else if (row.status === 'rejected') {
      message = 'This request was already rejected.';
    } else {
      ecoDb.prepare('UPDATE coupon_approvals SET status = \'rejected\', decided_at = datetime(\'now\') WHERE id = ?').run(approvalId);
      message = 'The free trial request was rejected.';
    }
    ecoDb.close();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Free Trial</title></head><body style="font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;"><div style="background:#fff;border-radius:16px;padding:40px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.08);max-width:420px;"><div style="font-size:46px;margin-bottom:12px;">ℹ️</div><h2 style="color:#0f1e3d;margin:0 0 8px;">Status</h2><p style="color:#475569;font-size:14px;line-height:1.5;margin:0;">' + message + '</p></div></body></html>');
    return;
  }

  // Admin-panel approve/reject (PATCH).
  if (urlPath.match(/^\/api\/coupons\/[^/]+\/(approve|reject)$/) && req.method === "PATCH") {
    if (!user || !user.isAdmin) return json(res, 403, { error: "Admin only." });
    const parts = urlPath.split('/');
    const approvalId = parts[3];
    const action = parts[4];
    const ecoDb = require("./lib/ecosystem-db").getDb();
    const row = ecoDb.prepare('SELECT * FROM coupon_approvals WHERE id = ?').get(approvalId);
    if (!row) { ecoDb.close(); return json(res, 404, { error: "Approval not found" }); }
    if (row.status !== 'pending') { ecoDb.close(); return json(res, 400, { error: "Already processed" }); }
    if (action === 'approve') {
      await grantTrial(row);
      ecoDb.prepare('UPDATE coupon_approvals SET status = \'approved\', decided_at = datetime(\'now\'), decided_by = ? WHERE id = ?').run(String(user.id || user.email || 'admin'), approvalId);
      const emailTemplates = require("./services/email-templates");
      const { sendEmail } = require("./services/notifications");
      if (row.email) sendEmail(row.email, "Your Free Trial is Approved 🎉", emailTemplates.wrapper('<p>Congratulations, your free trial is approved and your store & website are now live.</p>')).catch(function(){});
    } else {
      ecoDb.prepare('UPDATE coupon_approvals SET status = \'rejected\', decided_at = datetime(\'now\'), decided_by = ? WHERE id = ?').run(String(user.id || user.email || 'admin'), approvalId);
    }
    ecoDb.close();
    return json(res, 200, { ok: true, status: action === 'approve' ? 'approved' : 'rejected' });
  }

  // Admin grants a free trial directly to a user for specific modules.
  if (urlPath === "/api/coupons/grant" && req.method === "POST") {
    if (!user || !user.isAdmin) return json(res, 403, { error: "Admin only." });
    try {
      const body = await parseBody(req);
      const ec = require("./lib/ecosystem-db");
      const coupons = require("./services/coupons");
      const targetEmail = String(body.email || "").trim().toLowerCase();
      const targetId = String(body.user_id || "").trim();
      const modules = Array.isArray(body.modules) ? body.modules.filter(Boolean) : [];
      if (!targetEmail && !targetId) return json(res, 400, { ok: false, error: "User email or id required." });
      if (modules.length === 0) return json(res, 400, { ok: false, error: "Select at least one module." });

      const target = db.users.find(function (u) {
        return (targetId && String(u.id) === targetId) || (targetEmail && u.email && String(u.email).toLowerCase() === targetEmail);
      });
      if (!target) return json(res, 404, { ok: false, error: "User not found." });

      const ecoDb = ec.getDb();
      const uid = String(target.id || target.email);
      const store = ecoDb.prepare('SELECT id, name, is_active, website_published FROM stores WHERE owner_id = ? ORDER BY created_at DESC LIMIT 1').get(uid) || { id: null, name: '' };
      const trialUntil = new Date(Date.now() + (Number(body.months) || 1) * 30 * 24 * 3600 * 1000).toISOString();
      const approvalRow = {
        store_id: store.id || '',
        user_id: target.id || target.email,
        email: target.email || targetEmail,
        code: 'admin-grant',
        months: Number(body.months) || 1,
        modules: JSON.stringify(modules),
        module_names: (Array.isArray(body.module_names) ? body.module_names : modules).join(', ')
      };
      // Enable modules + core + mark user paid/Pro + set store trial_until (reuses grantTrial).
      await grantTrial(approvalRow);
      // Record it in the admin ledger.
      const approvalId = 'ca_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
      ecoDb.prepare('INSERT INTO coupon_approvals (id, store_id, user_id, email, code, months, modules, module_names, amount, token, status, decided_by, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'approved\', ?, datetime(\'now\'), datetime(\'now\'))')
        .run(approvalId, store.id || '', uid, target.email || targetEmail, 'admin-grant', Number(body.months) || 1, JSON.stringify(modules), approvalRow.module_names, 0, coupons.randomToken(12), String(user.id || user.email || 'admin'));
      ecoDb.close();

      // Notify the owner.
      const emailTemplates = require("./services/email-templates");
      const { sendEmail } = require("./services/notifications");
      if (target.email) sendEmail(target.email, "Free Trial Granted — Ocean SFT", emailTemplates.wrapper('<p>An admin has granted you a <strong>' + (Number(body.months) || 1) + '-month free trial</strong> for: <strong>' + approvalRow.module_names + '</strong>. Your store & website are now live.</p>')).catch(function(){});
      return json(res, 201, { ok: true, approvalId, modules, months: Number(body.months) || 1, storeId: store.id || null });
    } catch (e) {
      console.error('Grant trial error:', e);
      return json(res, 400, { ok: false, error: "Grant failed" });
    }
  }

  // ============ bKASH PAYMENTS ============
  if (urlPath === "/api/payments/bkash" && req.method === "POST") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    try {
      const body = await parseBody(req);
      const { modules, transactionId, screenshot, amount, currency, bkashNumber, storeId } = body;
      if (!modules || !Array.isArray(modules) || modules.length === 0) return json(res, 400, { error: "Modules required" });
      if (!transactionId) return json(res, 400, { error: "Transaction ID required" });

      const ecoDb = require("./lib/ecosystem-db").getDb();
      const paymentId = 'pay_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      const storeName = storeId ? (ecoDb.prepare('SELECT name FROM stores WHERE id = ?').get(storeId) || {}).name : '';
      ecoDb.prepare('INSERT INTO payments (id, user_id, email, modules, module_names, amount, currency, bkash_number, transaction_id, screenshot, status, store_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))')
        .run(paymentId, user.id, user.email, JSON.stringify(modules), JSON.stringify(body.moduleNames || []), amount || 0, currency || 'TK', bkashNumber || '01876578110', transactionId, screenshot || '', 'pending', storeId || '');
      ecoDb.close();

      // Email confirmations (non-blocking)
      const emailTemplates = require("./services/email-templates");
      const modNames = String(body.moduleNames || '').trim();
      // 1) Thank-you to the store owner
      if (user.email) {
        sendEmail(user.email, "Thank You! Your Store Registration is Received 🎉", emailTemplates.storeRegisteredEmail(user.company || user.email, storeName || '', paymentId)).catch(function(){});
      }
      // 2) Alert the admin about the new pending payment
      const adminEmail = process.env.ADMIN_EMAIL || "";
      if (adminEmail) {
        sendEmail(adminEmail, "New Store Registration Awaiting Approval — Ocean SFT",
          emailTemplates.adminAlertEmail("New Payment Pending Approval",
            '<p>A new store payment needs your review.</p>' +
            '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;font-size:13px;color:#334155;">' +
              '<tr><td style="padding:4px 0;">Owner</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + (user.email || '—') + '</td></tr>' +
              '<tr><td style="padding:4px 0;">Store</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + (storeName || '—') + '</td></tr>' +
              '<tr><td style="padding:4px 0;">Modules</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + (modNames || JSON.stringify(body.moduleNames||[])) + '</td></tr>' +
              '<tr><td style="padding:4px 0;">Amount</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + (currency||'TK') + ' ' + (amount||0) + '</td></tr>' +
              '<tr><td style="padding:4px 0;">Payment ID</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + paymentId + '</td></tr>' +
              '<tr><td style="padding:4px 0;">TrxID</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + (transactionId || '—') + '</td></tr>' +
            '</table>'))
          .catch(function(){});
      }
      return json(res, 200, { ok: true, paymentId });
    } catch (e) {
      console.error('bKash payment error:', e);
      return json(res, 400, { error: "Submission failed" });
    }
  }

  if (urlPath === "/api/payments/pending" && req.method === "GET") {
    if (!user || !user.isAdmin) return json(res, 403, { error: "Admin only." });
    const ecoDb = require("./lib/ecosystem-db").getDb();
    const payments = ecoDb.prepare('SELECT * FROM payments ORDER BY created_at DESC').all();
    ecoDb.close();
    return json(res, 200, { ok: true, payments });
  }

  // ============ SUBSCRIPTION STATUS ============
  if (urlPath === "/api/subscription/status" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    return json(res, 200, {
      ok: true,
      subscription: {
        plan: user.plan || "Free",
        paid: Boolean(user.paid),
        subscriptionExpiry: user.subscriptionExpiry || "",
        subscriptionMonths: Number(user.subscriptionMonths || 0),
        lastRenewalDate: user.lastRenewalDate || "",
        isActive: isSubscriptionActive(user),
        daysLeft: getSubscriptionDaysLeft(user)
      }
    });
  }

  // ============ SUBSCRIPTION RENEWAL (bKash) ============
  if (urlPath === "/api/subscription/renew" && req.method === "POST") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    try {
      const body = await parseBody(req);
      const months = Math.max(1, Math.min(12, Number(body.months) || 1));
      const transactionId = String(body.transactionId || "").trim();
      const screenshot = String(body.screenshot || "").trim();
      const amount = Number(body.amount || 0);
      const bkashNumber = String(body.bkashNumber || "").trim();
      if (!transactionId) return json(res, 400, { error: "Transaction ID required" });

      const ecoDb = require("./lib/ecosystem-db").getDb();
      const paymentId = 'renew_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      // Store renewal as a payment with type marker in modules field
      ecoDb.prepare('INSERT INTO payments (id, user_id, email, modules, module_names, amount, currency, bkash_number, transaction_id, screenshot, status, store_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))')
        .run(paymentId, user.id, user.email, JSON.stringify(["renewal"]), JSON.stringify(["Subscription Renewal " + months + " month(s)"]), amount || 0, 'TK', bkashNumber || '', transactionId, screenshot, 'pending', '');
      ecoDb.close();

      // Email: renewal submission confirmation
      const emailTemplates = require("./services/email-templates");
      if (user.email) {
        sendEmail(user.email, "Renewal Request Received — Ocean SFT", emailTemplates.wrapper(
          '<p>Your subscription renewal request for <strong>' + months + ' month(s)</strong> has been received and is under review.</p>' +
          '<p style="margin-top:12px;color:#64748b;font-size:13px;">Payment ID: <strong>' + paymentId + '</strong></p>' +
          '<p style="margin-top:8px;color:#64748b;font-size:13px;">We will notify you once your renewal is approved.</p>'
        )).catch(function(){});
      }
      // Email: admin alert
      const adminEmail = process.env.ADMIN_EMAIL || "";
      if (adminEmail) {
        sendEmail(adminEmail, "Renewal Payment Pending — Ocean SFT",
          emailTemplates.adminAlertEmail("Subscription Renewal Request",
            '<p>A user has submitted a subscription renewal payment.</p>' +
            '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;font-size:13px;color:#334155;">' +
              '<tr><td style="padding:4px 0;">User</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + (user.email || '—') + '</td></tr>' +
              '<tr><td style="padding:4px 0;">Months</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + months + '</td></tr>' +
              '<tr><td style="padding:4px 0;">Amount</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">TK ' + (amount || 0) + '</td></tr>' +
              '<tr><td style="padding:4px 0;">TrxID</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + (transactionId || '—') + '</td></tr>' +
              '<tr><td style="padding:4px 0;">Payment ID</td><td style="padding:4px 0;text-align:right;font-weight:700;color:#0f1e3d;">' + paymentId + '</td></tr>' +
            '</table>'
          )).catch(function(){});
      }

      return json(res, 200, { ok: true, paymentId, months });
    } catch (e) {
      console.error('Renewal error:', e);
      return json(res, 400, { error: "Renewal submission failed" });
    }
  }

  // ============ SUBSCRIPTION RENEWAL APPROVE (admin) ============
  if (urlPath === "/api/subscription/renew/approve" && req.method === "POST") {
    if (!user || !user.isAdmin) return json(res, 403, { error: "Admin only." });
    try {
      const body = await parseBody(req);
      const paymentId = String(body.paymentId || "").trim();
      const months = Math.max(1, Math.min(12, Number(body.months) || 1));
      if (!paymentId) return json(res, 400, { error: "Payment ID required" });

      const ecoDb = require("./lib/ecosystem-db").getDb();
      const payment = ecoDb.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
      if (!payment) { ecoDb.close(); return json(res, 404, { error: "Payment not found" }); }
      if (payment.status !== 'pending') { ecoDb.close(); return json(res, 400, { error: "Already processed" }); }

      const mainUser = db.users.find(function(u) { return String(u.id) === String(payment.user_id) || (u.email && u.email.toLowerCase() === String(payment.email || '').toLowerCase()); });
      if (!mainUser) { ecoDb.close(); return json(res, 404, { error: "User not found" }); }

      // Extend subscription from current expiry or now (whichever is later)
      var baseMs = mainUser.subscriptionExpiry ? new Date(mainUser.subscriptionExpiry).getTime() : Date.now();
      if (isNaN(baseMs) || baseMs < Date.now()) baseMs = Date.now();
      var newExpiryMs = baseMs + months * 30 * 24 * 60 * 60 * 1000;
      mainUser.subscriptionExpiry = new Date(newExpiryMs).toISOString();
      mainUser.subscriptionMonths = months;
      mainUser.lastRenewalDate = new Date().toISOString();
      mainUser.paid = true;
      if (mainUser.plan === "Free") mainUser.plan = "Pro";
      writeDb(db);

      ecoDb.prepare('UPDATE payments SET status = ?, verified_by = ?, verified_at = datetime(\'now\') WHERE id = ?').run('approved', user.id, paymentId);
      ecoDb.close();

      // Send renewal confirmed email
      var emailTemplates = require("./services/email-templates");
      var newExpiryDate = new Date(newExpiryMs).toLocaleDateString();
      if (mainUser.email) {
        sendEmail(mainUser.email, "Subscription Renewed ✅ — Ocean SFT", emailTemplates.subscriptionRenewalConfirmedEmail(mainUser.company || mainUser.email, months, newExpiryDate)).catch(function(){});
      }

      return json(res, 200, { ok: true, subscriptionExpiry: mainUser.subscriptionExpiry, months });
    } catch (e) {
      console.error('Renewal approve error:', e);
      return json(res, 400, { error: "Failed to approve renewal" });
    }
  }

  // ============ SUBSCRIPTION EXTEND (admin direct) ============
  if (urlPath === "/api/subscription/extend" && req.method === "POST") {
    if (!user || !user.isAdmin) return json(res, 403, { error: "Admin only." });
    try {
      const body = await parseBody(req);
      const targetEmail = String(body.email || "").trim().toLowerCase();
      const months = Math.max(1, Math.min(12, Number(body.months) || 1));
      if (!targetEmail) return json(res, 400, { error: "Email required" });

      const target = db.users.find(function(u) { return u.email && u.email.toLowerCase() === targetEmail; });
      if (!target) return json(res, 404, { error: "User not found" });

      var baseMs = target.subscriptionExpiry ? new Date(target.subscriptionExpiry).getTime() : Date.now();
      if (isNaN(baseMs) || baseMs < Date.now()) baseMs = Date.now();
      target.subscriptionExpiry = new Date(baseMs + months * 30 * 24 * 60 * 60 * 1000).toISOString();
      target.subscriptionMonths = months;
      target.lastRenewalDate = new Date().toISOString();
      target.paid = true;
      if (target.plan === "Free") target.plan = "Pro";
      writeDb(db);

      // Notify the user that their subscription was extended (plan change)
      if (target.email) {
        var et2 = require("./services/email-templates");
        var exp2 = new Date(target.subscriptionExpiry).toLocaleDateString();
        sendEmail(target.email, "Your Plan Has Been Updated - Ocean SFT",
          et2.planUpdatedEmail(target.company || target.email, target.plan, exp2)).catch(function(){});
      }

      return json(res, 200, { ok: true, subscriptionExpiry: target.subscriptionExpiry, months });
    } catch (e) {
      return json(res, 400, { error: "Failed to extend" });
    }
  }

  if (urlPath.startsWith("/api/payments/") && urlPath.endsWith("/approve") && req.method === "PATCH") {
    if (!user || !user.isAdmin) return json(res, 403, { error: "Admin only." });
    try {
      const paymentId = urlPath.split('/')[3];
      const body = await parseBody(req);
      const months = Math.max(1, Math.min(12, Number(body.months) || 1));
      const ecoDb = require("./lib/ecosystem-db").getDb();
      const payment = ecoDb.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
      if (!payment) { ecoDb.close(); return json(res, 404, { error: "Payment not found" }); }
      if (payment.status !== 'pending') { ecoDb.close(); return json(res, 400, { error: "Already processed" }); }

      const modules = JSON.parse(payment.modules);
      const moduleNames = JSON.parse(payment.module_names);

      // Enable modules for user
      const upsert = ecoDb.prepare('INSERT INTO user_modules (id, user_id, module_key, enabled, created_at) VALUES (?, ?, ?, 1, datetime(\'now\')) ON CONFLICT(user_id, module_key) DO UPDATE SET enabled=1');
      modules.forEach(function(m) { upsert.run('um_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6), payment.user_id, m); });

      // Mark the main user as paid, set subscription expiry
      const mainUser = db.users && db.users.find(function(u){ return String(u.id) === String(payment.user_id) || (u.email && u.email.toLowerCase() === String(payment.email||'').toLowerCase()); });
      if (mainUser) {
        setSubscription(mainUser, months);
        writeDb(db);
      }

      // Mark payment approved
      ecoDb.prepare('UPDATE payments SET status = ?, verified_by = ?, verified_at = datetime(\'now\') WHERE id = ?').run('approved', user.id, paymentId);

      // If linked to a store, activate it so it goes live on locator/website
      if (payment.store_id) {
        ecoDb.prepare('UPDATE stores SET is_active = 1, website_published = 1, updated_at = datetime(\'now\') WHERE id = ?').run(payment.store_id);
      }
      ecoDb.close();

      // Send subscription confirmed email
      if (mainUser && mainUser.email) {
        var emailTemplates = require("./services/email-templates");
        var expiryDate = mainUser.subscriptionExpiry ? new Date(mainUser.subscriptionExpiry).toLocaleDateString() : "N/A";
        sendEmail(mainUser.email, "Subscription Activated — Ocean SFT", emailTemplates.subscriptionActivatedEmail(mainUser.company || mainUser.email, months, expiryDate, modules, moduleNames)).catch(function(){});
        sendEmail(mainUser.email, "Payment Receipt & Invoice - Ocean SFT", emailTemplates.paymentReceiptEmail(mainUser.company || mainUser.email, paymentId, payment.amount, moduleNames && moduleNames[0], months, expiryDate, storeName, payment.bkash_number ? 'bKash' : '')).catch(function(){});
        // If this payment activated a store, also notify the owner that it is live
        if (payment.store_id) {
          var storeRow = (function(){ try { var d = require("./lib/ecosystem-db").getDb(); var r = d.prepare('SELECT name FROM stores WHERE id = ?').get(payment.store_id); d.close(); return r; } catch(err) { return null; } })();
          var storeName = storeRow ? storeRow.name : "";
          sendEmail(mainUser.email, "Your Store is LIVE! - Ocean SFT", emailTemplates.storeLiveEmail(mainUser.company || mainUser.email, storeName)).catch(function(){});
        }
      }

      return json(res, 200, { ok: true, months: months, subscriptionExpiry: mainUser ? mainUser.subscriptionExpiry : "" });
    } catch (e) {
      console.error('Approve error:', e);
      return json(res, 400, { error: "Failed to approve" });
    }
  }

  if (urlPath.startsWith("/api/payments/") && urlPath.endsWith("/reject") && req.method === "PATCH") {
    if (!user || !user.isAdmin) return json(res, 403, { error: "Admin only." });
    try {
      const paymentId = urlPath.split('/')[3];
      const body = await parseBody(req);
      const ecoDb = require("./lib/ecosystem-db").getDb();
      const payment = ecoDb.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
      if (!payment) { ecoDb.close(); return json(res, 404, { error: "Payment not found" }); }
      if (payment.status !== 'pending') { ecoDb.close(); return json(res, 400, { error: "Already processed" }); }

      ecoDb.prepare('UPDATE payments SET status = ?, verified_by = ?, verified_at = datetime(\'now\'), rejection_reason = ? WHERE id = ?').run('rejected', user.id, body.reason || 'Not verified', paymentId);
      ecoDb.close();
      return json(res, 200, { ok: true });
    } catch (e) {
      console.error('Reject error:', e);
      return json(res, 400, { error: "Failed to reject" });
    }
  }

  // ============ NOTIFICATIONS ============
  if (urlPath === "/api/notifications/test" && req.method === "POST") {
    if (!user || !user.isAdmin) return json(res, 403, { error: "Admin only." });
    try {
      const body = await parseBody(req);
      let result;
      if (body.channel === "email") {
        result = await sendEmail(body.to, body.subject || "Test", body.message || "Test notification");
      } else if (body.channel === "sms") {
        result = await sendSMS(body.to, body.message || "Test notification");
      } else {
        return json(res, 400, { error: "Channel must be 'email' or 'sms'." });
      }
      return json(res, 200, { ok: true, result });
    } catch (e) {
      return json(res, 400, { error: "Invalid notification." });
    }
  }

  // ============ ADMIN STATISTICS & BULK EMAIL ============
  if (urlPath === "/api/admin/stats" && req.method === "GET") {
    if (!requireAdmin(user)) return json(res, 403, { error: "Admin only." });
    try {
      const ecoLib = require("./lib/ecosystem-db");
      const ecoDb = ecoLib.getDb();
      const totalUsers = db.users.length;
      const totalStores = ecoDb.prepare('SELECT COUNT(*) as cnt FROM stores').get().cnt;
      const activeStores = ecoDb.prepare('SELECT COUNT(*) as cnt FROM stores WHERE is_active = 1').get().cnt;
      const liveStores = ecoDb.prepare('SELECT COUNT(*) as cnt FROM stores WHERE website_published = 1').get().cnt;
      const biz = ecoLib.aggregateBusinessStats();
      const totalMembers = biz.totalMembers;
      const activeMembers = biz.activeMembers;
      const totalOrders = biz.totalOrders;
      const totalRevenue = biz.totalRevenue;
      const totalCheckins = biz.totalCheckins;
      const totalReviews = biz.totalReviews;
      const avgRating = biz.avgRating;
      const paymentsAll = ecoDb.prepare('SELECT * FROM payments').all();
      const totalRevenuePaid = paymentsAll.filter(function(p){ return p.status === 'approved'; }).reduce(function(s, p){ return s + Number(p.amount || 0); }, 0);
      const pendingRevenue = paymentsAll.filter(function(p){ return p.status === 'pending'; }).reduce(function(s, p){ return s + Number(p.amount || 0); }, 0);
      const paidUsers = db.users.filter(function(u){ return u.paid; }).length;
      const adminUsers = db.users.filter(function(u){ return u.isAdmin; }).length;
      ecoDb.close();
      return json(res, 200, {
        ok: true,
        stats: {
          totalUsers: totalUsers,
          paidUsers: paidUsers,
          adminUsers: adminUsers,
          totalStores: totalStores,
          activeStores: activeStores,
          liveStores: liveStores,
          totalMembers: totalMembers,
          activeMembers: activeMembers,
          totalOrders: totalOrders,
          totalRevenue: Number(totalRevenue),
          totalRevenuePaid: Number(totalRevenuePaid),
          pendingRevenue: Number(pendingRevenue),
          totalCheckins: totalCheckins,
          totalReviews: totalReviews,
          avgRating: Number(avgRating).toFixed(1),
          totalPayments: paymentsAll.length,
          pendingPayments: paymentsAll.filter(function(p){ return p.status === 'pending'; }).length,
          approvedPayments: paymentsAll.filter(function(p){ return p.status === 'approved'; }).length,
          rejectedPayments: paymentsAll.filter(function(p){ return p.status === 'rejected'; }).length
        }
      });
    } catch (e) {
      return json(res, 400, { error: "Failed to load stats: " + e.message });
    }
  }

  if (urlPath === "/api/admin/users/bulk-email" && req.method === "POST") {
    if (!requireAdmin(user)) return json(res, 403, { error: "Admin only." });
    try {
      const body = await parseBody(req);
      const { userIds, emails, subject, message } = body || {};
      let recipients = emails || [];
      if (Array.isArray(userIds) && userIds.length) {
        const ids = new Set(userIds);
        db.users.forEach(function(u){ if (ids.has(u.id) && u.email) recipients.push(u.email); });
      }
      if (!recipients.length) return json(res, 400, { error: "No recipients specified." });
      const emailTemplates = require("./services/email-templates");
      const byEmail = {};
      db.users.forEach(function(u){ if (u.email) byEmail[u.email] = u; });
      const results = [];
      for (const email of recipients) {
        const u = byEmail[email] || {};
        const replace = function(s){
          if (typeof s !== "string") return s;
          return s
            .replace(/\{name\}/g, (u.company || u.name || email).split(" ")[0])
            .replace(/\{company\}/g, u.company || email)
            .replace(/\{email\}/g, email)
            .replace(/\{plan\}/g, u.plan || "Standard")
            .replace(/\{amount\}/g, u.amount || "—")
            .replace(/\{due_date\}/g, u.dueDate || "as soon as possible")
            .replace(/\{expiry\}/g, u.subscriptionExpiry ? new Date(u.subscriptionExpiry).toLocaleDateString() : "soon");
        };
        const finalSubject = replace(subject);
        const finalMessage = replace(message);
        const html = emailTemplates.wrapper('<div style="font-family:Arial,sans-serif;font-size:15px;color:#334155;line-height:1.7;">' + (finalMessage || '').replace(/\n/g, '<br>') + '</div>');
        try {
          const r = await sendEmail(email, finalSubject || '(No Subject)', html);
          results.push({ email: email, ok: r && r.ok !== false });
        } catch(e) {
          results.push({ email: email, ok: false, error: e.message });
        }
      }
      return json(res, 200, { ok: true, sent: results.filter(function(r){ return r.ok; }).length, failed: results.filter(function(r){ return !r.ok; }).length, results: results });
    } catch (e) {
      return json(res, 400, { error: "Failed to send bulk email: " + e.message });
    }
  }

  if (urlPath.startsWith("/api/admin/user/") && urlPath.endsWith("/dashboard") && req.method === "GET") {
    if (!requireAdmin(user)) return json(res, 403, { error: "Admin only." });
    try {
      const targetId = urlPath.split('/')[4];
      const target = db.users.find(item => item.id === targetId);
      if (!target) return json(res, 404, { error: "User not found." });
      const ecoLib = require("./lib/ecosystem-db");
      const ecoDb = ecoLib.getDb();
      const memberRows = ecoLib.getUserGymMembers(targetId);
      const payments = ecoDb.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').all(targetId);
      const storage = db.storage[targetId] || {};
      const storageKeys = Object.keys(storage);
      ecoDb.close();
      return json(res, 200, {
        ok: true,
        user: { id: target.id, email: target.email, company: target.company, plan: target.plan, paid: target.paid, isAdmin: target.isAdmin },
        gymMembers: memberRows,
        payments: payments,
        storageKeys: storageKeys
      });
    } catch (e) {
      return json(res, 400, { error: "Failed to load user dashboard: " + e.message });
    }
  }

  // ============ EXPORT / IMPORT ============
  if (urlPath.startsWith("/api/export/") && req.method === "GET") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    const module = urlPath.split("/").pop();
    const format = new URL(req.url, "http://localhost").searchParams.get("format") || "csv";
    const userData = db.storage[user.id] || {};
    const data = getModuleData(db, userData, module);
    if (!data.length) return json(res, 200, { ok: true, count: 0, message: "No data to export." });
    if (format === "json") {
      const result = exportToJSON(data, module);
      return json(res, 200, { ok: true, ...result });
    }
    const result = exportToCSV(data, module);
    return json(res, 200, { ok: true, ...result });
  }

  if (urlPath === "/api/import" && req.method === "POST") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    try {
      const body = await parseBody(req);
      if (!body.content || !body.filename || !body.module) {
        return json(res, 400, { error: "content, filename, and module required." });
      }
      const parsed = parseImportFile(body.content, body.filename);
      if (!parsed.ok) return json(res, 400, { error: parsed.error });
      const userData = db.storage[user.id] || {};
      const existing = getModuleData(db, userData, body.module);
      const key = body.module;
      userData[key] = JSON.stringify([...existing, ...parsed.data]);
      db.storage[user.id] = userData;
      writeDb(db);
      return json(res, 200, { ok: true, imported: parsed.data.length, total: existing.length + parsed.data.length });
    } catch (e) {
      return json(res, 400, { error: "Invalid import data." });
    }
  }

  // ============ AI CHAT (Enhanced) ============
  if (urlPath === "/api/ai/chat-v2" && req.method === "POST") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    try {
      const body = await parseBody(req);
      const userData = db.storage[user.id] || {};
      const context = {
        user: sanitizeUser(user),
        storageKeys: Object.keys(userData).slice(0, 20),
        moduleCount: Object.keys(userData).length
      };
      const messages = (body.messages || []).map(m => ({ role: m.role, content: m.content }));
      if (!messages.length && body.message) {
        messages.push({ role: "user", content: body.message });
      }
      const result = await aiChat(messages, context);
      return json(res, 200, result);
    } catch (e) {
      return json(res, 400, { error: "AI chat error." });
    }
  }

  if (urlPath === "/api/ai/report" && req.method === "POST") {
    if (!user || !user.isAdmin) return json(res, 403, { error: "Admin only." });
    try {
      const body = await parseBody(req);
      const result = await generateReport(body.data || {});
      return json(res, 200, result);
    } catch (e) {
      return json(res, 400, { error: "Report generation error." });
    }
  }

  if (urlPath === "/api/ai/predict" && req.method === "POST") {
    if (!user || !user.isAdmin) return json(res, 403, { error: "Admin only." });
    try {
      const body = await parseBody(req);
      const result = await predictSales(body.data || {});
      return json(res, 200, result);
    } catch (e) {
      return json(res, 400, { error: "Prediction error." });
    }
  }

  // ============ WHATSAPP ============
  if (urlPath === "/api/whatsapp/config" && req.method === "GET") {
    return json(res, 200, { ok: true, configured: isWhatsAppConfigured() });
  }

  if (urlPath === "/api/whatsapp/send" && req.method === "POST") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    if (!user.isAdmin && !hasPermission(db, user.id, "whatsapp.write")) return json(res, 403, { error: "Permission denied." });
    try {
      const body = await parseBody(req);
      const result = await sendWhatsAppMessage(body.to, body.message);
      return json(res, 200, result);
    } catch (e) {
      return json(res, 400, { error: "WhatsApp send error." });
    }
  }

  if (urlPath === "/api/whatsapp/broadcast" && req.method === "POST") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    if (!user.isAdmin && !hasPermission(db, user.id, "whatsapp.broadcast")) return json(res, 403, { error: "Permission denied." });
    try {
      const body = await parseBody(req);
      const results = await broadcastMessage(db, body.storeId || "", body.recipients || [], body.message || "", body.template);
      writeDb(db);
      return json(res, 200, { ok: true, results });
    } catch (e) {
      return json(res, 400, { error: "Broadcast error." });
    }
  }

  if (urlPath === "/api/whatsapp/webhook" && req.method === "GET") {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "ocean-sft-verify";
    try {
      const url = new URL(req.url, "http://localhost");
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token === verifyToken) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(challenge);
        return;
      }
    } catch (e) {}
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (urlPath === "/api/whatsapp/webhook" && req.method === "POST") {
    try {
      if (!verifyWebhookSignature(req)) {
        res.writeHead(401);
        res.end("Unauthorized");
        return;
      }
      const body = await parseBody(req);
      const results = processWebhookPayload(db, body);
      if (results && results.length) {
        for (const result of results) {
          if (result.reply) {
            await sendWhatsAppMessage(result.from, result.reply);
          }
          if (!db.whatsapp_messages) db.whatsapp_messages = [];
          db.whatsapp_messages.push({
            id: "wamsg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
            from: result.from,
            contactName: result.contactName,
            reply: result.reply,
            action: result.action,
            createdAt: new Date().toISOString()
          });
        }
        writeDb(db);
      }
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 200, { ok: true });
    }
  }

  if (urlPath === "/api/whatsapp/messages" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    const messages = (db.whatsapp_messages || []).slice(0, 200);
    return json(res, 200, { ok: true, messages });
  }

  if (urlPath === "/api/whatsapp/broadcast-log" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    const log = (db.whatsapp_broadcast_log || []).slice(0, 200);
    return json(res, 200, { ok: true, log });
  }

  // ============ USER MODULE DATA ============
  if (urlPath === "/api/user-data" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    const userData = db.storage[user.id] || {};
    return json(res, 200, { ok: true, data: userData });
  }

  if (urlPath === "/api/user-data" && req.method === "PUT") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    try {
      const body = await parseBody(req);
      db.storage[user.id] = body.data || {};
      writeDb(db);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 400, { error: "Invalid data." });
    }
  }

  if (urlPath === "/api/user-data" && req.method === "POST") {
    if (!user) return json(res, 401, { error: "Unauthorized" });
    try {
      const body = await parseBody(req);
      db.storage[user.id] = Object.assign({}, db.storage[user.id] || {}, body.data || {});
      writeDb(db);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 400, { error: "Invalid data." });
    }
  }

  // ============ ADMIN USER MANAGEMENT ============

  if (urlPath.startsWith("/api/admin/users/") && req.method === "PATCH") {
    if (!requireAdmin(user)) return json(res, 403, { error: "Admin only." });
    const userId = urlPath.split("/").filter(Boolean)[3];
    try {
const body = await parseBody(req);
      const target = db.users.find(item => item.id === userId);
      if (!target) return json(res, 404, { error: "User not found." });
      const prevPlan = target.plan;
      const prevAdmin = Boolean(target.isAdmin);
      if (body.plan) {
        target.plan = body.plan;
        target.paid = body.plan !== "Free";
        target.premiumActive = body.plan === "Pro";
      }
      if (typeof body.isAdmin === "boolean") target.isAdmin = body.isAdmin;
      if (body.resetAddUsage) target.addUsage = 0;
      writeDb(db);
      // Notify the user when their admin role or plan changes
      if (target.email) {
        const emailTemplates = require("./services/email-templates");
        if (typeof body.isAdmin === "boolean" && Boolean(body.isAdmin) !== prevAdmin) {
          sendEmail(target.email, body.isAdmin ? "You are now an Ocean SFT Admin" : "Your Admin Access Has Been Removed",
            emailTemplates.accountRoleEmail(target.company || target.email, body.isAdmin ? "admin" : "user")).catch(function(){});
        }
        if (body.plan && body.plan !== prevPlan) {
          var expiryLabel = target.subscriptionExpiry ? new Date(target.subscriptionExpiry).toLocaleDateString() : "";
          sendEmail(target.email, "Your Plan Has Been Updated - Ocean SFT",
            emailTemplates.planUpdatedEmail(target.company || target.email, body.plan, expiryLabel)).catch(function(){});
        }
      }
      return json(res, 200, { ok: true, user: sanitizeUser(target) });
    } catch (error) {
      return json(res, 400, { error: "Invalid user update payload." });
    }
  }

  if (urlPath.startsWith("/api/admin/users/") && req.method === "DELETE") {
    if (!requireAdmin(user)) return json(res, 403, { error: "Admin only." });
    const userId = urlPath.split("/").filter(Boolean)[3];
    db.users = db.users.filter(item => item.id !== userId);
    db.sessions = db.sessions.filter(item => item.userId !== userId);
    delete db.storage[userId];
    writeDb(db);
    return json(res, 200, { ok: true });
  }

  // Ecosystem API routes (stores, menu, orders, reviews)
  if (urlPath.startsWith('/api/ecosystem/')) {
    if (!ECO_SQLITE_OK) {
      if (urlPath === '/api/ecosystem/stores' || urlPath === '/api/ecosystem/memberships') {
        return json(res, 200, { ok: true, stores: [], memberships: [], disabled: true });
      }
      return json(res, 503, { ok: false, error: 'Store database is temporarily unavailable on this server (no working SQLite driver).' });
    }
    const ecoResult = await handleEcosystem(req, res, user);
    if (ecoResult !== null) return;
  }
      // Cloud Storage API routes (universal localStorage-to-server sync)
  if (urlPath.startsWith('/api/storage/')) {
    const cloudStorage = require('./services/cloud-storage-api');
    const storageResult = await cloudStorage.handleRoutes(urlPath, req, res, user);
    if (storageResult !== false) return;
  }

  // SuperShop API routes
  if (urlPath.startsWith('/api/supershop/')) {
    const ss = require('./routes/supershop');
    const ssResult = await ss.handleRoutes(urlPath, req, res, user, db, writeDb);
    if (ssResult !== false) return;
  }

  // Health check endpoint
  if (urlPath === '/api/health' && req.method === 'GET') {
    return json(res, 200, { ok: true, status: 'healthy', timestamp: new Date().toISOString() });
  }

  serveStatic(req, res);
  } catch (err) {
    console.error("Request error:", err.message);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Internal server error");
    }
  }
});

process.on("uncaughtException", function (e) {
  try {
    writeBootStatus("CRASH (uncaughtException): " + (e && e.stack ? e.stack : e));
  } catch (x) {}
  process.exit(1);
});

process.on("unhandledRejection", function (reason) {
  try {
    writeBootStatus("CRASH (unhandledRejection): " + (reason && reason.stack ? reason.stack : reason));
  } catch (x) {}
  process.exit(1);
});

server.on("error", function (e) {
  try {
    writeBootStatus("LISTEN FAILED: " + (e && e.stack ? e.stack : e));
  } catch (x) {}
  console.error("Server error:", e);
});

server.listen(PORT, () => {
  writeBootStatus("STARTED " + new Date().toISOString() + " (node " + process.version + ", sqlite: " + (ECO_SQLITE_DRIVER || "none") + ") on port " + PORT);
  console.log("Ocean SFT server running on http://localhost:" + PORT);
});

