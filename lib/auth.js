const crypto = require("crypto");
const { createId } = require("./db");

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "shahrabbibijoy@gmail.com,weavestackit@gmail.com").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000; // 3 days grace after expiry

function isAdminEmail(email) {
  return ADMIN_EMAILS.indexOf(String(email || "").toLowerCase().trim()) !== -1;
}

// A user is an admin if their email is whitelisted OR they were explicitly
// granted the admin role on their stored account (isAdmin === true).
function isAdminUser(user) {
  return Boolean(user && (user.isAdmin === true || isAdminEmail(user.email)));
}

function createPasswordHash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function makeUser(company, email, phone, country, password, isAdmin) {
  const salt = crypto.randomBytes(16).toString("hex");
  const forced = isAdminEmail(email);
  const granted = Boolean(isAdmin);
  return {
    id: createId("user"),
    company,
    email: String(email || "").toLowerCase(),
    phone: String(phone || "").trim(),
    country: country || "",
    salt,
    passwordHash: createPasswordHash(password, salt),
    plan: (forced || granted) ? "Admin" : "Free",
    paid: forced || granted,
    isAdmin: forced || granted,
addUsage: 0,
    photoURL: "",
    authProvider: "",
    subscriptionExpiry: "",
    subscriptionMonths: 0,
    lastRenewalDate: "",
    settings: {}
  };
}

function verifyPassword(user, password) {
  const storedHash = Buffer.from(String(user.passwordHash || ""), "utf8");
  const givenHash = Buffer.from(createPasswordHash(password, user.salt), "utf8");
  return storedHash.length === givenHash.length && crypto.timingSafeEqual(storedHash, givenHash);
}

function sanitizeUser(user) {
  if (!user) return null;
  const forced = isAdminEmail(user.email);
  const granted = Boolean(user.isAdmin);
  return {
    id: user.id,
    company: user.company,
    email: user.email,
    phone: user.phone || "",
    country: user.country || "",
    plan: (forced || granted) ? "Admin" : (user.plan || "Free"),
    paid: forced || granted || Boolean(user.paid),
    isAdmin: forced || granted,
    addUsage: Number(user.addUsage || 0),
    photoURL: user.photoURL || "",
    subscriptionExpiry: user.subscriptionExpiry || "",
    subscriptionMonths: Number(user.subscriptionMonths || 0),
    lastRenewalDate: user.lastRenewalDate || ""
  };
}

function isSubscriptionActive(user) {
  if (!user) return false;
  if (isAdminUser(user)) return true;
  if (!user.paid || user.plan === "Free") return false;
  if (!user.subscriptionExpiry) return Boolean(user.paid);
  var expiryMs = new Date(user.subscriptionExpiry).getTime();
  if (isNaN(expiryMs)) return Boolean(user.paid);
  return Date.now() <= expiryMs + GRACE_PERIOD_MS;
}

function getSubscriptionDaysLeft(user) {
  if (!user || isAdminUser(user)) return Infinity;
  if (!user.subscriptionExpiry) return user.paid ? -1 : 0;
  var expiryMs = new Date(user.subscriptionExpiry).getTime();
  if (isNaN(expiryMs)) return 0;
  var diff = expiryMs - Date.now();
  if (diff < -GRACE_PERIOD_MS) return -3;
  if (diff < 0) return 0;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

function setSubscription(user, months) {
  var now = new Date();
  var startStr = now.toISOString();
var baseMs = now.getTime();
  var currentMs = user.subscriptionExpiry ? new Date(user.subscriptionExpiry).getTime() : NaN;
  if (user.paid && !isNaN(currentMs) && currentMs > baseMs) baseMs = currentMs;
  var endMs = baseMs + months * 30 * 24 * 60 * 60 * 1000;
  user.subscriptionExpiry = new Date(endMs).toISOString();
  user.subscriptionMonths = months;
  user.lastRenewalDate = startStr;
  user.paid = true;
  if (user.plan === "Free") user.plan = "Pro";
  return user;
}

function migrateUsers(users) {
  users.forEach(function(u) {
    if (typeof u.subscriptionExpiry === "undefined") u.subscriptionExpiry = "";
    if (typeof u.subscriptionMonths === "undefined") u.subscriptionMonths = 0;
    if (typeof u.lastRenewalDate === "undefined") u.lastRenewalDate = "";
    if (typeof u.settings === "undefined" || u.settings === null || typeof u.settings !== "object") u.settings = {};
  });
}

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_DAYS || 30) * 24 * 60 * 60 * 1000;

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();

  if (!Array.isArray(db.sessions)) db.sessions = [];

  db.sessions = db.sessions.filter(function (session) {
    if (!session || !session.token || !session.userId) return false;

    const expiresAt = Number(session.expiresAt || 0);
    if (expiresAt > 0) return expiresAt > now;

    const createdAt = new Date(session.createdAt || "").getTime();
    return !isNaN(createdAt) && createdAt + SESSION_TTL_MS > now;
  });

  const ownSessions = db.sessions
    .filter(function (session) {
      return String(session.userId) === String(userId);
    })
    .sort(function (a, b) {
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });

  if (ownSessions.length >= 10) {
    const keepTokens = new Set(ownSessions.slice(0, 9).map(function (session) {
      return session.token;
    }));

    db.sessions = db.sessions.filter(function (session) {
      return String(session.userId) !== String(userId) || keepTokens.has(session.token);
    });
  }

  db.sessions.push({
    token,
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + SESSION_TTL_MS
  });

  return token;
}
function getSessionUser(db, req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;

  if (!Array.isArray(db.sessions)) db.sessions = [];

  const now = Date.now();
  const active = [];
  let session = null;

  db.sessions.forEach(function (item) {
    if (!item || !item.token || !item.userId) return;

    const expiresAt = Number(item.expiresAt || 0);
    const createdAt = new Date(item.createdAt || "").getTime();
    const isActive = expiresAt > 0
      ? expiresAt > now
      : (!isNaN(createdAt) && createdAt + SESSION_TTL_MS > now);

    if (!isActive) return;
    if (item.token === token) session = item;
    active.push(item);
  });

  if (active.length !== db.sessions.length) db.sessions = active;
  if (!session) return null;

  const found = db.users.find(function (user) {
    return String(user.id) === String(session.userId);
  }) || null;

  if (found) found.isAdmin = isAdminEmail(found.email) || Boolean(found.isAdmin);
  return found;
}

function requireAdmin(user) {
  return Boolean(user && isAdminUser(user));
}

function makeGoogleUser(name, email, photo) {
  const salt = crypto.randomBytes(16).toString("hex");
  const password = crypto.randomBytes(32).toString("hex");
  const forced = isAdminEmail(email);
  return {
    id: createId("user"),
    company: name || email.split("@")[0],
    email: String(email || "").toLowerCase(),
    phone: "",
    country: "",
    salt,
    passwordHash: createPasswordHash(password, salt),
    plan: forced ? "Admin" : "Free",
    paid: forced,
    isAdmin: forced,
    addUsage: 0,
    photoURL: photo || "",
    authProvider: "google",
    subscriptionExpiry: "",
    subscriptionMonths: 0,
    lastRenewalDate: "",
    settings: {}
  };
}

// ============================================================
// PASSWORD RESET — Step 1: Token generate & verify logic
// ============================================================

function createPasswordResetToken(db, userId) {
  if (!Array.isArray(db.password_resets)) db.password_resets = [];

  const now = Date.now();

  db.password_resets = db.password_resets.filter(function (r) {
    if (!r || !r.tokenHash || !r.userId) return false;
    if (r.used || Number(r.expiresAt || 0) <= now) return false;
    return String(r.userId) !== String(userId);
  });

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  db.password_resets.push({
    id: "pr_" + now + "_" + Math.random().toString(36).slice(2, 8),
    userId: userId,
    tokenHash: tokenHash,
    expiresAt: now + 30 * 60 * 1000,
    used: false,
    createdAt: new Date(now).toISOString()
  });

  return rawToken;
}

function verifyPasswordResetToken(db, rawToken) {
  if (!Array.isArray(db.password_resets)) return null;

  const tokenHash = crypto.createHash("sha256").update(String(rawToken || "")).digest("hex");

  const entry = db.password_resets.find(function (r) {
    return r.tokenHash === tokenHash && !r.used && r.expiresAt > Date.now();
  });

  return entry || null;
}

function consumePasswordResetToken(entry) {
  entry.used = true;
  entry.usedAt = new Date().toISOString();
}
module.exports = {
  createPasswordHash,
  makeUser,
  makeGoogleUser,
  verifyPassword,
  sanitizeUser,
  createSession,
  getSessionUser,
  requireAdmin,
  isAdminEmail,
  isAdminUser,
  ADMIN_EMAILS,
  isSubscriptionActive,
  getSubscriptionDaysLeft,
  setSubscription,
  migrateUsers,
  createPasswordResetToken,
  verifyPasswordResetToken,
  consumePasswordResetToken
};
