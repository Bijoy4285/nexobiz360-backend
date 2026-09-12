const fs = require("fs");
const path = require("path");
const { DATA_DIR, DB_FILE, ensureDataDir } = require("./data-config");

function baseSchema() {
  return {
    meta: {
      schemaVersion: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    users: [],
    sessions: [],
    storage: {},
    platform: {},
    tickets: [],
    ticket_messages: [],
    incidents: [],
    ai_actions: [],
    alerts: [],
    system_logs: [],
    monitoring_events: [],
    customer_context: [],
    escalation_queue: [],
    user_roles: [],
    payments: [],
     whatsapp_messages: [],
    whatsapp_broadcast_log: [],
    pharmacy_docs: [],
    gym_docs: [],
    jobs: [],
    services: []
  };
}

function ensureDir() {
  ensureDataDir(DATA_DIR);
}

function ensureDb() {
  ensureDir();
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(baseSchema(), null, 2));
  }
}

function normalize(db) {
  const fresh = baseSchema();
  const next = Object.assign({}, fresh, db || {});
  Object.keys(fresh).forEach(key => {
    if (Array.isArray(fresh[key])) next[key] = Array.isArray(next[key]) ? next[key] : [];
  });
  next.storage = next.storage && typeof next.storage === "object" ? next.storage : {};
  next.platform = next.platform && typeof next.platform === "object" ? next.platform : {};
  next.meta = Object.assign({}, fresh.meta, next.meta || {}, { schemaVersion: 3, updatedAt: new Date().toISOString() });
  return next;
}

function readDb() {
  ensureDb();
  const raw = fs.readFileSync(DB_FILE, "utf8");
  const parsed = raw ? JSON.parse(raw) : {};
  const db = normalize(parsed);
  if (JSON.stringify(parsed) !== JSON.stringify(db)) writeDb(db);
  return db;
}

function writeDb(db) {
  ensureDir();
  const next = normalize(db);
  next.meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(DB_FILE, JSON.stringify(next, null, 2));
}

function createId(prefix) {
  return prefix + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

module.exports = {
  DATA_DIR,
  DB_FILE,
  ensureDb,
  readDb,
  writeDb,
  createId,
  baseSchema
};
