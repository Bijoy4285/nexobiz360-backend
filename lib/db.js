const { MongoClient } = require("mongodb");
const { MONGO_URI, MONGO_DB_NAME } = require("./data-config");

let client = null;
let dbInstance = null;
let cachedDoc = null; // in-memory cache of the single "app data" document

const DOC_ID = "app_main"; // fixed id for the single document holding all app data

function baseSchema() {
  return {
    _id: DOC_ID,
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

async function getClient() {
  if (client) return client;
  if (!MONGO_URI) {
    throw new Error("OCEAN_MONGO_URI environment variable is not set.");
  }
  client = new MongoClient(MONGO_URI);
  await client.connect();
  return client;
}

async function getCollection() {
  if (dbInstance) return dbInstance.collection("app_data");
  const c = await getClient();
  dbInstance = c.db(MONGO_DB_NAME);
  return dbInstance.collection("app_data");
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
  next._id = DOC_ID;
  return next;
}

// Synchronous-looking API kept for compatibility with the rest of the app.
// We load the doc into memory on boot, and every readDb() call returns the
// cached copy (fast, no await needed at call sites). writeDb() updates the
// cache immediately AND persists to MongoDB in the background.
function readDb() {
  if (!cachedDoc) {
    // First call before initDb() finished — return a safe empty schema
    // so the app doesn't crash. initDb() (called at boot) will populate
    // cachedDoc shortly after.
    cachedDoc = baseSchema();
  }
  return cachedDoc;
}

function writeDb(db) {
  const next = normalize(db);
  next.meta.updatedAt = new Date().toISOString();
  cachedDoc = next;
  // Persist to MongoDB (fire-and-forget, but logs errors).
  getCollection()
    .then(col => col.replaceOne({ _id: DOC_ID }, next, { upsert: true }))
    .catch(err => console.error("MongoDB writeDb error:", err.message));
  return cachedDoc;
}

// Must be called once at server boot (awaited) before handling requests.
async function initDb() {
  const col = await getCollection();
  let doc = await col.findOne({ _id: DOC_ID });
  if (!doc) {
    doc = baseSchema();
    await col.insertOne(doc);
  }
  cachedDoc = normalize(doc);
  return cachedDoc;
}

function createId(prefix) {
  return prefix + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

module.exports = {
  initDb,
  readDb,
  writeDb,
  createId,
  baseSchema
};
