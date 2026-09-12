const crypto = require("crypto");
const { createId } = require("./db");

const ADMIN_EMAILS = ["mamtoolsper@gmail.com", "oceansfthq@gmail.com", "admin@oceansft.com"];
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
  return user.passwordHash === createPasswordHash(password, user.salt);
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
  var endMs = now.getTime() + months * 30 * 24 * 60 * 60 * 1000;
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
  db.sessions = db.sessions.filter(session => session.userId !== userId);
  db.sessions.push({ token, userId, createdAt: new Date().toISOString(), expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function getSessionUser(db, req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const now = Date.now();
  const active = [];
  let session = null;
  db.sessions.forEach(item => {
    if (item.expiresAt && item.expiresAt < now) return;
    if (item.token === token) session = item;
    active.push(item);
  });
  if (active.length !== db.sessions.length) db.sessions = active;
  if (!session) return null;
  const found = db.users.find(user => user.id === session.userId) || null;
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
  migrateUsers
};
