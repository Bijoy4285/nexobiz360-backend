// lib/cloud-storage-api.js
// ==========================================================
// এটা একটা "ইউনিভার্সাল" স্টোরেজ সিস্টেম। ফ্রন্টএন্ডের localStorage
// এর যেকোনো key (ocean_pos_customers, ocean_crm_leads ইত্যাদি)
// এখানে সেভ/লোড করা যাবে, প্রতিটা ইউজারের জন্য আলাদা আলাদা।
// প্রতিটা মডিউলের জন্য নতুন করে কোড লেখার দরকার নেই।
// ==========================================================

var { getUserDb, generateId } = require('./ecosystem-db');

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise(function(resolve, reject) {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      try { resolve(JSON.parse(body || '{}')); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

function ownerId(user) {
  return user ? String(user.id || user.email || '') : '';
}

// প্রতিটা ইউজারের নিজস্ব SQLite ফাইলে একটা "user_storage" টেবিল বানানো হয়
function ensureStorageTable(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS user_storage (" +
    "storage_key TEXT PRIMARY KEY, " +
    "storage_value TEXT NOT NULL DEFAULT '', " +
    "updated_at TEXT DEFAULT (datetime('now'))" +
    ")"
  );
}

function saveUserStorage(userId, key, value) {
  var db = getUserDb(userId, []);
  try {
    ensureStorageTable(db);
    var strValue = typeof value === 'string' ? value : JSON.stringify(value);
    var existing = db.prepare('SELECT storage_key FROM user_storage WHERE storage_key = ?').get(key);
    if (existing) {
      db.prepare("UPDATE user_storage SET storage_value = ?, updated_at = datetime('now') WHERE storage_key = ?")
        .run(strValue, key);
    } else {
      db.prepare('INSERT INTO user_storage (storage_key, storage_value) VALUES (?, ?)')
        .run(key, strValue);
    }
  } finally {
    try { db.close(); } catch (e) {}
  }
}

function loadUserStorage(userId, key) {
  var db = getUserDb(userId, []);
  try {
    ensureStorageTable(db);
    var row = db.prepare('SELECT storage_value FROM user_storage WHERE storage_key = ?').get(key);
    return row ? row.storage_value : null;
  } finally {
    try { db.close(); } catch (e) {}
  }
}

function loadAllUserStorage(userId) {
  var db = getUserDb(userId, []);
  try {
    ensureStorageTable(db);
    var rows = db.prepare('SELECT storage_key, storage_value FROM user_storage').all();
    var out = {};
    rows.forEach(function(r) { out[r.storage_key] = r.storage_value; });
    return out;
  } finally {
    try { db.close(); } catch (e) {}
  }
}

// ==========================================================
// মূল হ্যান্ডলার — server.js থেকে এটা কল হবে
// ==========================================================
function handleCloudStorage(req, res, user) {
  var urlPath = req.url.split('?')[0];
  var method = req.method;

  if (!user) {
    json(res, 401, { error: 'Unauthorized' });
    return true;
  }

  var uid = ownerId(user);

  // ---- একটা key সেভ করা ----
  if (urlPath === '/api/storage/save' && method === 'POST') {
    parseBody(req).then(function(body) {
      var key = String(body.key || '');
      if (!key) return json(res, 400, { error: 'key is required' });
      try {
        saveUserStorage(uid, key, body.value);
        json(res, 200, { ok: true });
      } catch (e) {
        console.error('[cloud-storage] save error:', e.message);
        json(res, 500, { error: 'Save failed.' });
      }
    });
    return true;
  }

  // ---- একটা key লোড করা ----
  if (urlPath === '/api/storage/load' && method === 'GET') {
    try {
      var u = new URL(req.url, 'http://localhost');
      var key = u.searchParams.get('key') || '';
      if (!key) return json(res, 400, { error: 'key is required' });
      var value = loadUserStorage(uid, key);
      json(res, 200, { ok: true, value: value });
    } catch (e) {
      console.error('[cloud-storage] load error:', e.message);
      json(res, 500, { error: 'Load failed.' });
    }
    return true;
  }

  // ---- একবারে সব key লোড করা (দ্রুত পেজ লোড হওয়ার জন্য) ----
  if (urlPath === '/api/storage/load-all' && method === 'GET') {
    try {
      var all = loadAllUserStorage(uid);
      json(res, 200, { ok: true, data: all });
    } catch (e) {
      console.error('[cloud-storage] load-all error:', e.message);
      json(res, 500, { error: 'Load failed.' });
    }
    return true;
  }

  // ---- একবারে অনেকগুলো key সেভ করা (ব্যাচ, দ্রুত হওয়ার জন্য) ----
  if (urlPath === '/api/storage/save-batch' && method === 'POST') {
    parseBody(req).then(function(body) {
      var items = body.items || {};
      try {
        var db = getUserDb(uid, []);
        ensureStorageTable(db);
        var upsert = db.prepare(
          "INSERT INTO user_storage (storage_key, storage_value, updated_at) VALUES (?, ?, datetime('now')) " +
          "ON CONFLICT(storage_key) DO UPDATE SET storage_value = excluded.storage_value, updated_at = datetime('now')"
        );
        Object.keys(items).forEach(function(key) {
          var v = items[key];
          var strValue = typeof v === 'string' ? v : JSON.stringify(v);
          upsert.run(key, strValue);
        });
        db.close();
        json(res, 200, { ok: true, count: Object.keys(items).length });
      } catch (e) {
        console.error('[cloud-storage] save-batch error:', e.message);
        json(res, 500, { error: 'Save failed.' });
      }
    });
    return true;
  }

  return false; // এই route এর জন্য না
}

module.exports = { handleCloudStorage, saveUserStorage, loadUserStorage, loadAllUserStorage };
