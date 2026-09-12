// SQLite driver stack:
//   1. better-sqlite3 (native prebuild; fails on old-glibc servers like CentOS 7
//      with "version `GLIBC_2.29' not found")
//   2. node:sqlite (built into Node 22.13+, no native module needed)
// The first driver that can actually OPEN a database wins. If none works the
// app keeps running with store features disabled (SQLITE_OK = false).
var BS3 = null;
var NS = null;
try { BS3 = require('better-sqlite3'); } catch (e) {}
try { NS = require('node:sqlite'); } catch (e) {}

var DRIVER = null;
var DRIVER_REASON = '';

function tryDriver(name) {
  if (name === 'better-sqlite3' && BS3) {
    try {
      var probe = new BS3(':memory:');
      probe.close();
      DRIVER = 'better-sqlite3';
      return true;
    } catch (e) {
      DRIVER_REASON = 'better-sqlite3 cannot open databases: ' + (e && e.message ? e.message : e);
    }
  }
  if (name === 'node:sqlite' && NS) {
    try {
      var probe2 = new NS.DatabaseSync(':memory:');
      probe2.close();
      DRIVER = 'node:sqlite';
      return true;
    } catch (e) {
      DRIVER_REASON = 'node:sqlite cannot open databases: ' + (e && e.message ? e.message : e);
    }
  }
  return false;
}

tryDriver('better-sqlite3') || tryDriver('node:sqlite');
if (!DRIVER) {
  DRIVER_REASON = DRIVER_REASON || 'no SQLite driver available';
  console.error('[ecosystem-db] SQLite disabled: ' + DRIVER_REASON + '. Store features unavailable but app keeps running.');
}

function openDb(filePath) {
  if (DRIVER === 'better-sqlite3') return new BS3(filePath);
  if (DRIVER === 'node:sqlite') {
    var db = new NS.DatabaseSync(filePath);
    db.pragma = function (sql) { try { db.exec('PRAGMA ' + sql); } catch (e) {} };
    return db;
  }
  return null;
}

var path = require('path');
var fs = require('fs');

var DATA_DIR = require('./data-config').DATA_DIR;
var STORES_DIR = require('./data-config').STORES_DIR;
var DB_PATH = require('./data-config').ECOSYSTEM_DB;

function ensureStoresDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORES_DIR)) fs.mkdirSync(STORES_DIR, { recursive: true });
}

function getDb() {
  var db = openDb(DB_PATH);
  if (!db) throw new Error('Store database is temporarily unavailable on this server (no working SQLite driver)');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

// Per-user business tables, grouped by module. `stores`, `user_modules` and
// `payments` are intentionally NOT here - they stay in the global registry DB.
var MODULE_TABLES = {
  restaurant: [
    'menu_categories', 'menu_items', 'store_orders', 'order_items',
    'store_reviews', 'store_bookings', 'customer_messages'
  ],
  'qr-menu': ['menu_categories', 'menu_items', 'store_orders', 'order_items'],
  pos: ['store_orders', 'order_items', 'store_reviews', 'customer_messages'],
  retail: ['menu_items', 'store_orders', 'order_items', 'store_reviews', 'customer_messages'],
  hotel: ['store_bookings', 'customer_messages'],
  barber: ['store_bookings', 'customer_messages'],
  gym: ['gym_members', 'gym_checkins', 'gym_presence', 'gym_instructions', 'gym_plans', 'store_bookings',
    'gym_classes', 'gym_class_bookings', 'gym_member_profiles', 'gym_body_metrics',
    'gym_member_payments', 'gym_staff'],
  supershop: ['menu_items', 'cart_sessions', 'cart_items', 'supershop_customers', 'security_flags', 'store_orders', 'order_items']
};

function businessTableDdl(tableName) {
  var ddl = {
    menu_categories: 'CREATE TABLE IF NOT EXISTS menu_categories (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, name TEXT NOT NULL, sort_order INTEGER DEFAULT 0)',
    menu_items: 'CREATE TABLE IF NOT EXISTS menu_items (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, category_id TEXT, name TEXT NOT NULL, description TEXT DEFAULT \'\', price REAL NOT NULL DEFAULT 0, image_url TEXT DEFAULT \'\', is_available INTEGER DEFAULT 1, barcode TEXT DEFAULT \'\', stock_qty INTEGER DEFAULT -1, is_visible_to_customers INTEGER DEFAULT 1, regular_price REAL DEFAULT -1, shelf_location TEXT DEFAULT \'\', sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime(\'now\')))',
    store_orders: 'CREATE TABLE IF NOT EXISTS store_orders (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, table_number TEXT DEFAULT \'\', customer_name TEXT DEFAULT \'Guest\', customer_phone TEXT DEFAULT \'\', customer_email TEXT DEFAULT \'\', order_type TEXT DEFAULT \'dine_in\', status TEXT DEFAULT \'pending\', subtotal REAL DEFAULT 0, tax REAL DEFAULT 0, discount REAL DEFAULT 0, total REAL DEFAULT 0, note TEXT DEFAULT \'\', payment_method TEXT DEFAULT \'cash\', payment_status TEXT DEFAULT \'unpaid\', created_at TEXT DEFAULT (datetime(\'now\')), updated_at TEXT DEFAULT (datetime(\'now\')))',
    order_items: 'CREATE TABLE IF NOT EXISTS order_items (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, menu_item_id TEXT, name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, qty INTEGER NOT NULL DEFAULT 1, note TEXT DEFAULT \'\')',
    store_reviews: 'CREATE TABLE IF NOT EXISTS store_reviews (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, customer_name TEXT DEFAULT \'Anonymous\', customer_email TEXT DEFAULT \'\', rating INTEGER NOT NULL DEFAULT 5, comment TEXT DEFAULT \'\', reply TEXT DEFAULT \'\', is_approved INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime(\'now\')))',
    whatsapp_config: 'CREATE TABLE IF NOT EXISTS whatsapp_config (id TEXT PRIMARY KEY DEFAULT \'default\', store_id TEXT NOT NULL, phone_number_id TEXT DEFAULT \'\', access_token TEXT DEFAULT \'\', business_account_id TEXT DEFAULT \'\', webhook_verify_token TEXT DEFAULT \'\', is_active INTEGER DEFAULT 0, updated_at TEXT DEFAULT (datetime(\'now\')))',
    store_bookings: 'CREATE TABLE IF NOT EXISTS store_bookings (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, customer_name TEXT NOT NULL, customer_phone TEXT DEFAULT \'\', customer_email TEXT DEFAULT \'\', service_name TEXT DEFAULT \'\', booking_date TEXT NOT NULL, booking_time TEXT NOT NULL, status TEXT DEFAULT \'pending\', note TEXT DEFAULT \'\', created_at TEXT DEFAULT (datetime(\'now\')), updated_at TEXT DEFAULT (datetime(\'now\')))',
    customer_messages: 'CREATE TABLE IF NOT EXISTS customer_messages (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, channel TEXT DEFAULT \'web\', direction TEXT DEFAULT \'outbound\', recipient TEXT DEFAULT \'\', message TEXT NOT NULL, status TEXT DEFAULT \'queued\', related_type TEXT DEFAULT \'\', related_id TEXT DEFAULT \'\', created_at TEXT DEFAULT (datetime(\'now\')))',
    gym_members: 'CREATE TABLE IF NOT EXISTS gym_members (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, email TEXT NOT NULL DEFAULT \'\', name TEXT NOT NULL DEFAULT \'\', phone TEXT DEFAULT \'\', plan TEXT DEFAULT \'Basic\', price REAL DEFAULT 0, expiry TEXT DEFAULT \'\', status TEXT DEFAULT \'Active\', joined TEXT DEFAULT \'\', created_at TEXT DEFAULT (datetime(\'now\')), updated_at TEXT DEFAULT (datetime(\'now\')), UNIQUE(store_id, email))',
    gym_checkins: 'CREATE TABLE IF NOT EXISTS gym_checkins (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, member_email TEXT DEFAULT \'\', member_name TEXT DEFAULT \'\', date TEXT DEFAULT \'\', time TEXT DEFAULT \'\', lat REAL DEFAULT 0, lng REAL DEFAULT 0, distance REAL DEFAULT 0, source TEXT DEFAULT \'app\', created_at TEXT DEFAULT (datetime(\'now\')))',
    gym_presence: 'CREATE TABLE IF NOT EXISTS gym_presence (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, member_email TEXT NOT NULL, member_name TEXT DEFAULT \'\', entered_at TEXT DEFAULT \'\', last_seen TEXT DEFAULT \'\', lat REAL DEFAULT 0, lng REAL DEFAULT 0, distance REAL DEFAULT 0, device_id TEXT DEFAULT \'\', UNIQUE(store_id, member_email))',
    gym_instructions: 'CREATE TABLE IF NOT EXISTS gym_instructions (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, target TEXT DEFAULT \'all\', member_email TEXT DEFAULT \'\', title TEXT DEFAULT \'\', message TEXT DEFAULT \'\', author_name TEXT DEFAULT \'\', created_at TEXT DEFAULT (datetime(\'now\')))',
    gym_plans: 'CREATE TABLE IF NOT EXISTS gym_plans (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, name TEXT NOT NULL, price REAL DEFAULT 0, duration REAL DEFAULT 30, numeric_days INTEGER DEFAULT 30, features TEXT DEFAULT \'\', duration_days INTEGER DEFAULT 30, featured INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime(\'now\')))',
    gym_classes: 'CREATE TABLE IF NOT EXISTS gym_classes (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, name TEXT NOT NULL, trainer_id TEXT DEFAULT \'\', trainer_name TEXT DEFAULT \'\', description TEXT DEFAULT \'\', day INTEGER DEFAULT 0, start_time TEXT DEFAULT \'09:00\', end_time TEXT DEFAULT \'10:00\', capacity INTEGER DEFAULT 20, color TEXT DEFAULT \'#38bdf8\', is_recurring INTEGER DEFAULT 1, status TEXT DEFAULT \'active\', created_at TEXT DEFAULT (datetime(\'now\')))',
    gym_class_bookings: 'CREATE TABLE IF NOT EXISTS gym_class_bookings (id TEXT PRIMARY KEY, class_id TEXT NOT NULL, store_id TEXT NOT NULL, member_email TEXT NOT NULL DEFAULT \'\', member_name TEXT DEFAULT \'\', status TEXT DEFAULT \'booked\', attended INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime(\'now\')), UNIQUE(class_id, member_email))',
    gym_member_profiles: 'CREATE TABLE IF NOT EXISTS gym_member_profiles (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, member_id TEXT NOT NULL, height_cm REAL DEFAULT 0, gender TEXT DEFAULT \'\', dob TEXT DEFAULT \'\', goal TEXT DEFAULT \'\', activity_level TEXT DEFAULT \'moderate\', health_conditions TEXT DEFAULT \'\', emergency_contact TEXT DEFAULT \'\', emergency_phone TEXT DEFAULT \'\', notes TEXT DEFAULT \'\', updated_at TEXT DEFAULT (datetime(\'now\')), UNIQUE(member_id))',
    gym_body_metrics: 'CREATE TABLE IF NOT EXISTS gym_body_metrics (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, member_id TEXT NOT NULL, weight_kg REAL DEFAULT 0, body_fat REAL DEFAULT 0, muscle_kg REAL DEFAULT 0, bmi REAL DEFAULT 0, chest_cm REAL DEFAULT 0, waist_cm REAL DEFAULT 0, hip_cm REAL DEFAULT 0, bicep_cm REAL DEFAULT 0, thigh_cm REAL DEFAULT 0, measured_at TEXT DEFAULT (datetime(\'now\')))',
    gym_member_payments: 'CREATE TABLE IF NOT EXISTS gym_member_payments (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, member_id TEXT DEFAULT \'\', member_email TEXT DEFAULT \'\', member_name TEXT DEFAULT \'\', type TEXT DEFAULT \'renewal\', amount REAL DEFAULT 0, method TEXT DEFAULT \'cash\', reference TEXT DEFAULT \'\', note TEXT DEFAULT \'\', created_at TEXT DEFAULT (datetime(\'now\')))',
    gym_staff: 'CREATE TABLE IF NOT EXISTS gym_staff (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, name TEXT NOT NULL, role TEXT DEFAULT \'trainer\', email TEXT DEFAULT \'\', phone TEXT DEFAULT \'\', salary REAL DEFAULT 0, commission_pct REAL DEFAULT 0, specialty TEXT DEFAULT \'\', active INTEGER DEFAULT 1, joined TEXT DEFAULT \'\', created_at TEXT DEFAULT (datetime(\'now\')))',
    cart_sessions: 'CREATE TABLE IF NOT EXISTS cart_sessions (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, customer_id TEXT DEFAULT \'\', customer_phone TEXT DEFAULT \'\', customer_email TEXT DEFAULT \'\', status TEXT DEFAULT \'active\', qr_token TEXT DEFAULT \'\', last_scan_at TEXT DEFAULT \'\', created_at TEXT DEFAULT (datetime(\'now\')), closed_at TEXT DEFAULT \'\')',
    cart_items: 'CREATE TABLE IF NOT EXISTS cart_items (id TEXT PRIMARY KEY, cart_session_id TEXT NOT NULL, product_id TEXT NOT NULL, name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, qty INTEGER NOT NULL DEFAULT 1, price_at_scan REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime(\'now\')))',
    supershop_customers: 'CREATE TABLE IF NOT EXISTS supershop_customers (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, phone TEXT DEFAULT \'\', email TEXT DEFAULT \'\', name TEXT DEFAULT \'\', first_seen_at TEXT DEFAULT (datetime(\'now\')), last_seen_at TEXT DEFAULT (datetime(\'now\')), total_spend REAL DEFAULT 0, visit_count INTEGER DEFAULT 0, UNIQUE(store_id, phone), UNIQUE(store_id, email))',
    security_flags: 'CREATE TABLE IF NOT EXISTS security_flags (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, cart_session_id TEXT NOT NULL, reason TEXT DEFAULT \'abandoned\', flagged_at TEXT DEFAULT (datetime(\'now\')), resolved_by TEXT DEFAULT \'\', resolved_at TEXT DEFAULT \'\', status TEXT DEFAULT \'open\')',
    memberships: 'CREATE TABLE IF NOT EXISTS memberships (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, user_id TEXT DEFAULT \'\', member_email TEXT NOT NULL DEFAULT \'\', name TEXT DEFAULT \'\', phone TEXT DEFAULT \'\', module TEXT NOT NULL DEFAULT \'generic\', plan TEXT DEFAULT \'\', plan_label TEXT DEFAULT \'\', price REAL DEFAULT 0, status TEXT DEFAULT \'Active\', start TEXT DEFAULT \'\', expiry TEXT DEFAULT \'\', benefits TEXT DEFAULT \'\', member_code TEXT DEFAULT \'\', created_at TEXT DEFAULT (datetime(\'now\')), updated_at TEXT DEFAULT (datetime(\'now\')), UNIQUE(store_id, member_email, module))'
  };
  return ddl[tableName] || null;
}

// Tables that are safe to keep in every per-user DB regardless of module
// (used by shared store-detail / review flows).
var ALWAYS_TABLES = ['store_reviews', 'customer_messages', 'store_bookings', 'memberships'];

function provisionTables(db, tableNames) {
  var seen = {};
  tableNames.forEach(function(t) { seen[t] = true; });
  ALWAYS_TABLES.forEach(function(t) { seen[t] = true; });
  Object.keys(seen).forEach(function(name) {
    var ddl = businessTableDdl(name);
    if (ddl) db.exec(ddl);
  });
}

function getUserDbPath(userId) {
  return path.join(STORES_DIR, String(userId || 'anon').replace(/[^a-zA-Z0-9_-]/g, '_') + '.db');
}

// Open (and provision) a per-user DB file for the given modules.
// Tables for the modules the user owns are created on first access.
function getUserDb(userId, moduleKeys) {
  ensureStoresDir();
  var db = openDb(getUserDbPath(userId));
  if (!db) throw new Error('Store database is temporarily unavailable on this server (no working SQLite driver)');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  var keys = Array.isArray(moduleKeys) ? moduleKeys : [];
  var tables = [];
  keys.forEach(function(k) { (MODULE_TABLES[k] || []).forEach(function(t) { tables.push(t); }); });
  provisionTables(db, tables);
  if (tables.indexOf('gym_members') !== -1) {
    ensureColumn(db, 'gym_members', 'frozen_until', "TEXT DEFAULT ''");
    ensureColumn(db, 'gym_members', 'last_renewed', "TEXT DEFAULT ''");
  }
  if (tables.indexOf('menu_items') !== -1) {
    ensureColumn(db, 'menu_items', 'barcode', "TEXT DEFAULT ''");
    ensureColumn(db, 'menu_items', 'stock_qty', "INTEGER DEFAULT -1");
    ensureColumn(db, 'menu_items', 'is_visible_to_customers', "INTEGER DEFAULT 1");
    ensureColumn(db, 'menu_items', 'regular_price', "REAL DEFAULT -1");
    ensureColumn(db, 'menu_items', 'shelf_location', "TEXT DEFAULT ''");
  }
  return db;
}

// Explicitly create tables for newly purchased modules (idempotent).
function provisionUserDb(userId, moduleKeys) {
  var db = getUserDb(userId, moduleKeys);
  db.close();
}

function ensureColumn(db, tableName, columnName, definition) {
  var columns = db.prepare('PRAGMA table_info(' + tableName + ')').all();
  var exists = columns.some(function(col) { return col.name === columnName; });
  if (!exists) db.exec('ALTER TABLE ' + tableName + ' ADD COLUMN ' + columnName + ' ' + definition);
}

function initEcosystemDb() {
  if (!DRIVER) {
    console.error('[ecosystem-db] SQLite storage disabled: ' + DRIVER_REASON);
    return;
  }
  var db;
  try {
    db = getDb();
  } catch (e) {
    console.error('[ecosystem-db] init failed: ' + e.message);
    return;
  }
  try {

  db.exec('CREATE TABLE IF NOT EXISTS stores (\n' +
    'id TEXT PRIMARY KEY,\n' +
    'owner_id TEXT NOT NULL,\n' +
    'name TEXT NOT NULL,\n' +
    'type TEXT NOT NULL DEFAULT \'restaurant\',\n' +
    'description TEXT DEFAULT \'\',\n' +
    'address TEXT DEFAULT \'\',\n' +
    'phone TEXT DEFAULT \'\',\n' +
    'email TEXT DEFAULT \'\',\n' +
    'lat REAL DEFAULT 0,\n' +
    'lng REAL DEFAULT 0,\n' +
    'logo_url TEXT DEFAULT \'\',\n' +
    'cover_url TEXT DEFAULT \'\',\n' +
    'qr_code TEXT DEFAULT \'\',\n' +
    'is_active INTEGER DEFAULT 1,\n' +
    'created_at TEXT DEFAULT (datetime(\'now\'))\n' +
    ')');

  ensureColumn(db, 'stores', 'website_published', "INTEGER DEFAULT 0");
  ensureColumn(db, 'stores', 'trial_until', "TEXT DEFAULT ''");
  ensureColumn(db, 'stores', 'services_json', "TEXT DEFAULT '[]'");
  ensureColumn(db, 'stores', 'gallery_json', "TEXT DEFAULT '[]'");
  ensureColumn(db, 'stores', 'entry_qr_token', "TEXT DEFAULT ''");
  ensureColumn(db, 'stores', 'checkout_qr_token', "TEXT DEFAULT ''");
  ensureColumn(db, 'stores', 'supershop_enabled', "INTEGER DEFAULT 0");
  ensureColumn(db, 'stores', 'supermarket_enabled', "INTEGER DEFAULT 0");

  // Ensure menu_items has new columns in global DB
  try { ensureColumn(db, 'menu_items', 'barcode', "TEXT DEFAULT ''"); } catch(e) {}
  try { ensureColumn(db, 'menu_items', 'stock_qty', "INTEGER DEFAULT -1"); } catch(e) {}
  try { ensureColumn(db, 'menu_items', 'is_visible_to_customers', "INTEGER DEFAULT 1"); } catch(e) {}
  try { ensureColumn(db, 'menu_items', 'regular_price', "REAL DEFAULT -1"); } catch(e) {}
  try { ensureColumn(db, 'menu_items', 'shelf_location', "TEXT DEFAULT ''"); } catch(e) {}

  // SuperShop + shared order tables live in the global registry DB because the
  // customer/checkout routes are unauthenticated and fall back to it (demo stores
  // have empty owner_id). Create them idempotently so they always exist here.
  ['menu_items', 'cart_sessions', 'cart_items', 'supershop_customers', 'security_flags', 'store_orders', 'order_items'].forEach(function(t) {
    try { var ddl = businessTableDdl(t); if (ddl) db.exec(ddl); } catch(e) {}
  });

  db.exec('CREATE TABLE IF NOT EXISTS user_modules (\n' +
    'id TEXT PRIMARY KEY,\n' +
    'user_id TEXT NOT NULL,\n' +
    'module_key TEXT NOT NULL,\n' +
    'enabled INTEGER DEFAULT 1,\n' +
    'created_at TEXT DEFAULT (datetime(\'now\')),\n' +
    'UNIQUE(user_id, module_key)\n' +
    ')');

  db.exec('CREATE INDEX IF NOT EXISTS idx_user_modules_user ON user_modules(user_id)');

  db.exec('CREATE TABLE IF NOT EXISTS payments (\n' +
    'id TEXT PRIMARY KEY,\n' +
    'user_id TEXT NOT NULL,\n' +
    'email TEXT NOT NULL,\n' +
    'modules TEXT NOT NULL DEFAULT \'[]\',\n' +
    'module_names TEXT NOT NULL DEFAULT \'[]\',\n' +
    'amount REAL NOT NULL DEFAULT 0,\n' +
    'currency TEXT NOT NULL DEFAULT \'TK\',\n' +
    'bkash_number TEXT NOT NULL DEFAULT \'01876578110\',\n' +
    'transaction_id TEXT NOT NULL DEFAULT \'\',\n' +
    'screenshot TEXT DEFAULT \'\',\n' +
    'status TEXT NOT NULL DEFAULT \'pending\',\n' +
    'verified_by TEXT DEFAULT \'\',\n' +
    'verified_at TEXT DEFAULT \'\',\n' +
    'rejection_reason TEXT DEFAULT \'\',\n' +
    'created_at TEXT DEFAULT (datetime(\'now\'))\n' +
    ')');

  db.exec('CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)');
  ensureColumn(db, 'payments', 'store_id', "TEXT DEFAULT ''");

  db.exec('CREATE TABLE IF NOT EXISTS coupon_approvals (\n' +
    'id TEXT PRIMARY KEY,\n' +
    'store_id TEXT DEFAULT \'\',\n' +
    'user_id TEXT DEFAULT \'\',\n' +
    'email TEXT DEFAULT \'\',\n' +
    'code TEXT DEFAULT \'\',\n' +
    'months INTEGER DEFAULT 1,\n' +
    'modules TEXT DEFAULT \'[]\',\n' +
    'module_names TEXT DEFAULT \'\',\n' +
    'amount REAL DEFAULT 0,\n' +
'token TEXT DEFAULT \'\',\n' +
    'status TEXT NOT NULL DEFAULT \'pending\',\n' +
    'created_at TEXT DEFAULT (datetime(\'now\')),\n' +
    'decided_at TEXT DEFAULT \'\'\n' +
    ')');
  db.exec('CREATE INDEX IF NOT EXISTS idx_coupon_approvals_store ON coupon_approvals(store_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_coupon_approvals_status ON coupon_approvals(status)');
  ensureColumn(db, 'coupon_approvals', 'decided_by', "TEXT DEFAULT ''");

  // Legacy indexes kept for the global registry DB (no longer used by business
  // tables, which now live per user).
  } catch (e) {
    console.error('[ecosystem-db] init error: ' + (e && e.message ? e.message : e));
  } finally {
    try { db.close(); } catch (e) {}
  }
}

// One-time migration: move any legacy business rows still sitting in the
// global registry DB (from before the per-user split) into each store owner's
// own per-user SQLite file. Idempotent - skips owners already migrated.
var LEGACY_BUSINESS_TABLES = ['menu_categories','menu_items','store_orders','order_items','store_reviews','whatsapp_config','store_bookings','customer_messages','gym_members','gym_checkins','gym_presence','gym_instructions','gym_plans'];

function migrateLegacyData() {
  var g;
  try { g = getDb(); } catch(e) { return; }
  try {
    var hasBusiness = g.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='menu_categories'").get();
    if (!hasBusiness) { return; }
    var stores = g.prepare('SELECT * FROM stores').all();
    stores.forEach(function(s) {
      var ownerDb = getUserDb(s.owner_id || '', []);
      var all = [];
      Object.keys(MODULE_TABLES).forEach(function(k){ all = all.concat(MODULE_TABLES[k]); });
      provisionTables(ownerDb, all);
      var migrated = false;
      try { migrated = (ownerDb.prepare('SELECT COUNT(*) as cnt FROM menu_categories WHERE store_id = ?').get(s.id).cnt || 0) > 0; } catch(e) {}
      if (migrated) { try { ownerDb.close(); } catch(e){} return; }
      LEGACY_BUSINESS_TABLES.forEach(function(t) {
        try {
          var cols = g.prepare('PRAGMA table_info(' + t + ')').all().map(function(c){ return c.name; });
          if (!cols.length) return;
          var rows = g.prepare('SELECT * FROM ' + t + ' WHERE store_id = ?').all(s.id);
          if (!rows.length) return;
          var q = 'INSERT OR IGNORE INTO ' + t + ' (' + cols.join(',') + ') VALUES (' + cols.map(function(){ return '?'; }).join(',') + ')';
          var stmt = ownerDb.prepare(q);
          rows.forEach(function(r){ stmt.run.apply(stmt, cols.map(function(c){ return r[c]; })); });
        } catch(e) {}
      });
      try { ownerDb.close(); } catch(e) {}
    });
    console.log('Legacy business data migrated to per-user DBs.');
  } catch(e) {
    console.error('Legacy migration skipped:', e.message);
  } finally {
    try { g.close(); } catch(e) {}
  }
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function listUserDbs() {
  ensureStoresDir();
  var out = [];
  fs.readdirSync(STORES_DIR).forEach(function(file) {
    if (path.extname(file).toLowerCase() === '.db') {
      var userId = path.basename(file, '.db');
      out.push({ userId: userId, filePath: path.join(STORES_DIR, file) });
    }
  });
  return out;
}

// Global totals for business tables, aggregated across every per-user DB
// (business tables live per user; the registry DB only holds stores/payments).
function aggregateBusinessStats() {
  var stats = { totalMembers: 0, activeMembers: 0, totalOrders: 0, totalRevenue: 0, totalCheckins: 0, totalReviews: 0, avgRating: 0, reviewCount: 0 };
  var ratingSum = 0;
  listUserDbs().forEach(function(entry) {
    var db;
    try { db = openDb(entry.filePath); } catch (e) { return; }
    try {
      try { stats.totalMembers += db.prepare('SELECT COUNT(*) AS c FROM gym_members').get().c || 0; } catch (e) {}
      try { stats.activeMembers += db.prepare("SELECT COUNT(*) AS c FROM gym_members WHERE status = 'Active' AND (expiry IS NULL OR expiry > datetime('now'))").get().c || 0; } catch (e) {}
      try { stats.totalOrders += db.prepare('SELECT COUNT(*) AS c FROM store_orders').get().c || 0; } catch (e) {}
      try { stats.totalRevenue += db.prepare('SELECT COALESCE(SUM(total),0) AS t FROM store_orders').get().t || 0; } catch (e) {}
      try { stats.totalCheckins += db.prepare('SELECT COUNT(*) AS c FROM gym_checkins').get().c || 0; } catch (e) {}
      try {
        var r = db.prepare('SELECT COUNT(*) AS c, COALESCE(AVG(rating),0) AS a FROM store_reviews WHERE is_approved = 1').get();
        if (r) { stats.totalReviews += r.c || 0; ratingSum += (r.a || 0) * (r.c || 0); }
      } catch (e) {}
    } finally {
      try { db.close(); } catch (e) {}
    }
  });
  if (stats.totalReviews > 0) stats.avgRating = ratingSum / stats.totalReviews;
  return stats;
}

// All gym member rows belonging to a user's stores (aggregated per-user).
function getUserGymMembers(userId) {
  var rows = [];
  var storeIds = [];
  var g;
  try { g = getDb(); } catch (e) {}
  try {
    if (g) storeIds = g.prepare('SELECT id FROM stores WHERE owner_id = ?').all(userId).map(function(r){ return r.id; });
  } catch (e) {}
  if (g) { try { g.close(); } catch (e) {} }
  if (!storeIds.length) return rows;
  var placeholders = storeIds.map(function(){ return '?'; }).join(',');
  listUserDbs().forEach(function(entry) {
    var db;
    try { db = openDb(entry.filePath); } catch (e) { return; }
    try {
      rows = rows.concat(db.prepare('SELECT * FROM gym_members WHERE store_id IN (' + placeholders + ')').all.apply(null, storeIds));
    } catch (e) {}
    try { db.close(); } catch (e) {}
  });
  return rows;
}

module.exports = {
  SQLITE_OK: !!DRIVER,
  SQLITE_DRIVER: DRIVER,
  SQLITE_REASON: DRIVER_REASON,
  getDb,
  getUserDb,
  getUserDbPath,
  provisionUserDb,
  provisionTables,
  ensureColumn,
  MODULE_TABLES,
  DB_PATH,
  STORES_DIR,
  listUserDbs,
  aggregateBusinessStats,
  getUserGymMembers,
  initEcosystemDb,
  migrateLegacyData,
  generateId
};
