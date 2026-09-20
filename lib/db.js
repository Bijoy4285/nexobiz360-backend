const { MongoClient } = require("mongodb");
const { MONGO_URI, MONGO_DB_NAME } = require("./data-config");

let client = null;
let dbInstance = null;
let cachedDoc = null;
let connectingPromise = null; // prevents multiple simultaneous connect attempts
let writeQueue = Promise.resolve();

const DOC_ID = "app_main";

function cloneDoc(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

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
  if (connectingPromise) return connectingPromise; // avoid duplicate connect() calls

  if (!MONGO_URI) {
    throw new Error("OCEAN_MONGO_URI environment variable is not set.");
  }

  connectingPromise = (async () => {
    const c = new MongoClient(MONGO_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000
    });

    // If the connection drops later, reset so the next call reconnects.
    c.on("close", () => {
      console.error("MongoDB connection closed — will reconnect on next request.");
      client = null;
      dbInstance = null;
    });
    c.on("error", (err) => {
      console.error("MongoDB client error:", err.message);
    });

    await c.connect();
    client = c;
    connectingPromise = null;
    return c;
  })();

  return connectingPromise;
}

async function getCollection() {
  const c = await getClient(); // always verify client is alive first
  if (!dbInstance) {
    dbInstance = c.db(MONGO_DB_NAME);
  }
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

function readDb() {
  if (!cachedDoc) {
    cachedDoc = baseSchema();
  }
  return cachedDoc;
}

// Retry-once wrapper: if the write fails because of a closed topology,
// force a fresh connection and try exactly one more time before giving up.
async function persistWithRetry(next, attempt = 0) {
  try {
    const col = await getCollection();
    await col.replaceOne({ _id: DOC_ID }, next, { upsert: true });
    return true;
  } catch (err) {
    console.error("MongoDB writeDb error:", err && err.message ? err.message : err);

    const isTopologyError = /topology|closed|not connected|server selection/i.test(err.message || "");

    if (isTopologyError && attempt < 1) {
      client = null;
      dbInstance = null;
      connectingPromise = null;
      return persistWithRetry(next, attempt + 1);
    }

    throw err;
  }
}

function writeDb(db) {
  const next = normalize(cloneDoc(db));
  next.meta.updatedAt = new Date().toISOString();

  cachedDoc = next;

  const snapshot = cloneDoc(next);

  writeQueue = writeQueue
    .then(() => persistWithRetry(snapshot, 0))
    .catch((err) => {
      console.error("MongoDB write queue failed:", err && err.message ? err.message : err);
    });

  return cachedDoc;
}

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
