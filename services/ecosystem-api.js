var { getUserDb, listUserDbs, DB_PATH, provisionUserDb, MODULE_TABLES, generateId } = require('../lib/ecosystem-db');
var { aiChat, isAIConfigured } = require('./ai-provider');
var emailTemplates = require('./email-templates');
var { sendEmail } = require('./notifications');
var { isAdminEmail } = require('../lib/auth');
var QRCode = null;
try { QRCode = require('qrcode'); } catch (e) {
  console.error('[ecosystem-api] qrcode unavailable (' + (e && e.message) + '). QR image generation disabled but app keeps running.');
}

function sendConfirmationEmail(to, subject, html, silent) {
  if (!to) return;
  var email = String(to).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  var p = sendEmail(email, subject, html);
  if (p && p.catch) p.catch(function(){}); else if (silent) {}
}
var KNOWN_MODULES = ['core','restaurant','pharmacy','hotel','barber','laundry','pos','gym','salon','tailor','website','whatsapp','qr-menu','invoice','accounting','crm','marketing','loyalty','hr-payroll','warehouses','supply-chain','scanner','parking','supershop'];
// Only the `core` storefront is free. All business modules require payment
// (or an approved free-trial coupon) — pay-per-module.
var FREE_MODULES = ['core'];

// Pay-per-module gate. A user may only enable modules that were granted to them
// (via payment or an approved trial) — `core` is free for everyone. Being
// `paid`/`Pro` alone does NOT unlock every module.
function canEnableModule(user, moduleKey, grantedModules) {
  if (moduleKey === 'core') return true;
  if (isAdminEmail(user.email)) return true;
  // Check subscription expiry with 3-day grace period
  if (user.subscriptionExpiry) {
    var expiryMs = new Date(user.subscriptionExpiry).getTime();
    var GRACE_MS = 3 * 24 * 60 * 60 * 1000;
    if (!isNaN(expiryMs) && Date.now() > expiryMs + GRACE_MS) return false;
  }
  var granted = Array.isArray(grantedModules) ? grantedModules : [];
  return granted.indexOf(moduleKey) !== -1;
}

function parseBody(req) {
  return new Promise(function(resolve, reject) {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      try { resolve(JSON.parse(body || '{}')); }
      catch(e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function slugify(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function safeJson(value, fallback) {
  try {
    var parsed = typeof value === 'string' ? JSON.parse(value || '') : value;
    return parsed === undefined || parsed === null ? fallback : parsed;
  } catch(e) {
    return fallback;
  }
}

function normalizeStore(store) {
  if (!store) return store;
  store.services = safeJson(store.services_json, []);
  store.gallery = safeJson(store.gallery_json, []);
  delete store.services_json;
  delete store.gallery_json;
  return store;
}

function queueMessage(db, storeId, channel, recipient, message, relatedType, relatedId) {
  var id = 'msg_' + generateId();
  db.prepare('INSERT INTO customer_messages (id, store_id, channel, recipient, message, related_type, related_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, storeId, channel || 'web', recipient || '', message, relatedType || '', relatedId || '');
  return db.prepare('SELECT * FROM customer_messages WHERE id = ?').get(id);
}

function ownerId(user) {
  return user ? String(user.id || user.email || '') : '';
}

function canManageStore(user, store) {
  if (!user || !store) return false;
  if (user.isAdmin) return true;
  var id = ownerId(user);
  return Boolean(id && String(store.owner_id || '') === id);
}

function requireLogin(res, user) {
  if (user) return false;
  json(res, 401, { error: 'Unauthorized' });
  return true;
}

function requireStoreOwner(res, user, store) {
  if (canManageStore(user, store)) return false;
  json(res, 403, { error: 'Store owner only.' });
  return true;
}

function handleEcosystem(req, res, user) {
  var urlPath = req.url.split('?')[0];
  var method = req.method;
  var db = null;

  // ---- Per-user DB helpers -------------------------------------------
  // `db` is the acting user's own SQLite file with the global registry
  // ATTACHed as `reg`. Global tables are referenced as reg.stores /
  // reg.user_modules / reg.payments. Business tables live in the user's file.
  function ownerModules(ownerId) {
    if (!ownerId || !db) return [];
    try { return db.prepare('SELECT module_key FROM reg.user_modules WHERE user_id = ? AND enabled = 1').all(ownerId).map(function(r){ return r.module_key; }); } catch(e){ return []; }
  }
  function openUdb(ownerId) {
    var udb = getUserDb(ownerId, ownerModules(ownerId));
    try { udb.exec("ATTACH DATABASE '" + String(DB_PATH).replace(/'/g,"''") + "' AS reg"); } catch(e){}
    return udb;
  }
    function getStore(storeId) {
    try {
      var reg = require('../lib/ecosystem-db').getDb();
      var row = reg.prepare('SELECT * FROM stores WHERE id = ? OR slug = ?').get(storeId, storeId) || null;
      try { reg.close(); } catch(e) {}
      return row;
    } catch (e) {
      console.error('[getStore] failed:', e.message);
      return null;
    }
  }
  function switchToStoreOwner(storeId) {
    var s = getStore(storeId);
    if (!s) return null;
    if (db) { try { db.close(); } catch(e){} }
    db = openUdb(s.owner_id);
    return s;
  }
  function openOwnerDbs() {
    var out = [];
    listUserDbs().forEach(function(item){
      try {
        var udb = getUserDb(item.userId, []);
        try { udb.exec("ATTACH DATABASE '" + String(DB_PATH).replace(/'/g,"''") + "' AS reg"); } catch(e){}
        out.push(udb);
      } catch(e){}
    });
    return out;
  }
  // Run a business query against every owner's DB and merge results.
  function scanRows(sql, params) {
    var result = [];
    openOwnerDbs().forEach(function(udb){
      try { result = result.concat(udb.prepare(sql).all.apply(udb.prepare(sql), params || [])); } catch(e){}
      udb.close();
    });
    return result;
  }
  function scanOne(sql, params) {
    var found = null;
    openOwnerDbs().forEach(function(udb){
      if (found) { udb.close(); return; }
      try { found = udb.prepare(sql).get.apply(udb.prepare(sql), params || []); } catch(e){}
      udb.close();
    });
    return found;
  }
  function reviewStatsFor(storeId) {
    var s = getStore(storeId);
    if (!s) return { review_count: 0, avg_rating: 0 };
    var ownerDb = openUdb(s.owner_id);
    var stats;
    try { stats = ownerDb.prepare('SELECT COUNT(*) as cnt, COALESCE(AVG(rating),0) as avg FROM store_reviews WHERE store_id = ? AND is_approved = 1').get(storeId); } catch(e){ stats = { cnt: 0, avg: 0 }; }
    try { ownerDb.close(); } catch(e){}
    return { review_count: stats.cnt, avg_rating: Math.round(stats.avg * 10) / 10 };
  }
  function findGymStore(storeId) {
    if (!db) return null;
    if (storeId) return getStore(storeId);
    try { return db.prepare('SELECT * FROM reg.stores WHERE type = ? AND is_active = 1 ORDER BY created_at LIMIT 1').get('gym') || null; } catch(e){ return null; }
  }
  // ----------------------------------------------------------------

  return parseBody(req).catch(function() { return {}; }).then(function(body) {
    // Always have a connection (public users get a throwaway 'public' file).
    db = openUdb(ownerId(user) || 'public');

    // ============ USER MODULES ============
    if (urlPath === '/api/ecosystem/user-modules' && method === 'GET') {
      if (requireLogin(res, user)) return;
      var userId = '';
      try { var u2 = new URL(req.url, 'http://localhost'); userId = u2.searchParams.get('user_id') || ''; } catch(e) {}
      if (!userId) return json(res, 400, { error: 'user_id is required.' });
      if (!user.isAdmin && userId !== ownerId(user) && userId !== user.email) return json(res, 403, { error: 'Forbidden.' });
      var modules = db.prepare('SELECT * FROM reg.user_modules WHERE user_id = ? AND enabled = 1').all(userId);
      // If subscription expired (beyond grace), only return core
      if (!isAdminEmail(user.email) && user.subscriptionExpiry) {
        var expiryMs = new Date(user.subscriptionExpiry).getTime();
        var GRACE_MS = 3 * 24 * 60 * 60 * 1000;
        if (!isNaN(expiryMs) && Date.now() > expiryMs + GRACE_MS) {
          modules = modules.filter(function(m){ return m.module_key === 'core'; });
        }
      }
      return json(res, 200, { ok: true, modules: modules });
    }

    if (urlPath === '/api/ecosystem/user-modules' && method === 'POST') {
      if (requireLogin(res, user)) return;
      if (!body.user_id || !body.module_key) return json(res, 400, { error: 'user_id and module_key are required.' });
      if (!user.isAdmin && body.user_id !== ownerId(user) && body.user_id !== user.email) return json(res, 403, { error: 'Forbidden.' });
      var targetGranted = db.prepare('SELECT module_key FROM reg.user_modules WHERE user_id = ? AND enabled = 1').all(body.user_id).map(function(r){ return r.module_key; });
      if (!canEnableModule(user, body.module_key, targetGranted)) return json(res, 403, { error: 'Upgrade required to enable this module.' });
      var existing = db.prepare('SELECT * FROM reg.user_modules WHERE user_id = ? AND module_key = ?').get(body.user_id, body.module_key);
      if (existing) {
        db.prepare('UPDATE reg.user_modules SET enabled = ? WHERE id = ?').run(body.enabled !== undefined ? (body.enabled ? 1 : 0) : 1, existing.id);
      } else {
        var modId = 'umod_' + generateId();
        db.prepare('INSERT INTO reg.user_modules (id, user_id, module_key, enabled) VALUES (?, ?, ?, ?)').run(modId, body.user_id, body.module_key, body.enabled !== undefined ? (body.enabled ? 1 : 0) : 1);
      }
      // Provision the target user's DB with tables for this module.
      try { provisionUserDb(body.user_id, [body.module_key]); } catch(e) {}
      var allMods = db.prepare('SELECT * FROM reg.user_modules WHERE user_id = ? AND enabled = 1').all(body.user_id);
      return json(res, 200, { ok: true, modules: allMods });
    }

    // ============ GENERIC MEMBERSHIPS (customer view) ============
    // Returns the signed-in user's active memberships across ALL stores/modules,
    // surfacing both the new `memberships` table and legacy `gym_members`.
    if (urlPath === '/api/ecosystem/memberships' && method === 'GET') {
      if (requireLogin(res, user)) return;
      var memUrl = null;
      try { memUrl = new URL(req.url, 'http://localhost'); } catch(e) {}
      var memStoreId = memUrl ? (memUrl.searchParams.get('store_id') || '') : '';
      var memNow = Date.now();
      var memSql, memParams;
      if (memStoreId) {
        // Owner view: list members of a specific store they own
        var memStore = getStore(memStoreId);
        if (!memStore) return json(res, 404, { error: 'Store not found.' });
        if (requireStoreOwner(res, user, memStore)) return;
        memSql = "SELECT m.id as id, m.store_id as store_id, m.member_email as member_email, m.name as name, m.phone as phone, m.module as module, m.plan as plan, m.plan_label as plan_label, m.price as price, m.status as status, m.start as start, m.expiry as expiry, m.member_code as member_code, s.name as store_name, s.type as store_type, s.logo_url as store_logo FROM memberships m LEFT JOIN reg.stores s ON s.id = m.store_id WHERE m.store_id = ? UNION ALL SELECT g.id, g.store_id, g.email as member_email, g.name, g.phone, 'gym', g.plan, g.plan, g.price, g.status, g.joined, g.expiry, '', s.name, s.type, s.logo_url FROM gym_members g LEFT JOIN reg.stores s ON s.id = g.store_id WHERE g.store_id = ?";
        memParams = [memStoreId, memStoreId];
      } else {
        // Customer view: the signed-in user's memberships across all stores
        var memEmail = String(user.email || '').trim().toLowerCase();
        if (!memEmail) return json(res, 400, { error: 'Account has no email.' });
        memSql = "SELECT m.id as id, m.store_id as store_id, m.member_email as member_email, m.name as name, m.phone as phone, m.module as module, m.plan as plan, m.plan_label as plan_label, m.price as price, m.status as status, m.start as start, m.expiry as expiry, m.member_code as member_code, s.name as store_name, s.type as store_type, s.logo_url as store_logo FROM memberships m LEFT JOIN reg.stores s ON s.id = m.store_id WHERE m.member_email = ? UNION ALL SELECT g.id, g.store_id, g.email as member_email, g.name, g.phone, 'gym', g.plan, g.plan, g.price, g.status, g.joined, g.expiry, '', s.name, s.type, s.logo_url FROM gym_members g LEFT JOIN reg.stores s ON s.id = g.store_id WHERE g.email = ?";
        memParams = [memEmail, memEmail];
      }
      var memRows = scanRows(memSql, memParams);
      var memRaw = memRows.map(function(r){
        var eff = String(r.status || 'Active');
        if (r.expiry) { var ex = new Date(r.expiry).getTime(); if (!isNaN(ex) && ex < memNow && eff !== 'Frozen') eff = 'Expired'; }
        return {
          id: r.id, store_id: r.store_id, member_email: r.member_email || '', store_name: r.store_name || 'Store', store_type: r.store_type || '',
          store_logo: r.store_logo || '', module: r.module || 'generic',
          plan: r.plan || '', plan_label: r.plan_label || r.plan || 'Member',
          price: r.price || 0, status: eff, start: r.start || '', expiry: r.expiry || '',
          member_code: r.member_code || '', name: r.name || '', phone: r.phone || ''
        };
      });
      // De-duplicate: prefer the richer `memberships` row over a legacy gym_members mirror
      var memSeen = {}; var memList = [];
      memRaw.forEach(function(m){
        var key = m.store_id + '|' + String(m.member_email || '').toLowerCase();
        if (memSeen[key]) return;
        memSeen[key] = true; memList.push(m);
      });
      memList.sort(function(a,b){ return (a.store_name || '').localeCompare(b.store_name || ''); });
      return json(res, 200, { memberships: memList });
    }

    // Owner registers a customer as a member of one of their stores. Also mirrors
    // into gym_members when module === 'gym' so existing gym flows keep working.
    if (urlPath === '/api/ecosystem/memberships' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var msId = String(body.store_id || '');
      var msEmail = String(body.member_email || '').trim().toLowerCase();
      if (!msId || !msEmail) return json(res, 400, { error: 'store_id and member_email are required.' });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(msEmail)) return json(res, 400, { error: 'Invalid email.' });
      var msStore = getStore(msId);
      if (!msStore) return json(res, 404, { error: 'Store not found.' });
      if (requireStoreOwner(res, user, msStore)) return;
      var msModule = String(body.module || 'generic');
      var msPlan = String(body.plan || '');
      var msPlanLabel = String(body.plan_label || msPlan || 'Member');
      var msPrice = Number(body.price || 0) || 0;
      var msStatus = String(body.status || 'Active');
      var msStart = String(body.start || '');
      var msExpiry = String(body.expiry || '');
      var msCode = String(body.member_code || ('MB-' + generateId().slice(0, 10).toUpperCase()));
      var msId2 = 'mem_' + generateId();
      db.prepare("INSERT INTO memberships (id, store_id, user_id, member_email, name, phone, module, plan, plan_label, price, status, start, expiry, member_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))")
        .run(msId2, msId, '', msEmail, String(body.name || ''), String(body.phone || ''), msModule, msPlan, msPlanLabel, msPrice, msStatus, msStart, msExpiry, msCode);
      if (msModule === 'gym') {
        try {
          db.prepare("INSERT INTO gym_members (id, store_id, email, name, phone, plan, price, expiry, status, joined, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')) ON CONFLICT(store_id, email) DO UPDATE SET name=excluded.name, phone=excluded.phone, plan=excluded.plan, price=excluded.price, expiry=excluded.expiry, status=excluded.status, updated_at=datetime('now')")
            .run('gm_' + generateId(), msId, msEmail, String(body.name || ''), String(body.phone || ''), msPlan, msPrice, msExpiry, msStatus, msStart);
        } catch(e) {}
      }
      // Send the new member a branded welcome email (non-blocking)
      try {
        var et = require('./email-templates');
        var storeName = String(msStore.name || '');
        sendEmail(msEmail, 'You are now a member of ' + storeName + ' - Ocean SFT',
          et.membershipWelcomeEmail(String(body.name || msEmail), storeName, msPlanLabel, msExpiry, msCode, msPrice)).catch(function(){});
      } catch(e) {}
      return json(res, 200, { ok: true, id: msId2, member_code: msCode });
    }

    // ============ GENERIC QR IMAGE ============
    if (urlPath === '/api/ecosystem/qr' && method === 'GET') {
      var qrText = ''; var qrSize = 240;
      try { var qrUrl = new URL(req.url, 'http://localhost'); qrText = qrUrl.searchParams.get('text') || ''; qrSize = parseInt(qrUrl.searchParams.get('size') || '240', 10) || 240; } catch(e) {}
      if (!qrText) return json(res, 400, { error: 'text is required.' });
      if (!QRCode) return json(res, 503, { error: 'qrcode package not installed on this server' });
      QRCode.toBuffer(qrText, { width: qrSize, margin: 2, errorCorrectionLevel: 'M' }, function(err, buf) {
        if (err) return json(res, 500, { error: 'qr generation failed' });
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(buf);
      });
      return;
    }

    if (urlPath === '/api/ecosystem/user-modules/bulk' && method === 'POST') {
      if (requireLogin(res, user)) return;
      if (!body.user_id || !Array.isArray(body.modules)) return json(res, 400, { error: 'user_id and modules array required.' });
      if (!user.isAdmin && body.user_id !== ownerId(user) && body.user_id !== user.email) return json(res, 403, { error: 'Forbidden.' });
      var bulkGranted = db.prepare('SELECT module_key FROM reg.user_modules WHERE user_id = ? AND enabled = 1').all(body.user_id).map(function(r){ return r.module_key; });
      for (var bi = 0; bi < body.modules.length; bi++) {
        if (!canEnableModule(user, body.modules[bi], bulkGranted)) return json(res, 403, { error: 'Upgrade required to enable module: ' + body.modules[bi] });
      }
      var insertMod = db.prepare('INSERT OR REPLACE INTO reg.user_modules (id, user_id, module_key, enabled) VALUES (?, ?, ?, 1)');
      var mods = [];
      body.modules.forEach(function(mk) {
        var existingRow = db.prepare('SELECT id FROM reg.user_modules WHERE user_id = ? AND module_key = ?').get(body.user_id, mk);
        if (existingRow) {
          db.prepare('UPDATE reg.user_modules SET enabled = 1 WHERE id = ?').run(existingRow.id);
        } else {
          insertMod.run('umod_' + generateId(), body.user_id, mk);
        }
      });
      try { provisionUserDb(body.user_id, body.modules); } catch(e) {}
      var allMods = db.prepare('SELECT * FROM reg.user_modules WHERE user_id = ? AND enabled = 1').all(body.user_id);
      return json(res, 200, { ok: true, modules: allMods });
    }

    if (urlPath === '/api/ecosystem/user-modules' && method === 'DELETE') {
      if (requireLogin(res, user)) return;
      if (!body.user_id || !body.module_key) return json(res, 400, { error: 'user_id and module_key required.' });
      if (!user.isAdmin && body.user_id !== ownerId(user) && body.user_id !== user.email) return json(res, 403, { error: 'Forbidden.' });
      db.prepare('UPDATE reg.user_modules SET enabled = 0 WHERE user_id = ? AND module_key = ?').run(body.user_id, body.module_key);
      var allMods = db.prepare('SELECT * FROM reg.user_modules WHERE user_id = ? AND enabled = 1').all(body.user_id);
      return json(res, 200, { ok: true, modules: allMods });
    }

    // ============ DASHBOARD AGGREGATE ============
    if (urlPath === '/api/ecosystem/dashboard' && method === 'GET') {
      if (requireLogin(res, user)) return;
      var storeCount = db.prepare('SELECT COUNT(*) as cnt FROM reg.stores WHERE is_active = 1').get().cnt;
      var storesByType = db.prepare('SELECT type, COUNT(*) as cnt FROM reg.stores WHERE is_active = 1 GROUP BY type').all();
      var totalOrders = 0, pendingOrders = 0, paidOrders = 0, unpaidOrders = 0, totalRevenue = 0, totalSubtotal = 0, totalTax = 0, totalDiscount = 0, reviewCount = 0, avgRating = 0, menuItemCount = 0, categoryCount = 0;
      var recentOrders = [], recentReviews = [], ordersByStatus = {}, ratingDistribution = {};
      openOwnerDbs().forEach(function(udb){
        try {
          totalOrders += udb.prepare('SELECT COUNT(*) as cnt FROM store_orders').get().cnt || 0;
          pendingOrders += udb.prepare('SELECT COUNT(*) as cnt FROM store_orders WHERE status = \'pending\'').get().cnt || 0;
          paidOrders += udb.prepare('SELECT COUNT(*) as cnt FROM store_orders WHERE payment_status = \'paid\'').get().cnt || 0;
          unpaidOrders += udb.prepare('SELECT COUNT(*) as cnt FROM store_orders WHERE payment_status = \'unpaid\'').get().cnt || 0;
          var rev = udb.prepare('SELECT COALESCE(SUM(total),0) as tr, COALESCE(SUM(subtotal),0) as ts, COALESCE(SUM(tax),0) as tt, COALESCE(SUM(discount),0) as td FROM store_orders').get();
          totalRevenue += Number(rev.tr || 0); totalSubtotal += Number(rev.ts || 0); totalTax += Number(rev.tt || 0); totalDiscount += Number(rev.td || 0);
          reviewCount += udb.prepare('SELECT COUNT(*) as cnt FROM store_reviews WHERE is_approved = 1').get().cnt || 0;
          var ar = udb.prepare('SELECT COALESCE(AVG(rating),0) as avg FROM store_reviews WHERE is_approved = 1').get().avg || 0;
          avgRating += Number(ar);
          menuItemCount += udb.prepare('SELECT COUNT(*) as cnt FROM menu_items WHERE is_available = 1').get().cnt || 0;
          categoryCount += udb.prepare('SELECT COUNT(*) as cnt FROM menu_categories').get().cnt || 0;
          var byStatus = udb.prepare('SELECT status, COUNT(*) as cnt FROM store_orders GROUP BY status').all();
          byStatus.forEach(function(r){ ordersByStatus[r.status] = (ordersByStatus[r.status] || 0) + r.cnt; });
          var dist = udb.prepare('SELECT rating, COUNT(*) as cnt FROM store_reviews WHERE is_approved = 1 GROUP BY rating').all();
          dist.forEach(function(r){ ratingDistribution[r.rating] = (ratingDistribution[r.rating] || 0) + r.cnt; });
          recentOrders = recentOrders.concat(udb.prepare('SELECT o.* FROM store_orders o ORDER BY o.created_at DESC LIMIT 10').all());
          recentReviews = recentReviews.concat(udb.prepare('SELECT r.* FROM store_reviews r WHERE r.is_approved = 1 ORDER BY r.created_at DESC LIMIT 10').all());
        } catch(e) {}
        udb.close();
      });
      recentOrders = recentOrders.sort(function(a,b){ return String(b.created_at||'').localeCompare(String(a.created_at||'')); }).slice(0, 10);
      recentReviews = recentReviews.sort(function(a,b){ return String(b.created_at||'').localeCompare(String(a.created_at||'')); }).slice(0, 10);
      recentOrders.forEach(function(o) {
        o.store_name = (getStore(o.store_id) || {}).name || '';
        o.items = [];
        var so = getStore(o.store_id);
        if (so) {
          var odb = openUdb(so.owner_id);
          try { o.items = odb.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id); } catch(e){}
          try { odb.close(); } catch(e){}
        }
      });
      recentReviews.forEach(function(r) {
        r.store_name = (getStore(r.store_id) || {}).name || '';
      });
      var allStores = db.prepare('SELECT * FROM reg.stores WHERE is_active = 1').all();
      var revenueByStore = allStores.map(function(s){
        var odb = openUdb(s.owner_id);
        var revenue = 0, orderCount = 0;
        try { revenue = odb.prepare('SELECT COALESCE(SUM(o.total),0) as revenue FROM store_orders o WHERE o.store_id = ?').get(s.id).revenue || 0; } catch(e){}
        try { orderCount = odb.prepare('SELECT COUNT(*) as cnt FROM store_orders o WHERE o.store_id = ?').get(s.id).cnt || 0; } catch(e){}
        try { odb.close(); } catch(e){}
        return { id: s.id, name: s.name, type: s.type, revenue: revenue, order_count: orderCount };
      }).sort(function(a,b){ return b.revenue - a.revenue; });
      var distArr = Object.keys(ratingDistribution).map(function(k){ return { rating: Number(k), cnt: ratingDistribution[k] }; }).sort(function(a,b){ return a.rating - b.rating; });
      var statusArr = Object.keys(ordersByStatus).map(function(k){ return { status: k, cnt: ordersByStatus[k] }; });
      return json(res, 200, {
        ok: true,
        stores: { count: storeCount, byType: storesByType },
        orders: { count: totalOrders, byStatus: statusArr, pending: pendingOrders, paid: paidOrders, unpaid: unpaidOrders, recent: recentOrders },
        revenue: { total: totalRevenue, subtotal: totalSubtotal, tax: totalTax, discount: totalDiscount, byStore: revenueByStore },
        reviews: { count: reviewCount, avgRating: Math.round(avgRating * 10) / 10, distribution: distArr, recent: recentReviews },
        menu: { items: menuItemCount, categories: categoryCount }
      });
    }

   // ============ STORES (registry - global) ============
if (urlPath === '/api/ecosystem/stores' && method === 'GET') {
  var type = '';
  try { var u = new URL(req.url, 'http://localhost'); type = u.searchParams.get('type') || ''; } catch(e) {}
  var stores;
  
  // ✅ FIX: Filter by owner unless admin
  var ownerId = user ? user.id : null;
  var isAdmin = user && user.isAdmin;
  
  if (type) {
    if (isAdmin || !ownerId) {
      stores = db.prepare('SELECT * FROM reg.stores WHERE is_active = 1 AND type = ? ORDER BY name').all(type);
    } else {
      stores = db.prepare('SELECT * FROM reg.stores WHERE is_active = 1 AND type = ? AND owner_id = ? ORDER BY name').all(type, ownerId);
    }
  } else {
    if (isAdmin || !ownerId) {
      stores = db.prepare('SELECT * FROM reg.stores WHERE is_active = 1 ORDER BY name').all();
    } else {
      stores = db.prepare('SELECT * FROM reg.stores WHERE is_active = 1 AND owner_id = ? ORDER BY name').all(ownerId);
    }
  }
  
  stores.forEach(function(s) {
    var stats = reviewStatsFor(s.id);
    s.review_count = stats.review_count;
    s.avg_rating = stats.avg_rating;
    normalizeStore(s);
  });
  return json(res, 200, { ok: true, stores: stores });
}

    // ============ PUBLIC STORES (no auth) ============
    if (urlPath === '/api/ecosystem/stores/public' && method === 'GET') {
      var stores = db.prepare('SELECT id, slug, name, type, description, address, phone, lat, lng, logo_url, cover_url, template_key, accent_color, tagline, opening_hours, is_active FROM reg.stores WHERE is_active = 1 ORDER BY name').all();
      stores.forEach(function(s) {
        var stats = reviewStatsFor(s.id);
        s.review_count = stats.review_count;
        s.avg_rating = stats.avg_rating;
        normalizeStore(s);
      });
      return json(res, 200, { ok: true, stores: stores });
    }

    if (urlPath === '/api/ecosystem/stores/nearby' && method === 'GET') {
      var lat = parseFloat(new URL(req.url, 'http://localhost').searchParams.get('lat'));
      var lng = parseFloat(new URL(req.url, 'http://localhost').searchParams.get('lng'));
      var radius = parseFloat(new URL(req.url, 'http://localhost').searchParams.get('radius')) || 10;
      if (isNaN(lat) || isNaN(lng)) return json(res, 400, { error: 'lat and lng required' });
      var stores = db.prepare('SELECT id, slug, name, type, description, address, phone, lat, lng, logo_url, cover_url, template_key, accent_color, tagline FROM reg.stores WHERE is_active = 1 AND lat IS NOT NULL AND lng IS NOT NULL').all();
      function haversine(lat1, lng1, lat2, lng2) {
        var R = 6371;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLng = (lng2 - lng1) * Math.PI / 180;
        var a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng/2) * Math.sin(dLng/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      }
      stores = stores.map(function(s) {
        var dist = haversine(lat, lng, s.lat, s.lng);
        return Object.assign({}, s, { distance_km: Math.round(dist * 10) / 10 });
      }).filter(function(s) { return s.distance_km <= radius; })
        .sort(function(a, b) { return a.distance_km - b.distance_km; });
      stores.forEach(function(s) {
        var stats = reviewStatsFor(s.id);
        s.review_count = stats.review_count;
        s.avg_rating = stats.avg_rating;
        normalizeStore(s);
      });
      return json(res, 200, { ok: true, stores: stores });
    }

    if (urlPath.match(/^\/api\/ecosystem\/stores\/[^/]+$/) && method === 'GET') {
      var storeId = urlPath.split('/').pop();
      var store = switchToStoreOwner(storeId);
      if (!store) return json(res, 404, { error: 'Store not found.' });
      var reviewStats = reviewStatsFor(storeId);
      store.review_count = reviewStats.review_count;
      store.avg_rating = reviewStats.avg_rating;
      var categories = [];
      try { categories = db.prepare('SELECT * FROM menu_categories WHERE store_id = ? ORDER BY sort_order').all(storeId); } catch(e) {}
      categories.forEach(function(cat) {
        try { cat.items = db.prepare('SELECT * FROM menu_items WHERE category_id = ? AND is_available = 1 ORDER BY sort_order').all(cat.id); } catch(e){ cat.items = []; }
      });
      store.menu_categories = categories;
      try { store.gym_plans = db.prepare('SELECT * FROM gym_plans WHERE store_id = ? ORDER BY price ASC').all(storeId); } catch(e){ store.gym_plans = []; }
      return json(res, 200, { ok: true, store: normalizeStore(store) });
    }

    if (urlPath === '/api/ecosystem/stores' && method === 'POST') {
      if (requireLogin(res, user)) return;
      if (!body.name || !body.type) return json(res, 400, { error: 'Store name and type are required.' });
      var id = 'store_' + generateId();
      var baseSlug = slugify(body.slug || body.name || id) || id;
      var slug = baseSlug;
      var n = 2;
      while (db.prepare('SELECT id FROM reg.stores WHERE slug = ?').get(slug)) {
        slug = baseSlug + '-' + n++;
      }
      db.prepare('INSERT INTO reg.stores (id, owner_id, name, type, description, address, phone, email, lat, lng, logo_url, cover_url, is_active, slug, template_key, accent_color, tagline, opening_hours, booking_enabled, ordering_enabled, ai_enabled, whatsapp_number, services_json, gallery_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, ownerId(user), body.name, body.type, body.description || '', body.address || '', body.phone || '', body.email || '', body.lat || 0, body.lng || 0, body.logo_url || '', body.cover_url || '', (body.is_active === false || body.active === false) ? 0 : 1, slug, body.template_key || 'clean', body.accent_color || '#0891b2', body.tagline || '', body.opening_hours || '', body.booking_enabled === false ? 0 : 1, body.ordering_enabled === false ? 0 : 1, body.ai_enabled === false ? 0 : 1, body.whatsapp_number || body.phone || '', JSON.stringify(body.services || []), JSON.stringify(body.gallery || []));
      // Ensure the owner's DB has tables for the store's module type.
      try { provisionUserDb(ownerId(user), [body.type]); } catch(e) {}
      // Free `core` storefront module is auto-enabled for every owner.
      try {
        var coreOwner = ownerId(user);
        var coreExists = db.prepare('SELECT id FROM reg.user_modules WHERE user_id = ? AND module_key = ?').get(coreOwner, 'core');
        if (!coreExists) {
          db.prepare('INSERT INTO reg.user_modules (id, user_id, module_key, enabled, created_at) VALUES (?, ?, ?, 1, datetime(\'now\'))')
            .run('um_core_' + generateId(), coreOwner, 'core');
        }
      } catch(e) {}
      var newStore = db.prepare('SELECT * FROM reg.stores WHERE id = ?').get(id);
      return json(res, 201, { ok: true, store: normalizeStore(newStore) });
    }

    if (urlPath.match(/^\/api\/ecosystem\/stores\/[^/]+$/) && method === 'PUT') {
      var storeId = urlPath.split('/').pop();
      var existing = db.prepare('SELECT * FROM reg.stores WHERE id = ?').get(storeId);
      if (!existing) return json(res, 404, { error: 'Store not found.' });
      if (requireStoreOwner(res, user, existing)) return;
      var fields = ['name','type','description','address','phone','email','lat','lng','logo_url','cover_url','is_active','template_key','accent_color','tagline','opening_hours','booking_enabled','ordering_enabled','ai_enabled','whatsapp_number'];
      fields.forEach(function(f) {
        if (body[f] !== undefined) existing[f] = body[f];
      });
      if (body.slug !== undefined) existing.slug = slugify(body.slug || existing.name);
      existing.services_json = JSON.stringify(Array.isArray(body.services) ? body.services : safeJson(existing.services_json, []));
      existing.gallery_json = JSON.stringify(Array.isArray(body.gallery) ? body.gallery : safeJson(existing.gallery_json, []));
      db.prepare('UPDATE reg.stores SET name=?, type=?, description=?, address=?, phone=?, email=?, lat=?, lng=?, logo_url=?, cover_url=?, is_active=?, slug=?, template_key=?, accent_color=?, tagline=?, opening_hours=?, booking_enabled=?, ordering_enabled=?, ai_enabled=?, whatsapp_number=?, services_json=?, gallery_json=?, updated_at=datetime(\'now\') WHERE id=?')
        .run(existing.name, existing.type, existing.description, existing.address, existing.phone, existing.email, existing.lat, existing.lng, existing.logo_url, existing.cover_url, existing.is_active, existing.slug || '', existing.template_key || 'clean', existing.accent_color || '#0891b2', existing.tagline || '', existing.opening_hours || '', existing.booking_enabled ? 1 : 0, existing.ordering_enabled ? 1 : 0, existing.ai_enabled ? 1 : 0, existing.whatsapp_number || '', existing.services_json, existing.gallery_json, storeId);
      return json(res, 200, { ok: true, store: normalizeStore(existing) });
    }

    if (urlPath.match(/^\/api\/ecosystem\/stores\/[^/]+$/) && method === 'DELETE') {
      var storeId = urlPath.split('/').pop();
      var existing = db.prepare('SELECT * FROM reg.stores WHERE id = ?').get(storeId);
      if (!existing) return json(res, 404, { error: 'Store not found.' });
      if (requireStoreOwner(res, user, existing)) return;
      db.prepare('DELETE FROM reg.stores WHERE id = ?').run(storeId);
      return json(res, 200, { ok: true });
    }

    // ============ MENU CATEGORIES ============
    if (urlPath.match(/^\/api\/ecosystem\/stores\/[^/]+\/categories$/) && method === 'POST') {
      var storeId = urlPath.split('/')[4];
      var store = db.prepare('SELECT * FROM reg.stores WHERE id = ?').get(storeId);
      if (!store) return json(res, 404, { error: 'Store not found.' });
      if (requireStoreOwner(res, user, store)) return;
      if (!body.name) return json(res, 400, { error: 'Category name is required.' });
      var catId = 'cat_' + generateId();
      var maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM menu_categories WHERE store_id = ?').get(storeId).next;
      db.prepare('INSERT INTO menu_categories (id, store_id, name, sort_order) VALUES (?, ?, ?, ?)').run(catId, storeId, body.name, body.sort_order || maxOrder);
      return json(res, 201, { ok: true, category: db.prepare('SELECT * FROM menu_categories WHERE id = ?').get(catId) });
    }

    if (urlPath.match(/^\/api\/ecosystem\/categories\/[^/]+$/) && method === 'DELETE') {
      var catId = urlPath.split('/').pop();
      var cat = db.prepare('SELECT c.*, s.owner_id FROM menu_categories c LEFT JOIN reg.stores s ON s.id = c.store_id WHERE c.id = ?').get(catId);
      if (requireStoreOwner(res, user, cat)) return;
      db.prepare('DELETE FROM menu_categories WHERE id = ?').run(catId);
      return json(res, 200, { ok: true });
    }

    // ============ MENU ITEMS ============
    if (urlPath.match(/^\/api\/ecosystem\/stores\/[^/]+\/items$/) && method === 'POST') {
      var storeId = urlPath.split('/')[4];
      var store = db.prepare('SELECT * FROM reg.stores WHERE id = ?').get(storeId);
      if (!store) return json(res, 404, { error: 'Store not found.' });
      if (requireStoreOwner(res, user, store)) return;
      if (!body.name || body.price === undefined) return json(res, 400, { error: 'Item name and price are required.' });
      var itemId = 'item_' + generateId();
      var maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM menu_items WHERE store_id = ?').get(storeId).next;
      db.prepare('INSERT INTO menu_items (id, store_id, category_id, name, description, price, image_url, is_available, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(itemId, storeId, body.category_id || null, body.name, body.description || '', body.price, body.image_url || '', body.is_available !== undefined ? (body.is_available ? 1 : 0) : 1, body.sort_order || maxOrder);
      return json(res, 201, { ok: true, item: db.prepare('SELECT * FROM menu_items WHERE id = ?').get(itemId) });
    }

    if (urlPath.match(/^\/api\/ecosystem\/items\/[^/]+$/) && method === 'PUT') {
      var itemId = urlPath.split('/').pop();
      var existing = db.prepare('SELECT i.*, s.owner_id FROM menu_items i LEFT JOIN reg.stores s ON s.id = i.store_id WHERE i.id = ?').get(itemId);
      if (!existing) return json(res, 404, { error: 'Item not found.' });
      if (requireStoreOwner(res, user, existing)) return;
      if (body.name !== undefined) existing.name = body.name;
      if (body.description !== undefined) existing.description = body.description;
      if (body.price !== undefined) existing.price = body.price;
      if (body.category_id !== undefined) existing.category_id = body.category_id;
      if (body.image_url !== undefined) existing.image_url = body.image_url;
      if (body.is_available !== undefined) existing.is_available = body.is_available ? 1 : 0;
      db.prepare('UPDATE menu_items SET name=?, description=?, price=?, category_id=?, image_url=?, is_available=? WHERE id=?').run(existing.name, existing.description, existing.price, existing.category_id, existing.image_url, existing.is_available, itemId);
      return json(res, 200, { ok: true, item: existing });
    }

    if (urlPath.match(/^\/api\/ecosystem\/items\/[^/]+$/) && method === 'DELETE') {
      var itemId = urlPath.split('/').pop();
      var item = db.prepare('SELECT i.*, s.owner_id FROM menu_items i LEFT JOIN reg.stores s ON s.id = i.store_id WHERE i.id = ?').get(itemId);
      if (requireStoreOwner(res, user, item)) return;
      db.prepare('DELETE FROM menu_items WHERE id = ?').run(itemId);
      return json(res, 200, { ok: true });
    }

    // ============ ORDERS ============
    if (urlPath.match(/^\/api\/ecosystem\/stores\/[^/]+\/orders$/) && method === 'POST') {
      var storeId = urlPath.split('/')[4];
      var store = switchToStoreOwner(storeId);
      if (!store) return json(res, 404, { error: 'Store not found.' });
      if (!store.ordering_enabled) return json(res, 403, { error: 'Online ordering is disabled.' });
      if (!body.items || !body.items.length) return json(res, 400, { error: 'Order must have at least one item.' });
      var orderId = 'ord_' + generateId();
      var subtotal = 0;
      body.items.forEach(function(item) { subtotal += Number(item.price || 0) * Number(item.qty || 1); });
      var taxRate = Number(body.tax_rate || 0);
      var tax = subtotal * taxRate / 100;
      var discount = Number(body.discount || 0);
      var total = subtotal + tax - discount;

      db.prepare('INSERT INTO store_orders (id, store_id, table_number, customer_name, customer_phone, customer_email, order_type, status, subtotal, tax, discount, total, note, payment_method, payment_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(orderId, storeId, body.table_number || '', body.customer_name || 'Guest', body.customer_phone || '', body.customer_email || '', body.order_type || 'dine_in', 'pending', subtotal, tax, discount, total, body.note || '', body.payment_method || 'cash', 'unpaid');

      var insertItem = db.prepare('INSERT INTO order_items (id, order_id, menu_item_id, name, price, qty, note) VALUES (?, ?, ?, ?, ?, ?, ?)');
      body.items.forEach(function(item) {
        insertItem.run('oi_' + generateId(), orderId, item.menu_item_id || null, item.name, item.price || 0, item.qty || 1, item.note || '');
      });

      var order = db.prepare('SELECT * FROM store_orders WHERE id = ?').get(orderId);
      order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
      queueMessage(db, storeId, 'whatsapp', store.whatsapp_number || store.phone || '', 'New order #' + orderId.slice(-6).toUpperCase() + ' from ' + order.customer_name + '.', 'order', orderId);
      if (body.customer_phone) queueMessage(db, storeId, 'whatsapp', body.customer_phone, 'Your order at ' + store.name + ' was received. Order #' + orderId.slice(-6).toUpperCase() + '.', 'order', orderId);

      if (order.customer_email) {
        var orderItemsHtml = (order.items || []).map(function(it) {
          return '<tr><td style="padding:4px 0;">' + (it.name || '') + ' × ' + (it.qty || 1) + '</td><td style="padding:4px 0;text-align:right;">' + Number(it.price || 0).toFixed(2) + '</td></tr>';
        }).join('');
        sendConfirmationEmail(order.customer_email, 'Order Confirmed ✅ — ' + (store.name || 'Ocean SFT'), emailTemplates.orderConfirmationEmail(store.name, order.customer_name, orderItemsHtml, Number(order.total || 0) + ' ' + (store.currency || ''), order.id));
      }
      return json(res, 201, { ok: true, order: order });
    }

    if (urlPath.match(/^\/api\/ecosystem\/stores\/[^/]+\/orders$/) && method === 'GET') {
      var storeId = urlPath.split('/')[4];
      var store = db.prepare('SELECT * FROM reg.stores WHERE id = ?').get(storeId);
      if (!store) return json(res, 404, { error: 'Store not found.' });
      if (requireStoreOwner(res, user, store)) return;
      var status = '';
      try { var u = new URL(req.url, 'http://localhost'); status = u.searchParams.get('status') || ''; } catch(e) {}
      var orders;
      if (status) {
        orders = db.prepare('SELECT * FROM store_orders WHERE store_id = ? AND status = ? ORDER BY created_at DESC').all(storeId, status);
      } else {
        orders = db.prepare('SELECT * FROM store_orders WHERE store_id = ? ORDER BY created_at DESC').all(storeId);
      }
      orders.forEach(function(o) {
        o.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
      });
      return json(res, 200, { ok: true, orders: orders });
    }

    if (urlPath.match(/^\/api\/ecosystem\/orders\/[^/]+$/) && method === 'PATCH') {
      var orderId = urlPath.split('/').pop();
      var order = scanOne('SELECT o.* FROM store_orders o WHERE o.id = ?', [orderId]);
      if (!order) return json(res, 404, { error: 'Order not found.' });
      var orderStore = getStore(order.store_id);
      if (requireStoreOwner(res, user, orderStore)) return;
      switchToStoreOwner(order.store_id);
      if (body.status) order.status = body.status;
      if (body.payment_status) order.payment_status = body.payment_status;
      db.prepare('UPDATE store_orders SET status=?, payment_status=?, updated_at=datetime(\'now\') WHERE id=?').run(order.status, order.payment_status, orderId);
      if (order.customer_phone) queueMessage(db, order.store_id, 'whatsapp', order.customer_phone, 'Your order at ' + (orderStore && orderStore.name) + ' is now ' + order.status + '.', 'order', orderId);
      if (order.customer_email) {
        try { sendEmail(order.customer_email, 'Order Update - ' + (orderStore && orderStore.name || 'Ocean SFT'), emailTemplates.notificationEmail('Order Update', 'Your order #' + orderId.slice(-6).toUpperCase() + ' at ' + (orderStore && orderStore.name || 'our store') + ' is now <strong>' + order.status + '</strong>.')).catch(function(){}); } catch(e){}
      }
      order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
      return json(res, 200, { ok: true, order: order });
    }

    // ============ BOOKINGS ============
    if (urlPath.match(/^\/api\/ecosystem\/stores\/[^/]+\/bookings$/) && method === 'POST') {
      var storeId = urlPath.split('/')[4];
      var store = switchToStoreOwner(storeId);
      if (!store) return json(res, 404, { error: 'Store not found.' });
      if (!store.booking_enabled) return json(res, 403, { error: 'Bookings are disabled.' });
      if (!body.customer_name || !body.booking_date || !body.booking_time) return json(res, 400, { error: 'Name, date, and time are required.' });
      var bookingId = 'book_' + generateId();
      db.prepare('INSERT INTO store_bookings (id, store_id, customer_name, customer_phone, customer_email, service_name, booking_date, booking_time, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(bookingId, storeId, body.customer_name, body.customer_phone || '', body.customer_email || '', body.service_name || '', body.booking_date, body.booking_time, body.note || '');
      var booking = db.prepare('SELECT * FROM store_bookings WHERE id = ?').get(bookingId);
      // Send the customer a branded booking confirmation (non-blocking)
      if (booking.customer_email) {
        try { sendEmail(booking.customer_email, 'Booking Confirmed - ' + (store.name || 'Ocean SFT'), emailTemplates.bookingConfirmationEmail(store.name, booking.customer_name, booking.service_name || '', booking.booking_date, booking.booking_time)).catch(function(){}); } catch(e){}
      }
      queueMessage(db, storeId, 'whatsapp', store.whatsapp_number || store.phone || '', 'New booking request from ' + booking.customer_name + ' on ' + booking.booking_date + ' at ' + booking.booking_time + '.', 'booking', bookingId);
      if (booking.customer_phone) queueMessage(db, storeId, 'whatsapp', booking.customer_phone, 'Your booking request at ' + store.name + ' was received for ' + booking.booking_date + ' at ' + booking.booking_time + '.', 'booking', bookingId);
      return json(res, 201, { ok: true, booking: booking });
    }

    if (urlPath.match(/^\/api\/ecosystem\/stores\/[^/]+\/bookings$/) && method === 'GET') {
      var storeId = urlPath.split('/')[4];
      var store = db.prepare('SELECT * FROM reg.stores WHERE id = ?').get(storeId);
      if (!store) return json(res, 404, { error: 'Store not found.' });
      if (requireStoreOwner(res, user, store)) return;
      var bookings = db.prepare('SELECT * FROM store_bookings WHERE store_id = ? ORDER BY booking_date DESC, booking_time DESC').all(storeId);
      return json(res, 200, { ok: true, bookings: bookings });
    }

    if (urlPath.match(/^\/api\/ecosystem\/bookings\/[^/]+$/) && method === 'PATCH') {
      var bookingId = urlPath.split('/').pop();
      var booking = scanOne('SELECT b.* FROM store_bookings b WHERE b.id = ?', [bookingId]);
      if (!booking) return json(res, 404, { error: 'Booking not found.' });
      var bookingStore = getStore(booking.store_id);
      if (requireStoreOwner(res, user, bookingStore)) return;
      switchToStoreOwner(booking.store_id);
      var status = body.status || booking.status;
      db.prepare('UPDATE store_bookings SET status=?, updated_at=datetime(\'now\') WHERE id=?').run(status, bookingId);
      booking.status = status;
      if (booking.customer_phone) queueMessage(db, booking.store_id, 'whatsapp', booking.customer_phone, 'Your booking at ' + (bookingStore && bookingStore.name) + ' is now ' + status + '.', 'booking', bookingId);
      return json(res, 200, { ok: true, booking: booking });
    }

    if (urlPath.match(/^\/api\/ecosystem\/stores\/[^/]+\/messages$/) && method === 'GET') {
      var storeId = urlPath.split('/')[4];
      var store = db.prepare('SELECT * FROM reg.stores WHERE id = ?').get(storeId);
      if (!store) return json(res, 404, { error: 'Store not found.' });
      if (requireStoreOwner(res, user, store)) return;
      var messages = db.prepare('SELECT * FROM customer_messages WHERE store_id = ? ORDER BY created_at DESC LIMIT 100').all(storeId);
      return json(res, 200, { ok: true, messages: messages });
    }

    if (urlPath.match(/^\/api\/ecosystem\/stores\/[^/]+\/ai-chat$/) && method === 'POST') {
      var storeId = urlPath.split('/')[4];
      var store = normalizeStore(getStore(storeId));
      if (!store) return json(res, 404, { error: 'Store not found.' });
      var text = String(body.message || '').toLowerCase();
      var reply = 'Thanks for contacting ' + store.name + '. ';
      if (text.indexOf('book') >= 0 || text.indexOf('appointment') >= 0 || text.indexOf('schedule') >= 0) {
        reply += store.booking_enabled ? 'You can request a booking from the booking form on this page.' : 'Bookings are currently disabled.';
      } else if (text.indexOf('time') >= 0 || text.indexOf('open') >= 0 || text.indexOf('hour') >= 0) {
        reply += store.opening_hours ? 'Opening hours: ' + store.opening_hours + '.' : 'Please contact the business for current opening hours.';
      } else if (text.indexOf('whatsapp') >= 0 || text.indexOf('call') >= 0 || text.indexOf('phone') >= 0) {
        reply += 'You can contact them at ' + (store.whatsapp_number || store.phone || 'the listed phone number') + '.';
      } else {
        reply += 'I can help with services, menu, hours, bookings, orders, and contact details.';
      }
      return json(res, 200, { ok: true, reply: reply });
    }

    // ============ REVIEWS ============
    if (urlPath.match(/^\/api\/ecosystem\/stores\/[^/]+\/reviews$/) && method === 'GET') {
      var storeId = urlPath.split('/')[4];
      if (!getStore(storeId)) return json(res, 404, { error: 'Store not found.' });
      switchToStoreOwner(storeId);
      var reviews = [];
      try { reviews = db.prepare('SELECT * FROM store_reviews WHERE store_id = ? AND is_approved = 1 ORDER BY created_at DESC').all(storeId); } catch(e){}
      return json(res, 200, { ok: true, reviews: reviews });
    }

    if (urlPath.match(/^\/api\/ecosystem\/stores\/[^/]+\/reviews$/) && method === 'POST') {
      var storeId = urlPath.split('/')[4];
      if (!getStore(storeId)) return json(res, 404, { error: 'Store not found.' });
      if (!body.rating || body.rating < 1 || body.rating > 5) return json(res, 400, { error: 'Rating must be between 1 and 5.' });
      switchToStoreOwner(storeId);
      var reviewId = 'rev_' + generateId();
      db.prepare('INSERT INTO store_reviews (id, store_id, customer_name, customer_email, rating, comment, is_approved) VALUES (?, ?, ?, ?, ?, ?, 1)').run(reviewId, storeId, body.customer_name || 'Anonymous', body.customer_email || '', body.rating, body.comment || '');
      var review = db.prepare('SELECT * FROM store_reviews WHERE id = ?').get(reviewId);
      return json(res, 201, { ok: true, review: review });
    }

    if (urlPath.match(/^\/api\/ecosystem\/reviews\/[^/]+\/reply$/) && method === 'POST') {
      var reviewId = urlPath.split('/')[3];
      var review = scanOne('SELECT * FROM store_reviews WHERE id = ?', [reviewId]);
      if (!review) return json(res, 404, { error: 'Review not found.' });
      var rStore = getStore(review.store_id);
      if (requireStoreOwner(res, user, rStore)) return;
      switchToStoreOwner(review.store_id);
      db.prepare('UPDATE store_reviews SET reply = ? WHERE id = ?').run(body.reply || '', reviewId);
      return json(res, 200, { ok: true });
    }

    // ============ GYM MEMBERS & CHECK-INS ============
    function haversineM(lat1, lng1, lat2, lng2) {
      var R = 6371000;
      var dLat = (lat2 - lat1) * Math.PI / 180;
      var dLng = (lng2 - lng1) * Math.PI / 180;
      var a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng/2) * Math.sin(dLng/2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    function validMember(row, today) {
      if (!row) return false;
      if (row.status === 'Frozen') return false;
      if (row.expiry && String(row.expiry) < today) return false;
      return true;
    }

    // Admin: sync gym members (upsert by store_id + email)
    if (urlPath === '/api/ecosystem/gym/members/sync' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var syncStore = findGymStore(body.store_id);
      if (!syncStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, syncStore)) return;
      switchToStoreOwner(syncStore.id);
      var members = Array.isArray(body.members) ? body.members : [];
      var upsert = db.prepare('INSERT INTO gym_members (id, store_id, email, name, phone, plan, price, expiry, status, joined, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\')) ON CONFLICT(store_id, email) DO UPDATE SET name=excluded.name, phone=excluded.phone, plan=excluded.plan, price=excluded.price, expiry=excluded.expiry, status=excluded.status, joined=excluded.joined, updated_at=datetime(\'now\')');
      var count = 0;
      members.forEach(function(m) {
        var email = String(m.email || '').trim().toLowerCase();
        if (!email) return;
        upsert.run('gm_' + generateId(), syncStore.id, email, m.name || '', m.phone || '', m.plan || 'Basic', Number(m.price || 0), m.expiry || '', m.status || 'Active', m.joined || '');
        count++;
      });
      return json(res, 200, { ok: true, store_id: syncStore.id, synced: count, members: db.prepare('SELECT * FROM gym_members WHERE store_id = ?').all(syncStore.id) });
    }

    // Admin: list members for a store
    if (urlPath === '/api/ecosystem/gym/members' && method === 'GET') {
      if (requireLogin(res, user)) return;
      var mStore = findGymStore(new URL(req.url, 'http://localhost').searchParams.get('store_id') || '');
      if (!mStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, mStore)) return;
      switchToStoreOwner(mStore.id);
      return json(res, 200, { ok: true, store_id: mStore.id, members: db.prepare('SELECT * FROM gym_members WHERE store_id = ?').all(mStore.id) });
    }

    // Member: get my gym pass (by session email)
    if (urlPath === '/api/ecosystem/gym/pass' && method === 'GET') {
      if (requireLogin(res, user)) return;
      var passEmail = (user.isAdmin && new URL(req.url, 'http://localhost').searchParams.get('email')) || '';
      if (!passEmail) passEmail = user.email || '';
      passEmail = String(passEmail).trim().toLowerCase();
      var rows = scanRows('SELECT gm.* FROM gym_members gm WHERE gm.email = ?', [passEmail]);
      rows.forEach(function(r) { var s = getStore(r.store_id); r.store_name = s && s.name; r.store_address = s && s.address; r.store_lat = s && s.lat; r.store_lng = s && s.lng; });
      var today = new Date().toISOString().slice(0, 10);
      var passes = rows.map(function(r) {
        return { email: r.email, name: r.name, phone: r.phone, plan: r.plan, price: r.price, expiry: r.expiry, status: r.status, joined: r.joined, active: validMember(r, today), store_id: r.store_id, store_name: r.store_name, store_address: r.store_address, store_lat: r.store_lat, store_lng: r.store_lng };
      });
      return json(res, 200, { ok: true, email: passEmail, passes: passes });
    }

    // Member: hybrid auto check-in (app opens near gym -> records entry)
    if (urlPath === '/api/ecosystem/gym/checkin' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var checkinEmail = String(body.email || user.email || '').trim().toLowerCase();
      var lat = Number(body.lat || 0);
      var lng = Number(body.lng || 0);
      if (isNaN(lat) || isNaN(lng) || (!lat && !lng)) return json(res, 400, { error: 'lat and lng required.' });
      var today = new Date().toISOString().slice(0, 10);
      var store = body.store_id ? getStore(body.store_id) : null;
      var memberRows;
      if (store) {
        switchToStoreOwner(store.id);
        memberRows = db.prepare('SELECT * FROM gym_members WHERE store_id = ? AND email = ?').all(store.id, checkinEmail);
      } else {
        memberRows = scanRows('SELECT gm.*, s.lat as store_lat, s.lng as store_lng, s.name as store_name, s.id as sid FROM gym_members gm LEFT JOIN reg.stores s ON s.id = gm.store_id WHERE gm.email = ?', [checkinEmail]);
      }
      var eligible = memberRows.filter(function(m) {
        if (!validMember(m, today)) return false;
        var s = store || { lat: m.store_lat, lng: m.store_lng, id: m.sid };
        if (!s || !s.lat || !s.lng) return false;
        var dist = haversineM(lat, lng, s.lat, s.lng);
        return dist <= 200;
      });
      if (!eligible.length) {
        return json(res, 200, { ok: true, checkedIn: false, reason: 'not_near_gym', message: 'You are not within the gym zone.' });
      }
      var pick = eligible[0];
      var pickStore = store || { id: pick.sid, lat: pick.store_lat, lng: pick.store_lng };
      if (!store) switchToStoreOwner(pickStore.id);
      var dist = haversineM(lat, lng, pickStore.lat, pickStore.lng);
      var dup = db.prepare('SELECT * FROM gym_checkins WHERE store_id = ? AND member_email = ? AND date = ?').get(pickStore.id, checkinEmail, today);
      if (dup) {
        return json(res, 200, { ok: true, checkedIn: true, already: true, id: dup.id, time: dup.time, distance: Math.round(dup.distance) });
      }
      var checkinId = 'gci_' + generateId();
      var time = new Date().toTimeString().slice(0, 5);
      db.prepare('INSERT INTO gym_checkins (id, store_id, member_email, member_name, date, time, lat, lng, distance, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(checkinId, pickStore.id, checkinEmail, pick.name, today, time, lat, lng, Math.round(dist), body.source || 'app');
      return json(res, 201, { ok: true, checkedIn: true, already: false, id: checkinId, time: time, distance: Math.round(dist) });
    }

    // Member: my check-in history
    if (urlPath === '/api/ecosystem/gym/checkins/mine' && method === 'GET') {
      if (requireLogin(res, user)) return;
      var mineEmail = (user.isAdmin && new URL(req.url, 'http://localhost').searchParams.get('email')) || user.email || '';
      var mineRows = scanRows('SELECT c.* FROM gym_checkins c WHERE c.member_email = ? ORDER BY c.created_at DESC', [String(mineEmail).trim().toLowerCase()]);
      mineRows.forEach(function(c) { c.store_name = (getStore(c.store_id) || {}).name || ''; });
      return json(res, 200, { ok: true, email: mineEmail, checkins: mineRows });
    }

    // Admin: list check-ins for a store
    if (urlPath === '/api/ecosystem/gym/checkins' && method === 'GET') {
      if (requireLogin(res, user)) return;
      var chkStore = findGymStore(new URL(req.url, 'http://localhost').searchParams.get('store_id') || '');
      if (!chkStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, chkStore)) return;
      switchToStoreOwner(chkStore.id);
      var checkins = db.prepare('SELECT * FROM gym_checkins WHERE store_id = ? ORDER BY created_at DESC').all(chkStore.id);
      return json(res, 200, { ok: true, store_id: chkStore.id, checkins: checkins });
    }

    // Member: live presence heartbeat
    if (urlPath === '/api/ecosystem/gym/presence' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var pEmail = String(body.email || user.email || '').trim().toLowerCase();
      var plat = Number(body.lat || 0);
      var plng = Number(body.lng || 0);
      var pDevice = String(body.device_id || '').slice(0, 80);
      if (isNaN(plat) || isNaN(plng) || (!plat && !plng)) return json(res, 400, { error: 'lat and lng required.' });
      var nowIso = new Date().toISOString();
      var pStore = body.store_id ? getStore(body.store_id) : null;
      var pMemberRows;
      if (pStore) {
        switchToStoreOwner(pStore.id);
        pMemberRows = db.prepare('SELECT * FROM gym_members WHERE store_id = ? AND email = ?').all(pStore.id, pEmail);
      } else {
        pMemberRows = scanRows('SELECT gm.*, s.lat as store_lat, s.lng as store_lng, s.name as store_name, s.id as sid FROM gym_members gm LEFT JOIN reg.stores s ON s.id = gm.store_id WHERE gm.email = ?', [pEmail]);
      }
      var today = new Date().toISOString().slice(0, 10);
      var near = pMemberRows.filter(function(m) {
        if (!validMember(m, today)) return false;
        var s = pStore || { lat: m.store_lat, lng: m.store_lng, id: m.sid };
        if (!s || !s.lat || !s.lng) return false;
        return haversineM(plat, plng, s.lat, s.lng) <= 200;
      });
      if (!near.length) {
        return json(res, 200, { ok: true, present: false, reason: 'not_near_gym', message: 'You are not within the gym zone.' });
      }
      var pick = near[0];
      var pickStore = pStore || { id: pick.sid, lat: pick.store_lat, lng: pick.store_lng };
      if (!pStore) switchToStoreOwner(pickStore.id);
      var pDist = haversineM(plat, plng, pickStore.lat, pickStore.lng);
      var existing = db.prepare('SELECT * FROM gym_presence WHERE store_id = ? AND member_email = ?').get(pickStore.id, pEmail);
      var enteredAt;
      if (existing) {
        db.prepare('UPDATE gym_presence SET last_seen = ?, lat = ?, lng = ?, distance = ?, member_name = ?, device_id = ? WHERE id = ?')
          .run(nowIso, plat, plng, Math.round(pDist), pick.name || '', pDevice, existing.id);
        enteredAt = existing.entered_at;
      } else {
        enteredAt = nowIso;
        db.prepare('INSERT INTO gym_presence (id, store_id, member_email, member_name, entered_at, last_seen, lat, lng, distance, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run('gpres_' + generateId(), pickStore.id, pEmail, pick.name || '', nowIso, nowIso, plat, plng, Math.round(pDist), pDevice);
      }
      return json(res, 200, { ok: true, present: true, store_id: pickStore.id, entered_at: enteredAt, last_seen: nowIso, distance: Math.round(pDist) });
    }

    // Member: leave the gym
    if (urlPath === '/api/ecosystem/gym/presence/leave' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var lEmail = String(body.email || user.email || '').trim().toLowerCase();
      var lStore = body.store_id ? getStore(body.store_id) : findGymStore('');
      if (lStore) switchToStoreOwner(lStore.id);
      if (body.store_id) {
        db.prepare('DELETE FROM gym_presence WHERE store_id = ? AND member_email = ?').run(body.store_id, lEmail);
      } else {
        db.prepare('DELETE FROM gym_presence WHERE member_email = ?').run(lEmail);
      }
      return json(res, 200, { ok: true, present: false });
    }

    // Admin: live list of members currently in the gym
    if (urlPath === '/api/ecosystem/gym/presence' && method === 'GET') {
      if (requireLogin(res, user)) return;
      var lvStore = findGymStore(new URL(req.url, 'http://localhost').searchParams.get('store_id') || '');
      if (!lvStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, lvStore)) return;
      switchToStoreOwner(lvStore.id);
      var staleMs = Number(new URL(req.url, 'http://localhost').searchParams.get('within') || 120) * 1000;
      var cutoff = new Date(Date.now() - staleMs).toISOString();
      var rows = db.prepare('SELECT * FROM gym_presence WHERE store_id = ? AND last_seen >= ? ORDER BY entered_at ASC').all(lvStore.id, cutoff);
      var now = Date.now();
      var present = rows.map(function(r) {
        return {
          email: r.member_email,
          name: r.member_name,
          entered_at: r.entered_at,
          last_seen: r.last_seen,
          distance: Math.round(r.distance || 0),
          device_id: r.device_id || '',
          elapsed_s: Math.max(0, Math.round((now - new Date(r.entered_at).getTime()) / 1000))
        };
      });
      return json(res, 200, { ok: true, store_id: lvStore.id, count: present.length, present: present });
    }

    // ============ GYM INSTRUCTIONS ============
    if (urlPath === '/api/ecosystem/gym/instructions' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var insStore = findGymStore(body.store_id);
      if (!insStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, insStore)) return;
      switchToStoreOwner(insStore.id);
      var insTitle = String(body.title || '').slice(0, 200);
      var insMsg = String(body.message || '').slice(0, 2000);
      var insTarget = String(body.target || 'all').toLowerCase() === 'member' ? 'member' : 'all';
      var insEmail = String(body.member_email || '').trim().toLowerCase();
      if (insTarget === 'member' && !insEmail) return json(res, 400, { error: 'Member email required for a personal instruction.' });
      if (!insMsg) return json(res, 400, { error: 'Instruction message is required.' });
      if (insTarget === 'member') {
        var exists = db.prepare('SELECT id FROM gym_members WHERE store_id = ? AND email = ?').get(insStore.id, insEmail);
        if (!exists) return json(res, 404, { error: 'Member not found in this gym.' });
      }
      var insId = 'gins_' + generateId();
      db.prepare('INSERT INTO gym_instructions (id, store_id, target, member_email, title, message, author_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))')
        .run(insId, insStore.id, insTarget, insTarget === 'member' ? insEmail : '', insTitle, insMsg, user.name || user.email || 'Gym Owner');
      return json(res, 201, { ok: true, id: insId });
    }

    if (urlPath === '/api/ecosystem/gym/instructions' && method === 'GET') {
      if (requireLogin(res, user)) return;
      var insLStore = findGymStore(new URL(req.url, 'http://localhost').searchParams.get('store_id') || '');
      if (!insLStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, insLStore)) return;
      switchToStoreOwner(insLStore.id);
      var instructions = db.prepare('SELECT * FROM gym_instructions WHERE store_id = ? ORDER BY created_at DESC').all(insLStore.id);
      return json(res, 200, { ok: true, store_id: insLStore.id, instructions: instructions });
    }

    if (urlPath === '/api/ecosystem/gym/instructions' && method === 'DELETE') {
      if (requireLogin(res, user)) return;
      var insDStore = findGymStore(body.store_id);
      if (!insDStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, insDStore)) return;
      switchToStoreOwner(insDStore.id);
      var insDelId = String(body.id || '');
      var insRow = db.prepare('SELECT * FROM gym_instructions WHERE id = ? AND store_id = ?').get(insDelId, insDStore.id);
      if (!insRow) return json(res, 404, { error: 'Instruction not found.' });
      db.prepare('DELETE FROM gym_instructions WHERE id = ?').run(insDelId);
      return json(res, 200, { ok: true });
    }

    if (urlPath === '/api/ecosystem/gym/instructions/mine' && method === 'GET') {
      if (requireLogin(res, user)) return;
      var mineEmail = String(user.email || '').trim().toLowerCase();
      var myRows = scanRows('SELECT * FROM gym_instructions WHERE member_email = ? ORDER BY created_at DESC', [mineEmail]);
      var broadcastRows = scanRows('SELECT * FROM gym_instructions WHERE target = ? ORDER BY created_at DESC', ['all']);
      return json(res, 200, { ok: true, email: mineEmail, personal: myRows, broadcast: broadcastRows });
    }

    if (urlPath === '/api/ecosystem/gym/plans' && method === 'GET') {
      var plansStore = findGymStore(new URL(req.url, 'http://localhost').searchParams.get('store_id') || '');
      if (!plansStore) return json(res, 404, { error: 'Gym store not found.' });
      switchToStoreOwner(plansStore.id);
      var plans = [];
      try { plans = db.prepare('SELECT * FROM gym_plans WHERE store_id = ? ORDER BY price ASC').all(plansStore.id); } catch(e){}
      return json(res, 200, { ok: true, store_id: plansStore.id, plans: plans });
    }

    if (urlPath === '/api/ecosystem/gym/plans' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var saveStore = findGymStore(body.store_id);
      if (!saveStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, saveStore)) return;
      switchToStoreOwner(saveStore.id);
      if (!Array.isArray(body.plans)) return json(res, 400, { error: 'plans array required.' });
      db.prepare('DELETE FROM gym_plans WHERE store_id = ?').run(saveStore.id);
      var insPlan = db.prepare('INSERT INTO gym_plans (id, store_id, name, price, duration, duration_days, features, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      body.plans.forEach(function(p) {
        var name = String(p.name || '').slice(0, 120);
        if (!name) return;
        insPlan.run('gp_' + generateId(), saveStore.id, name, Number(p.price || 0), Number(p.duration || 30), Number(p.duration_days || p.duration || 30), JSON.stringify(Array.isArray(p.features) ? p.features : []), p.featured ? 1 : 0);
      });
      return json(res, 200, { ok: true, store_id: saveStore.id, plans: db.prepare('SELECT * FROM gym_plans WHERE store_id = ? ORDER BY price ASC').all(saveStore.id) });
    }

    // ============ GYM CLASSES & BOOKINGS ============
    function ownerGymStore() {
      var sid = body.store_id || new URL(req.url, 'http://localhost').searchParams.get('store_id') || '';
      var s = findGymStore(sid);
      if (!s) return null;
      return s;
    }

    // Public class schedule (used by member booking + owner)
    if (urlPath === '/api/ecosystem/gym/classes' && method === 'GET') {
      var clsStore = findGymStore(new URL(req.url, 'http://localhost').searchParams.get('store_id') || '');
      if (!clsStore) return json(res, 404, { error: 'Gym store not found.' });
      switchToStoreOwner(clsStore.id);
      var classes = [];
      try { classes = db.prepare('SELECT * FROM gym_classes WHERE store_id = ? ORDER BY day, start_time').all(clsStore.id); } catch(e){}
      classes.forEach(function(c) {
        var b = 0, booked = 0;
        try { b = db.prepare('SELECT COUNT(*) as c FROM gym_class_bookings WHERE class_id = ? AND status = ?').get(c.id, 'booked').c; } catch(e){}
        if (user && user.email) {
          try { var me = db.prepare('SELECT status FROM gym_class_bookings WHERE class_id = ? AND member_email = ?').get(c.id, String(user.email).trim().toLowerCase()); booked = me && me.status === 'booked' ? 1 : 0; } catch(e){}
        }
        c.enrolled = b; c.my_booking = booked; c.full = b >= c.capacity;
      });
      return json(res, 200, { ok: true, store_id: clsStore.id, classes: classes });
    }

    // Member: my class bookings across all gyms
    if (urlPath === '/api/ecosystem/gym/classes/mine' && method === 'GET') {
      if (requireLogin(res, user)) return;
      var myEmail = String(user.email || '').trim().toLowerCase();
      var myBookings = scanRows('SELECT b.* FROM gym_class_bookings b WHERE b.member_email = ? ORDER BY b.created_at DESC', [myEmail]);
      var classLookup = {};
      openOwnerDbs().forEach(function(od) {
        try { od.prepare('SELECT * FROM gym_classes').all().forEach(function(cl){ classLookup[cl.id] = cl; }); } catch(e){}
        try { od.close(); } catch(e){}
      });
      myBookings.forEach(function(r) {
        r.store_name = (getStore(r.store_id) || {}).name || '';
        var cl = classLookup[r.class_id];
        r.class_name = cl ? cl.name : '';
        r.day = cl ? cl.day : 0; r.start_time = cl ? cl.start_time : ''; r.end_time = cl ? cl.end_time : ''; r.trainer_name = cl ? cl.trainer_name : '';
      });
      return json(res, 200, { ok: true, email: myEmail, bookings: myBookings });
    }

    // Owner: create class
    if (urlPath === '/api/ecosystem/gym/classes' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var cStore = ownerGymStore();
      if (!cStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, cStore)) return;
      switchToStoreOwner(cStore.id);
      var cName = String(body.name || '').trim();
      if (!cName) return json(res, 400, { error: 'Class name required.' });
      var cId = 'gcl_' + generateId();
      db.prepare('INSERT INTO gym_classes (id, store_id, name, trainer_id, trainer_name, description, day, start_time, end_time, capacity, color, is_recurring, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(cId, cStore.id, cName, String(body.trainer_id || ''), String(body.trainer_name || ''), String(body.description || ''), Number(body.day || 0), String(body.start_time || '09:00'), String(body.end_time || '10:00'), Number(body.capacity || 20), String(body.color || '#38bdf8'), body.is_recurring === 0 ? 0 : 1, body.status === 'inactive' ? 'inactive' : 'active');
      return json(res, 201, { ok: true, id: cId, class: db.prepare('SELECT * FROM gym_classes WHERE id = ?').get(cId) });
    }

    // Owner: update class
    if (urlPath === '/api/ecosystem/gym/classes/update' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var cuStore = ownerGymStore();
      if (!cuStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, cuStore)) return;
      switchToStoreOwner(cuStore.id);
      var cuId = String(body.id || '');
      var cuRow = db.prepare('SELECT * FROM gym_classes WHERE id = ? AND store_id = ?').get(cuId, cuStore.id);
      if (!cuRow) return json(res, 404, { error: 'Class not found.' });
      db.prepare('UPDATE gym_classes SET name = ?, trainer_id = ?, trainer_name = ?, description = ?, day = ?, start_time = ?, end_time = ?, capacity = ?, color = ?, is_recurring = ?, status = ? WHERE id = ?')
        .run(String(body.name || cuRow.name), String(body.trainer_id || ''), String(body.trainer_name || ''), String(body.description || ''), Number(body.day != null ? body.day : cuRow.day), String(body.start_time || cuRow.start_time), String(body.end_time || cuRow.end_time), Number(body.capacity || cuRow.capacity), String(body.color || cuRow.color), body.is_recurring === 0 ? 0 : 1, body.status === 'inactive' ? 'inactive' : 'active', cuId);
      return json(res, 200, { ok: true });
    }

    // Owner: delete class
    if (urlPath === '/api/ecosystem/gym/classes/delete' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var cdStore = ownerGymStore();
      if (!cdStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, cdStore)) return;
      switchToStoreOwner(cdStore.id);
      var cdId = String(body.id || '');
      var cdRow = db.prepare('SELECT * FROM gym_classes WHERE id = ? AND store_id = ?').get(cdId, cdStore.id);
      if (!cdRow) return json(res, 404, { error: 'Class not found.' });
      db.prepare('DELETE FROM gym_class_bookings WHERE class_id = ?').run(cdId);
      db.prepare('DELETE FROM gym_classes WHERE id = ?').run(cdId);
      return json(res, 200, { ok: true });
    }

    // Member: book a class (with waitlist when full)
    if (urlPath === '/api/ecosystem/gym/classes/book' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var bkStore = ownerGymStore();
      if (!bkStore) return json(res, 404, { error: 'Gym store not found.' });
      switchToStoreOwner(bkStore.id);
      var bkId = String(body.class_id || '');
      var bkClass = db.prepare('SELECT * FROM gym_classes WHERE id = ? AND store_id = ? AND status = ?').get(bkId, bkStore.id, 'active');
      if (!bkClass) return json(res, 404, { error: 'Class not found or inactive.' });
      var bkEmail = String(body.email || user.email || '').trim().toLowerCase();
      var bkMember = db.prepare('SELECT * FROM gym_members WHERE store_id = ? AND email = ?').get(bkStore.id, bkEmail);
      var today = new Date().toISOString().slice(0, 10);
      if (!bkMember || !validMember(bkMember, today)) return json(res, 403, { error: 'Only active gym members can book classes.' });
      var existing = db.prepare('SELECT * FROM gym_class_bookings WHERE class_id = ? AND member_email = ?').get(bkId, bkEmail);
      if (existing) {
        if (existing.status === 'cancelled') {
          var cap = db.prepare('SELECT COUNT(*) as c FROM gym_class_bookings WHERE class_id = ? AND status = ?').get(bkId, 'booked').c;
          db.prepare('UPDATE gym_class_bookings SET status = ?, attended = 0 WHERE id = ?').run(cap < bkClass.capacity ? 'booked' : 'waitlist', existing.id);
          return json(res, 200, { ok: true, status: cap < bkClass.capacity ? 'booked' : 'waitlist', already: true });
        }
        return json(res, 200, { ok: true, status: existing.status, already: true });
      }
      var enrolled = db.prepare('SELECT COUNT(*) as c FROM gym_class_bookings WHERE class_id = ? AND status = ?').get(bkId, 'booked').c;
      var newStatus = enrolled < bkClass.capacity ? 'booked' : 'waitlist';
      var bId = 'gbk_' + generateId();
      db.prepare('INSERT INTO gym_class_bookings (id, class_id, store_id, member_email, member_name, status) VALUES (?, ?, ?, ?, ?, ?)')
        .run(bId, bkId, bkStore.id, bkEmail, bkMember.name || bkEmail, newStatus);
      return json(res, 201, { ok: true, status: newStatus, id: bId, full: newStatus === 'waitlist' });
    }

    // Member: cancel booking
    if (urlPath === '/api/ecosystem/gym/classes/cancel' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var ccStore = ownerGymStore();
      if (!ccStore) return json(res, 404, { error: 'Gym store not found.' });
      switchToStoreOwner(ccStore.id);
      var ccId = String(body.class_id || '');
      var ccEmail = String(body.email || user.email || '').trim().toLowerCase();
      var ccRow = db.prepare('SELECT * FROM gym_class_bookings WHERE class_id = ? AND member_email = ?').get(ccId, ccEmail);
      if (!ccRow) return json(res, 404, { error: 'Booking not found.' });
      db.prepare('UPDATE gym_class_bookings SET status = ? WHERE id = ?').run('cancelled', ccRow.id);
      // promote a waitlisted member into the freed spot
      var wait = db.prepare('SELECT * FROM gym_class_bookings WHERE class_id = ? AND status = ? ORDER BY created_at LIMIT 1').get(ccId, 'waitlist');
      if (wait) db.prepare('UPDATE gym_class_bookings SET status = ? WHERE id = ?').run('booked', wait.id);
      return json(res, 200, { ok: true });
    }

    // ============ MEMBER PROFILE & BODY METRICS ============
    function findGymMemberById(dbx, id) {
      try { return dbx.prepare('SELECT * FROM gym_members WHERE id = ?').get(id); } catch(e){ return null; }
    }

    // Owner: get member profile + latest metrics
    if (urlPath === '/api/ecosystem/gym/member-profile' && method === 'GET') {
      if (requireLogin(res, user)) return;
      var pStore = ownerGymStore();
      if (!pStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, pStore)) return;
      switchToStoreOwner(pStore.id);
      var pMid = String(new URL(req.url, 'http://localhost').searchParams.get('member_id') || '');
      var pMember = findGymMemberById(db, pMid);
      if (!pMember) return json(res, 404, { error: 'Member not found.' });
      var profile = null;
      try { profile = db.prepare('SELECT * FROM gym_member_profiles WHERE member_id = ?').get(pMid); } catch(e){}
      var metrics = [];
      try { metrics = db.prepare('SELECT * FROM gym_body_metrics WHERE member_id = ? ORDER BY measured_at ASC').all(pMid); } catch(e){}
      var payments = [];
      try { payments = db.prepare('SELECT * FROM gym_member_payments WHERE member_id = ? ORDER BY created_at DESC').all(pMid); } catch(e){}
      return json(res, 200, { ok: true, member: pMember, profile: profile, metrics: metrics, payments: payments });
    }

    // Owner: save/upsert member profile
    if (urlPath === '/api/ecosystem/gym/member-profile' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var psStore = ownerGymStore();
      if (!psStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, psStore)) return;
      switchToStoreOwner(psStore.id);
      var psMid = String(body.member_id || '');
      if (!findGymMemberById(db, psMid)) return json(res, 404, { error: 'Member not found.' });
      var exists = db.prepare('SELECT id FROM gym_member_profiles WHERE member_id = ?').get(psMid);
      var vals = [Number(body.height_cm || 0), String(body.gender || ''), String(body.dob || ''), String(body.goal || ''), String(body.activity_level || 'moderate'), String(body.health_conditions || ''), String(body.emergency_contact || ''), String(body.emergency_phone || ''), String(body.notes || '')];
      if (exists) {
        var upStmt = db.prepare('UPDATE gym_member_profiles SET height_cm = ?, gender = ?, dob = ?, goal = ?, activity_level = ?, health_conditions = ?, emergency_contact = ?, emergency_phone = ?, notes = ?, updated_at = datetime(\'now\') WHERE member_id = ?');
        upStmt.run.apply(upStmt, vals.concat([psMid]));
      } else {
        var pid = 'gmp_' + generateId();
        var insStmt = db.prepare('INSERT INTO gym_member_profiles (id, store_id, member_id, height_cm, gender, dob, goal, activity_level, health_conditions, emergency_contact, emergency_phone, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        insStmt.run.apply(insStmt, [pid, psStore.id, psMid].concat(vals));
      }
      return json(res, 200, { ok: true, profile: db.prepare('SELECT * FROM gym_member_profiles WHERE member_id = ?').get(psMid) });
    }

    // Owner: add a body-metrics entry (progress tracking)
    if (urlPath === '/api/ecosystem/gym/metrics/add' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var mStore = ownerGymStore();
      if (!mStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, mStore)) return;
      switchToStoreOwner(mStore.id);
      var mmid = String(body.member_id || '');
      var mmember = findGymMemberById(db, mmid);
      if (!mmember) return json(res, 404, { error: 'Member not found.' });
      var w = Number(body.weight_kg || 0);
      var h = Number(body.height_cm || 0);
      var bmi = h > 0 ? Math.round((w / ((h / 100) * (h / 100))) * 10) / 10 : 0;
      var mId = 'gbm_' + generateId();
      db.prepare('INSERT INTO gym_body_metrics (id, store_id, member_id, weight_kg, body_fat, muscle_kg, bmi, chest_cm, waist_cm, hip_cm, bicep_cm, thigh_cm, measured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))')
        .run(mId, mStore.id, mmid, w, Number(body.body_fat || 0), Number(body.muscle_kg || 0), bmi, Number(body.chest_cm || 0), Number(body.waist_cm || 0), Number(body.hip_cm || 0), Number(body.bicep_cm || 0), Number(body.thigh_cm || 0));
      return json(res, 201, { ok: true, id: mId, bmi: bmi, metrics: db.prepare('SELECT * FROM gym_body_metrics WHERE member_id = ? ORDER BY measured_at ASC').all(mmid) });
    }

    // ============ BILLING, RENEWALS & MEMBERSHIP ============
    // Renew: extend expiry by the member's plan duration, record payment
    if (urlPath === '/api/ecosystem/gym/member/renew' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var rStore = ownerGymStore();
      if (!rStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, rStore)) return;
      switchToStoreOwner(rStore.id);
      var rMid = String(body.member_id || '');
      var rMember = findGymMemberById(db, rMid);
      if (!rMember) return json(res, 404, { error: 'Member not found.' });
      var days = Number(body.days || 0);
      if (!days) {
        var planRow = null;
        try { planRow = db.prepare('SELECT * FROM gym_plans WHERE store_id = ? AND name = ?').get(rStore.id, rMember.plan); } catch(e){}
        days = (planRow && planRow.duration_days) ? Number(planRow.duration_days) : 30;
      }
      var base = rMember.expiry && String(rMember.expiry) >= new Date().toISOString().slice(0, 10) ? new Date(String(rMember.expiry) + 'T23:59:59') : new Date();
      base.setDate(base.getDate() + days);
      var newExpiry = base.toISOString().slice(0, 10);
      var amount = Number(body.amount != null ? body.amount : rMember.price || 0);
      db.prepare('UPDATE gym_members SET expiry = ?, status = ?, updated_at = datetime(\'now\'), last_renewed = datetime(\'now\') WHERE id = ?').run(newExpiry, 'Active', rMid);
      var payId = 'gpay_' + generateId();
      db.prepare('INSERT INTO gym_member_payments (id, store_id, member_id, member_email, member_name, type, amount, method, reference, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(payId, rStore.id, rMid, rMember.email, rMember.name, body.type || 'renewal', amount, body.method || 'cash', String(body.reference || ''), 'Renewed ' + days + ' days');
      return json(res, 200, { ok: true, expiry: newExpiry, days: days, amount: amount });
    }

    // Freeze a membership (pause billing) with optional duration
    if (urlPath === '/api/ecosystem/gym/member/freeze' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var fStore = ownerGymStore();
      if (!fStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, fStore)) return;
      switchToStoreOwner(fStore.id);
      var fMid = String(body.member_id || '');
      if (!findGymMemberById(db, fMid)) return json(res, 404, { error: 'Member not found.' });
      db.prepare('UPDATE gym_members SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run('Frozen', fMid);
      return json(res, 200, { ok: true, status: 'Frozen' });
    }

    // Unfreeze a membership
    if (urlPath === '/api/ecosystem/gym/member/unfreeze' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var uStore = ownerGymStore();
      if (!uStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, uStore)) return;
      switchToStoreOwner(uStore.id);
      var uMid = String(body.member_id || '');
      if (!findGymMemberById(db, uMid)) return json(res, 404, { error: 'Member not found.' });
      db.prepare('UPDATE gym_members SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run('Active', uMid);
      return json(res, 200, { ok: true, status: 'Active' });
    }

    // Transfer / upgrade-downgrade plan, record payment
    if (urlPath === '/api/ecosystem/gym/member/transfer' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var tStore = ownerGymStore();
      if (!tStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, tStore)) return;
      switchToStoreOwner(tStore.id);
      var tm = String(body.member_id || '');
      var tMem = findGymMemberById(db, tm);
      if (!tMem) return json(res, 404, { error: 'Member not found.' });
      var newPlan = String(body.plan || tMem.plan);
      var newPrice = Number(body.price != null ? body.price : tMem.price);
      var was = tMem.plan;
      db.prepare('UPDATE gym_members SET plan = ?, price = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newPlan, newPrice, tm);
      var tpId = 'gpay_' + generateId();
      db.prepare('INSERT INTO gym_member_payments (id, store_id, member_id, member_email, member_name, type, amount, method, reference, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(tpId, tStore.id, tm, tMem.email, tMem.name, body.type || 'upgrade', newPrice, body.method || 'cash', String(body.reference || ''), 'Plan changed: ' + was + ' -> ' + newPlan);
      return json(res, 200, { ok: true, plan: newPlan, price: newPrice });
    }

    // Owner: list all member payments for a store
    if (urlPath === '/api/ecosystem/gym/payments' && method === 'GET') {
      if (requireLogin(res, user)) return;
      var gpStore = ownerGymStore();
      if (!gpStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, gpStore)) return;
      switchToStoreOwner(gpStore.id);
      var gpayments = [];
      try { gpayments = db.prepare('SELECT * FROM gym_member_payments WHERE store_id = ? ORDER BY created_at DESC').all(gpStore.id); } catch(e){}
      return json(res, 200, { ok: true, store_id: gpStore.id, payments: gpayments });
    }

    // Owner: delete a member
    if (urlPath === '/api/ecosystem/gym/member/delete' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var gdStore = ownerGymStore();
      if (!gdStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, gdStore)) return;
      switchToStoreOwner(gdStore.id);
      var gdMid = String(body.member_id || '');
      if (!findGymMemberById(db, gdMid)) return json(res, 404, { error: 'Member not found.' });
      db.prepare('DELETE FROM gym_members WHERE id = ?').run(gdMid);
      db.prepare('DELETE FROM gym_member_profiles WHERE member_id = ?').run(gdMid);
      db.prepare('DELETE FROM gym_body_metrics WHERE member_id = ?').run(gdMid);
      db.prepare('DELETE FROM gym_class_bookings WHERE member_email IN (SELECT email FROM gym_members WHERE id = ?)').run(gdMid);
      return json(res, 200, { ok: true });
    }

    // Owner: add a one-off payment (PT, products, etc.)
    if (urlPath === '/api/ecosystem/gym/payment/add' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var aStore = ownerGymStore();
      if (!aStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, aStore)) return;
      switchToStoreOwner(aStore.id);
      var am = String(body.member_id || '');
      var aMem = findGymMemberById(db, am);
      if (!aMem) return json(res, 404, { error: 'Member not found.' });
      var apId = 'gpay_' + generateId();
      db.prepare('INSERT INTO gym_member_payments (id, store_id, member_id, member_email, member_name, type, amount, method, reference, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(apId, aStore.id, am, aMem.email, aMem.name, body.type || 'other', Number(body.amount || 0), body.method || 'cash', String(body.reference || ''), String(body.note || ''));
      return json(res, 201, { ok: true, id: apId });
    }

    // Owner: renewals due within N days
    if (urlPath === '/api/ecosystem/gym/renewals-due' && method === 'GET') {
      if (requireLogin(res, user)) return;
      var rdStore = ownerGymStore();
      if (!rdStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, rdStore)) return;
      switchToStoreOwner(rdStore.id);
      var horizon = Number(new URL(req.url, 'http://localhost').searchParams.get('days') || 14);
      var today = new Date().toISOString().slice(0, 10);
      var horizonDate = new Date(Date.now() + horizon * 86400000).toISOString().slice(0, 10);
      var rows = db.prepare('SELECT * FROM gym_members WHERE status = ? ORDER BY expiry ASC').all('Active');
      var due = rows.filter(function(m) { return m.expiry && m.expiry >= today && m.expiry <= horizonDate; })
        .map(function(m) { var d = Math.max(0, Math.round((new Date(m.expiry + 'T00:00:00').getTime() - Date.now()) / 86400000)); return Object.assign({}, m, { days_left: d }); });
      var expired = rows.filter(function(m) { return m.expiry && m.expiry < today; }).map(function(m) { return Object.assign({}, m, { days_left: Math.round((Date.now() - new Date(m.expiry + 'T00:00:00').getTime()) / 86400000) * -1 }); });
      return json(res, 200, { ok: true, horizon: horizon, due: due, expired: expired });
    }

    // ============ ATTENDANCE ANALYTICS ============
    if (urlPath === '/api/ecosystem/gym/analytics' && method === 'GET') {
      if (requireLogin(res, user)) return;
      var anStore = ownerGymStore();
      if (!anStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, anStore)) return;
      switchToStoreOwner(anStore.id);
      var checkins = [];
      try { checkins = db.prepare('SELECT * FROM gym_checkins WHERE store_id = ?').all(anStore.id); } catch(e){}
      var members = [];
      try { members = db.prepare('SELECT * FROM gym_members WHERE store_id = ?').all(anStore.id); } catch(e){}
      var today = new Date().toISOString().slice(0, 10);
      // weekly trend (last 14 days)
      var trend = [];
      for (var i = 13; i >= 0; i--) {
        var d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        var cnt = checkins.filter(function(c) { return c.date === d; }).length;
        trend.push({ date: d, count: cnt });
      }
      // peak hours (from checkins time)
      var hours = {};
      checkins.forEach(function(c) { if (c.time) { var h = c.time.slice(0, 2); hours[h] = (hours[h] || 0) + 1; } });
      var peakHours = Object.keys(hours).map(function(h) { return { hour: h + ':00', count: hours[h] }; }).sort(function(a, b) { return b.count - a.count; });
      // member streaks (consecutive check-in days per member)
      var streakMap = {};
      var byMember = {};
      checkins.forEach(function(c) { (byMember[c.member_email] = byMember[c.member_email] || {})[c.date] = true; });
      Object.keys(byMember).forEach(function(email) {
        var days = Object.keys(byMember[email]).sort();
        var best = 0, cur = 0, prev = null;
        days.forEach(function(d) {
          if (prev && (new Date(d) - new Date(prev)) === 86400000) cur++; else cur = 1;
          if (cur > best) best = cur; prev = d;
        });
        streakMap[email] = best;
      });
      // status breakdown
      var statusCounts = { Active: 0, Frozen: 0, Expired: 0, Inactive: 0 };
      members.forEach(function(m) {
        if (m.status === 'Frozen') statusCounts.Frozen++;
        else if (m.expiry && m.expiry < today) statusCounts.Expired++;
        else if (m.status === 'Inactive') statusCounts.Inactive++;
        else statusCounts.Active++;
      });
      // retention: active now vs members with any check-in in last 30 days
      var last30 = new Set();
      checkins.forEach(function(c) { if (c.date >= new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)) last30.add(c.member_email); });
      var classStats = [];
      try {
        var classes = db.prepare('SELECT * FROM gym_classes WHERE store_id = ?').all(anStore.id);
        classStats = classes.map(function(c) {
          var b = db.prepare('SELECT COUNT(*) as c FROM gym_class_bookings WHERE class_id = ? AND status = ?').get(c.id, 'booked').c;
          return { id: c.id, name: c.name, capacity: c.capacity, enrolled: b, utilization: Math.min(100, Math.round((b / c.capacity) * 100)), day: c.day, start_time: c.start_time };
        }).sort(function(a, b) { return b.utilization - a.utilization; });
      } catch(e){}
      var totalRevenue = 0;
      try { totalRevenue = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM gym_member_payments WHERE store_id = ?').get(anStore.id).s; } catch(e){}
      return json(res, 200, { ok: true, trend: trend, peak_hours: peakHours, streaks: streakMap, status: statusCounts, total_members: members.length, active_30d: last30.size, total_revenue: totalRevenue, class_utilization: classStats });
    }

    // ============ STAFF MANAGEMENT ============
    if (urlPath === '/api/ecosystem/gym/staff' && method === 'GET') {
      if (requireLogin(res, user)) return;
      var stStore = ownerGymStore();
      if (!stStore) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, stStore)) return;
      switchToStoreOwner(stStore.id);
      var staff = [];
      try { staff = db.prepare('SELECT * FROM gym_staff WHERE store_id = ? ORDER BY created_at ASC').all(stStore.id); } catch(e){}
      return json(res, 200, { ok: true, store_id: stStore.id, staff: staff });
    }

    if (urlPath === '/api/ecosystem/gym/staff' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var st2 = ownerGymStore();
      if (!st2) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, st2)) return;
      switchToStoreOwner(st2.id);
      var stName = String(body.name || '').trim();
      if (!stName) return json(res, 400, { error: 'Staff name required.' });
      var stId = String(body.id || '');
      if (stId) {
        var stRow = db.prepare('SELECT * FROM gym_staff WHERE id = ? AND store_id = ?').get(stId, st2.id);
        if (!stRow) return json(res, 404, { error: 'Staff not found.' });
        db.prepare('UPDATE gym_staff SET name = ?, role = ?, email = ?, phone = ?, salary = ?, commission_pct = ?, specialty = ?, active = ?, joined = ? WHERE id = ?')
          .run(stName, body.role || stRow.role, String(body.email || ''), String(body.phone || ''), Number(body.salary || 0), Number(body.commission_pct || 0), String(body.specialty || ''), body.active === 0 ? 0 : 1, String(body.joined || stRow.joined), stId);
        return json(res, 200, { ok: true });
      }
      var nStaff = 'gst_' + generateId();
      db.prepare('INSERT INTO gym_staff (id, store_id, name, role, email, phone, salary, commission_pct, specialty, active, joined) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(nStaff, st2.id, stName, body.role || 'trainer', String(body.email || ''), String(body.phone || ''), Number(body.salary || 0), Number(body.commission_pct || 0), String(body.specialty || ''), body.active === 0 ? 0 : 1, String(body.joined || new Date().toISOString().slice(0, 10)));
      return json(res, 201, { ok: true, id: nStaff });
    }

    if (urlPath === '/api/ecosystem/gym/staff/delete' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var st3 = ownerGymStore();
      if (!st3) return json(res, 404, { error: 'Gym store not found.' });
      if (requireStoreOwner(res, user, st3)) return;
      switchToStoreOwner(st3.id);
      var stDel = String(body.id || '');
      var stRow2 = db.prepare('SELECT * FROM gym_staff WHERE id = ? AND store_id = ?').get(stDel, st3.id);
      if (!stRow2) return json(res, 404, { error: 'Staff not found.' });
      db.prepare('DELETE FROM gym_staff WHERE id = ?').run(stDel);
      return json(res, 200, { ok: true });
    }

    // ============ AI GYM INSTRUCTOR ============
    if (urlPath === '/api/ecosystem/gym/trainer' && method === 'POST') {
      if (requireLogin(res, user)) return;
      var tEmail = String(body.email || user.email || '').trim().toLowerCase();
      var tQuery = String(body.query || '').slice(0, 1000);
      var tGoal = String(body.goal || 'general').slice(0, 60);
      var tLevel = String(body.level || 'beginner').slice(0, 30);
      var tDuration = Number(body.duration || 45);
      var tPlan = String(body.plan || '').slice(0, 60);
      if (tQuery && tQuery.length < 2) return json(res, 400, { error: 'Query too short.' });

      var memberRow = scanOne('SELECT gm.* FROM gym_members gm WHERE gm.email = ?', [tEmail]);
      var planName = tPlan || (memberRow && memberRow.plan) || 'Standard';
      var goal = tGoal === 'general' && memberRow ? (String(memberRow.plan || '').toLowerCase().indexOf('premium') !== -1 ? 'muscle' : 'general') : tGoal;

      function aiResponse(type, payload) {
        return json(res, 200, Object.assign({ ok: true, provider: 'ai-instructor', type: type, email: tEmail, member: memberRow ? memberRow.name : '', plan: planName }, payload));
      }

      function buildSession(goalKey) {
        var g = (goalKey || 'general').toLowerCase();
        var focus = 'Full Body';
        if (g === 'muscle' || g === 'strength' || g === 'gain' || g === 'bulk') focus = 'Push / Pull';
        if (g === 'fatloss' || g === 'weight' || g === 'cut' || g === 'slim') focus = 'HIIT + Cardio';
        if (g === 'abs' || g === 'core' || g === 'sixpack') focus = 'Core + Abs';
        var dur = tDuration > 0 ? tDuration : 45;
        var minutes = Math.max(15, Math.min(90, dur));
        var parts = [];
        parts.push({ name: 'Warm-up', time: 8, items: ['Arm circles x15 each side', 'Torso twists x20', 'Leg swings x12 each', 'Light jog on treadmill 4 min'] });
        var main = [];
        if (focus === 'Push / Pull') {
          main = [
            { name: 'Push-ups', sets: 4, reps: tLevel === 'beginner' ? '8-10' : '12-15', rest: '60s' },
            { name: 'Dumbbell Press', sets: 4, reps: tLevel === 'beginner' ? '8-10' : '10-12', rest: '60s' },
            { name: 'Lat Pulldown', sets: 4, reps: '10-12', rest: '60s' },
            { name: 'Seated Row', sets: 3, reps: '10-12', rest: '60s' },
            { name: 'Squats', sets: 4, reps: tLevel === 'beginner' ? '10' : '12-15', rest: '90s' },
            { name: 'Leg Press', sets: 3, reps: '12-15', rest: '90s' }
          ];
        } else if (focus === 'HIIT + Cardio') {
          main = [
            { name: 'Jumping Jacks', sets: 4, reps: '40s work / 20s rest', rest: '20s' },
            { name: 'Mountain Climbers', sets: 4, reps: '40s work / 20s rest', rest: '20s' },
            { name: 'High Knees', sets: 4, reps: '40s work / 20s rest', rest: '20s' },
            { name: 'Burpees', sets: 4, reps: '12-15', rest: '45s' },
            { name: 'Plank', sets: 3, reps: '45s hold', rest: '30s' },
            { name: 'Treadmill Incline Walk', sets: 1, reps: minutes + ' min @ 3% incline', rest: '—' }
          ];
        } else if (focus === 'Core + Abs') {
          main = [
            { name: 'Ab Crunch Machine', sets: 3, reps: '12-15', rest: '45s' },
            { name: 'Cable Crunches', sets: 3, reps: '12-15', rest: '45s' },
            { name: 'Hanging Leg Raises', sets: 3, reps: '10-12', rest: '45s' },
            { name: 'Torso Rotation (Cable)', sets: 3, reps: '12 each side', rest: '45s' },
            { name: 'Plank', sets: 3, reps: '45-60s hold', rest: '30s' },
            { name: 'Back Extension', sets: 3, reps: '15', rest: '45s' }
          ];
        } else {
          main = [
            { name: 'Bodyweight Squats', sets: 3, reps: '12-15', rest: '45s' },
            { name: 'Push-ups', sets: 3, reps: tLevel === 'beginner' ? '6-8' : '10-12', rest: '45s' },
            { name: 'Dumbbell Rows', sets: 3, reps: '10-12', rest: '60s' },
            { name: 'Plank', sets: 3, reps: '30-45s hold', rest: '30s' },
            { name: 'Lunges', sets: 3, reps: '10 each leg', rest: '45s' },
            { name: 'Shoulder Press', sets: 3, reps: '10-12', rest: '60s' }
          ];
        }
        parts.push({ name: 'Main Workout', time: Math.max(20, minutes - 13), items: main });
        parts.push({ name: 'Cool-down', time: 5, items: ['Hamstring stretch 30s', 'Quad stretch 30s', 'Chest stretch 30s', 'Deep breathing 1 min'] });
        return { focus: focus, goal: goalKey, level: tLevel, totalMinutes: minutes, parts: parts };
      }

      function machineGuide(key) {
        var k = String(key).toLowerCase();
        var lib = {
          'treadmill': { name: 'Treadmill', muscles: 'cardio / fat loss', how: 'Start slow 5-6 km/h. Warm up 3 min, then raise speed or incline. Walk or jog with upright posture, arms swinging naturally, soft foot strikes.', tips: 'Keep your chest up and don\u2019t hold the rails \u2014 that cuts your work by up to 20%.', 'common': 'Slouching and death-gripping the handles.' },
          'elliptical': { name: 'Elliptical / Cross Trainer', muscles: 'cardio / full body', how: 'Step on, grip handles, keep a gentle push-pull rhythm. Maintain steady resistance that lets you talk, then raise it as you warm up.', tips: 'Stand tall, engage core, don\u2019t lean on the console.', 'common': 'Holding the moving handles and letting the machine do the work.' },
          'bike': { name: 'Stationary Bike', muscles: 'legs / cardio', how: 'Set the seat so your knee is slightly bent at the bottom of the pedal stroke. Start easy resistance, keep a smooth cadence 70-90 rpm.', tips: 'Pedal with the ball of your foot, don\u2019t rock your hips.', 'common': 'Seat too low/high causing knee strain.' },
          'rowing machine': { name: 'Rowing Machine', muscles: 'back / legs / arms / cardio', how: 'Push with legs first, then lean back and pull the handle to your ribs, then reverse \u2014 arms, body, legs. Drive 60% legs, 20% back, 20% arms.', tips: 'Keep your back neutral. Use a full, smooth stroke \u2014 don\u2019t jerk.', 'common': 'Pulling with arms only and rounding the back.' },
          'leg press': { name: 'Leg Press', muscles: 'quads / glutes / hamstrings', how: 'Sit in, plant feet shoulder-width on the platform, release safety, lower the sled until knees are ~90\u00b0, push through the whole foot.', tips: 'Keep lower back flat on the pad. Don\u2019t lock knees at the top.', 'common': 'Letting knees cave in or going too deep past your flexibility.' },
          'leg curl': { name: 'Leg Curl Machine', muscles: 'hamstrings', how: 'Lie face down, pad on the back of ankles. Curl heels toward glutes in a controlled motion, pause, lower slowly.', tips: 'Don\u2019t swing your hips off the pad. Keep a slow tempo.', 'common': 'Using momentum and arching the back.' },
          'leg extension': { name: 'Leg Extension Machine', muscles: 'quads', how: 'Sit with pad on front of ankles, extend legs until straight, pause briefly, lower with control.', tips: 'Don\u2019t let the weight drop. Keep your hips planted.', 'common': 'Bouncing the weight and hyperextending the knees.' },
          'hack squat': { name: 'Hack Squat', muscles: 'quads / glutes', how: 'Stand on the platform, shoulders under the pads, lower until thighs are parallel-ish, press up through mid-foot.', tips: 'Keep toes forward or slightly out. Chest up, back flat against the pad.', 'common': 'Going too shallow or rounding the lower back.' },
          'smith machine': { name: 'Smith Machine', muscles: 'full body (guided squats, presses)', how: 'Set the bar hooks at shoulder height. For squats: bar on upper back, feet slightly forward, lower into a squat, push straight up along the rails.', tips: 'The fixed path helps beginners, but keep form strict \u2014 it can also lock you into bad patterns.', 'common': 'Leaning too far forward on the squat.' },
          'cable machine': { name: 'Cable Machine', muscles: 'full body (hundreds of moves)', how: 'Adjust pulley height, pick the right handle. Keep tension on the cable through the whole range and move in a controlled line.', tips: 'Set the pulley at the right height \u2014 low for rows, mid for presses, high for pulldowns.', 'common': 'Using too much weight and letting the stack slam.' },
          'lat pulldown': { name: 'Lat Pulldown Machine', muscles: 'back / lats / biceps', how: 'Grip bar wider than shoulders, sit and brace your thighs under the pad. Pull bar down to upper chest, squeeze lats, return slowly.', tips: 'Lean back slightly and pull with your lats, not your arms.', 'common': 'Pulling the bar behind your neck.' },
          'seated row': { name: 'Seated Row Machine', muscles: 'back / rear delts / biceps', how: 'Sit with knees slightly bent, feet on platform. Pull the handle to your abdomen, squeeze shoulder blades, return with control.', tips: 'Keep your back straight and chest proud.', 'common': 'Leaning too far back and rounding the spine.' },
          'chest press': { name: 'Chest Press Machine', muscles: 'chest / triceps / shoulders', how: 'Adjust seat so handles are at mid-chest. Press forward until arms nearly straight, pause, return slowly.', tips: 'Keep shoulders down and back against the pad.', 'common': 'Shrugging shoulders or bouncing at the end.' },
          'pec deck': { name: 'Pec Deck / Butterfly', muscles: 'chest', how: 'Sit with forearms or handles at chest level, squeeze the pads together in front of you, hold, open slowly.', tips: 'Control the opening \u2014 don\u2019t let the stack pull your arms apart.', 'common': 'Using shoulders instead of chest to squeeze.' },
          'shoulder press': { name: 'Shoulder Press Machine', muscles: 'shoulders / triceps', how: 'Sit with handles at shoulder height, press up until arms extend, lower slowly to ear level.', tips: 'Keep core tight and don\u2019t arch your back.', 'common': 'Locking elbows or pressing behind your head.' },
          'bicep curl': { name: 'Bicep Curl Machine', muscles: 'biceps', how: 'Sit with elbows on the pad, curl the handles up in a smooth arc, squeeze at top, lower slowly.', tips: 'Don\u2019t let your elbows lift off the pad.', 'common': 'Swinging the weight up with momentum.' },
          'triceps pushdown': { name: 'Triceps Pushdown (cable)', muscles: 'triceps', how: 'Stand facing cable, grip the bar, elbows pinned to your sides. Push the bar down until arms straight, pause, return slowly.', tips: 'Keep elbows still \u2014 only your forearms should move.', 'common': 'Elbows flaring out or leaning into the cable.' },
          'ab crunch machine': { name: 'Ab Crunch Machine', muscles: 'abs', how: 'Sit, place feet under pads and arms on the handles. Crunch down toward your thighs, exhale, squeeze, return slowly.', tips: 'Use your abs, not your arms or legs, to drive the crunch.', 'common': 'Jerking the weight with momentum.' },
          'torso rotation': { name: 'Torso Rotation / Rotary Torso', muscles: 'obliques / core', how: 'Sit with torso against pad, grip handles, rotate side to side in a controlled arc.', tips: 'Keep hips square and pivot from your waist.', 'common': 'Moving the hips and using the whole body.' },
          'back extension': { name: 'Back Extension Bench', muscles: 'lower back / glutes', how: 'Anchor your ankles, hips on the pad, cross arms. Hinge forward slowly, then lift back up to a straight line.', tips: 'Don\u2019t hyperextend at the top \u2014 stop when your body is straight.', 'common': 'Arching too far up or rounding too far down.' },
          'hip abduction': { name: 'Hip Abduction Machine', muscles: 'glutes / outer thighs', how: 'Sit with knees against the outer pads, push outward against resistance, squeeze, return slowly.', tips: 'Keep your back pressed into the seat.', 'common': 'Using body lean to swing the weight.' }
        };
        if (lib[k]) return lib[k];
        for (var mk in lib) {
          if (k.indexOf(mk) !== -1 || mk.indexOf(k) !== -1) return lib[mk];
        }
        return null;
      }

      function machinesForGoal(goalKey) {
        var g = (goalKey || '').toLowerCase();
        if (g === 'fatloss' || g === 'weight' || g === 'cut' || g === 'slim') {
          return 'For fat loss, rotate the cardio machines: Treadmill (steady incline walk or intervals), Elliptical, Stationary Bike, and Rowing Machine. Add the Smith Machine or Leg Press for resistance work to keep muscle while losing fat.';
        }
        if (g === 'abs' || g === 'core' || g === 'sixpack') {
          return 'For abs/core: Ab Crunch Machine, Cable Crunches, Torso Rotation, Back Extension, and Hanging Leg Raises (if available). Machine tip: set a weight you can do 12-15 clean reps \u2014 control beats heavy.';
        }
        if (g === 'muscle' || g === 'strength' || g === 'gain' || g === 'bulk') {
          return 'To build muscle: Chest Press, Lat Pulldown, Seated Row, Shoulder Press, Leg Press, Leg Curl, and Hack Squat. Use heavier weights in the 6-12 rep range, 60-90s rest between sets.';
        }
        return 'Use compound machines first \u2014 Leg Press, Chest Press, Lat Pulldown, Seated Row \u2014 then add isolation machines like Leg Curl, Bicep Curl, and Pec Deck. Ask me \u201cwhich machine for chest\u201d or \u201chow to use the leg press\u201d anytime.';
      }

      function exerciseForm(name) {
        var forms = {
          'push-ups': { how: 'Hands slightly wider than shoulders, body in a straight line. Lower chest to floor, keep elbows at ~45\u00b0, push back up.', tips: 'Engage core. Don\u2019t let hips sag.','common': 'Elbows flaring too wide, hips dipping.' },
          'squats': { how: 'Feet shoulder-width, toes slightly out. Sit back and down as if into a chair, knees tracking over toes, chest up.', tips: 'Keep heels planted. Drive through mid-foot.', 'common': 'Knees caving in, heels lifting.' },
          'plank': { how: 'Forearms on floor, elbows under shoulders, body straight from head to heels. Hold.', tips: 'Tighten glutes and abs. Don\u2019t hold your breath.', 'common': 'Hips sagging or piking up.' },
          'dumbbell press': { how: 'Lie on bench, dumbbells at chest level, palms forward. Press up until arms extend, lower slowly.', tips: 'Keep wrists straight. Don\u2019t bounce at the bottom.', 'common': 'Locking elbows at the top.' },
          'lat pulldown': { how: 'Grip bar wider than shoulders, pull down to upper chest, squeeze lats, return slowly.', tips: 'Lean back slightly. Pull with lats, not arms.', 'common': 'Pulling bar behind the neck.' },
          'seated row': { how: 'Feet on platform, slight knee bend, pull handle to abdomen, squeeze shoulder blades.', tips: 'Keep back straight. Don\u2019t lean too far back.', 'common': 'Rounding the lower back.' },
          'burpees': { how: 'Squat, kick feet back to plank, push-up, jump feet in, jump up with hands overhead.', tips: 'Keep core tight. Land soft on toes.', 'common': 'Skipping the push-up, landing heavy.' },
          'lunges': { how: 'Step forward, lower back knee toward floor, front thigh parallel to floor. Push back to start.', tips: 'Torso upright. Front knee over ankle.', 'common': 'Front knee caving inward.' }
        };
        return forms[name] || { how: 'Follow the machine/equipment diagram and keep controlled, full range-of-motion reps with good posture.', tips: 'Start light, focus on form before adding weight.', 'common': 'Using momentum instead of muscle.' };
      }

      function bodyPartMachines(part) {
        var p = String(part || '').toLowerCase();
        var map = {
          'chest': 'For chest: Chest Press Machine, Pec Deck (Butterfly), and Cable Flyes. Use the Cable Machine at mid-chest height for flyes.',
          'back': 'For back: Lat Pulldown, Seated Row, and Rowing Machine. The Cable Machine with a low pulley is great for seated cable rows too.',
          'leg': 'For legs: Leg Press, Hack Squat, Leg Extension (quads), Leg Curl (hamstrings), and Hip Abduction for glutes. Add the Smith Machine for guided squats.',
          'shoulder': 'For shoulders: Shoulder Press Machine and the Cable Machine (lateral raises with a low pulley).',
          'arm': 'For arms: Bicep Curl Machine, Triceps Pushdown (cable), and Preacher Curl. The Cable Machine works both biceps and triceps.',
          'biceps': 'For biceps: Bicep Curl Machine and the Cable Machine (curl attachment).',
          'triceps': 'For triceps: Triceps Pushdown on the Cable Machine and the Chest Press (secondary).',
          'abs': 'For abs: Ab Crunch Machine, Torso Rotation (obliques), Cable Crunches, and Back Extension for the lower back.',
          'glute': 'For glutes: Hip Abduction Machine, Leg Press (feet high), Hack Squat, and Rowing Machine (drive phase).',
          'fat': 'For fat loss, rotate cardio machines: Treadmill (incline intervals), Stationary Bike, Elliptical, and Rowing Machine. Add resistance on the Smith Machine or Leg Press to keep muscle while you cut.',
          'cardio': 'For cardio: Treadmill, Stationary Bike, Elliptical, and Rowing Machine. Mix steady-state and intervals for best fat-burning results.'
        };
        for (var k in map) {
          if (p.indexOf(k) !== -1) return map[k];
        }
        return null;
      }

      if (tQuery) {
        if (isAIConfigured()) {
          return aiChat([{ role: 'user', content: tQuery }], {
            role: 'gym-member',
            member: memberRow ? memberRow.name : '',
            plan: planName,
            goal: goal,
            level: tLevel
          }).then(function(aiResult) {
            if (aiResult && aiResult.ok && aiResult.content) {
              return aiResponse('reply', { reply: aiResult.content, session: buildSession(goal), engine: 'openai' });
            }
            return heuristicReply();
          }).catch(function() { return heuristicReply(); });
        }
        return heuristicReply();
      }

      return aiResponse('session', Object.assign(buildSession(goal), { engine: 'heuristic' }));

      function heuristicReply() {
        var q = tQuery.toLowerCase();
        var out = { reply: '', suggestion: null };
        if (q.indexOf('what machines') !== -1 || q.indexOf('list of machines') !== -1 || q.indexOf('all machines') !== -1 || q.indexOf('machines are there') !== -1 || (q.indexOf('what equipment') !== -1 && q.indexOf('gym') !== -1) || q.indexOf('equipment should i use') !== -1) {
          out.reply = machinesForGoal(goal);
        } else if (q.indexOf('which machine') !== -1 || q.indexOf('what machine') !== -1 || q.indexOf('machine for') !== -1 || q.indexOf('which machines') !== -1) {
          var mTarget = q.replace(/.*(which machines|machines for|machine for|which machine|what machines|what machine)\s*(is|should i use|to use|for)?\s*/i, '').trim().replace(/[?]/g, '');
          var mKey = mTarget.split(' ')[0];
          var mg = machineGuide(mKey);
          if (mg) {
            out.reply = 'For ' + (mTarget || mKey) + ', use the ' + mg.name + ' (works ' + mg.muscles + '). How to use it: ' + mg.how + ' Tip: ' + mg.tips + ' Common mistake: ' + mg['common'];
          } else {
            var bm = bodyPartMachines(mTarget);
            if (bm) {
              out.reply = bm;
            } else {
              out.reply = machinesForGoal(goal) + ' Tell me a specific one (e.g. "which machine for chest", "how to use the leg press") and I\u2019ll give you step-by-step setup.';
            }
          }
        } else if (q.indexOf('machine') !== -1 && (q.indexOf('use') !== -1 || q.indexOf('how') !== -1 || q.indexOf('do') !== -1 || q.indexOf('set up') !== -1)) {
          var mUse = q.replace(/.*(how to use|how do i use|how do you use|set up|use)\s*(the|a)?\s*/i, '').trim().replace(/[?]/g, '');
          var mUseKey = mUse.split(' ')[0];
          var mug = machineGuide(mUseKey || mUse);
          if (mug) {
            out.reply = mug.name + ' (' + mug.muscles + '): ' + mug.how + ' Tip: ' + mug.tips + ' Common mistake: ' + mug['common'];
          } else {
            out.reply = machinesForGoal(goal);
          }
        } else if (q.indexOf('how') !== -1 && q.indexOf('use') !== -1) {
          var mUse2 = q.replace(/.*(how to use|how do i use|how do you use|how can i use)\s*(the|a)?\s*/i, '').trim().replace(/[?]/g, '');
          var mUse2Key = mUse2.split(' ')[0];
          var mug2 = machineGuide(mUse2Key || mUse2);
          if (mug2) {
            out.reply = 'To use the ' + mug2.name + ' (works ' + mug2.muscles + '): ' + mug2.how + ' Tip: ' + mug2.tips + ' Common mistake: ' + mug2['common'];
          } else {
            out.reply = 'I can teach you most machines in the gym \u2014 ask me like "how to use the leg press", "how to use the treadmill", or "which machine for back". ' + machinesForGoal(goal);
          }
        } else if (q.indexOf('machines') !== -1 || q.indexOf('gym machine') !== -1 || q.indexOf('equipment') !== -1) {
          out.reply = machinesForGoal(goal);
        } else if (q.indexOf('fat loss') !== -1 || q.indexOf('fatloss') !== -1 || q.indexOf('lose fat') !== -1 || q.indexOf('lose weight') !== -1 || q.indexOf('weight loss') !== -1 || q.indexOf('slim') !== -1 || q.indexOf('burn fat') !== -1 || q.indexOf('belly') !== -1) {
          out.reply = 'Fat loss is mostly a calorie deficit plus consistent training. For your ' + planName + ' plan (' + tLevel + ' level): do 4-5 sessions/week \u2014 20-30 min cardio (Treadmill, Bike, Elliptical or Rowing) plus 2 resistance days to keep muscle. Add core work 3x/week. Diet: ~1.6-2g protein per kg, more vegetables, fewer liquid calories, aim to lose 0.5-1 kg per week. Here is a fat-loss session to start.';
          out.session = buildSession('fatloss');
        } else if (q.indexOf('six pack') !== -1 || q.indexOf('six-pack') !== -1 || q.indexOf('6 pack') !== -1 || q.indexOf('6-pack') !== -1 || q.indexOf('abs') !== -1 || q.indexOf('ab workout') !== -1 || q.indexOf('core workout') !== -1 || q.indexOf('belly fat') !== -1) {
          out.reply = 'Six-pack = developed abs + low body fat. Train your core 3-4x/week with Ab Crunch Machine, Cable Crunches, Hanging Leg Raises, Torso Rotation and Planks (12-15 reps, controlled). But no amount of crunches reveals abs if body fat is high \u2014 pair it with a calorie deficit and cardio. Here is your core session.';
          out.session = buildSession('abs');
        } else if ((q.indexOf('increase') !== -1 || q.indexOf('gain') !== -1 || q.indexOf('bigger') !== -1 || q.indexOf('bulk') !== -1 || q.indexOf('build muscle') !== -1 || q.indexOf('grow') !== -1) && (q.indexOf('body') !== -1 || q.indexOf('muscle') !== -1 || q.indexOf('weight') !== -1)) {
          out.reply = 'To increase body size (bulk): eat a slight calorie surplus (+200-300 kcal/day) with ~1.8-2.2g protein per kg, and train heavy in the 6-12 rep range. Use the big machines \u2014 Leg Press, Chest Press, Lat Pulldown, Seated Row, Shoulder Press, Hack Squat. Sleep 7-9h for growth. Here is your muscle-building session.';
          out.session = buildSession('muscle');
        } else if ((q.indexOf('decrease') !== -1 || q.indexOf('reduce') !== -1 || q.indexOf('shrink') !== -1 || q.indexOf('lean') !== -1 || q.indexOf('cut') !== -1 || q.indexOf('slim down') !== -1) && (q.indexOf('body') !== -1 || q.indexOf('weight') !== -1 || q.indexOf('muscle') !== -1)) {
          out.reply = 'To decrease body weight / get lean (cut): eat a modest calorie deficit, keep protein high (~2g/kg) to preserve muscle, train 4-5x/week \u2014 mix cardio machines (Treadmill, Bike, Rowing) with resistance work. Expect 0.5-1 kg per week loss; slow and steady keeps the muscle you built. Here is your cutting session.';
          out.session = buildSession('cut');
        } else if (q.indexOf('start') !== -1 || q.indexOf('today') !== -1 || q.indexOf('begin') !== -1 || q.indexOf('workout') !== -1) {
          out.reply = 'Here is your session for today (' + planName + ' plan, ' + tLevel + ' level). Warm up well, keep the tempo steady, and stop if you feel sharp pain.';
          out.session = buildSession(goal);
        } else if (q.indexOf('how') !== -1 && q.indexOf('do') !== -1) {
          var target = q.replace(/.*(how to do|how do i do|how can i do|how to use)\s*/i, '').trim().replace(/[?]/g, '');
          var formKey = target.split(' ')[0];
          var fm = exerciseForm(formKey);
          var mgDo = machineGuide(formKey);
          if (mgDo) {
            out.reply = 'To use the ' + mgDo.name + ' (works ' + mgDo.muscles + '): ' + mgDo.how + ' Tip: ' + mgDo.tips + ' Common mistake: ' + mgDo['common'];
          } else {
            out.reply = 'Here\u2019s how to do "' + (target || formKey) + '": ' + fm.how + ' Tips: ' + fm.tips + ' Common mistake: ' + fm['common'];
          }
        } else if (q.indexOf('warm') !== -1) {
          out.reply = 'A good warm-up is 5-8 minutes: 4 min light cardio (jog/cycling), then dynamic moves \u2014 arm circles x15, torso twists x20, leg swings x12 each, bodyweight squats x10. Raise your heart rate and loosen the joints you\u2019ll use.';
        } else if (q.indexOf('rest') !== -1) {
          out.reply = 'Rest guidance: strength exercises 60-90s between sets, hypertrophy 45-60s, HIIT 20-30s (as paced). Full rest between different muscle groups is fine.';
        } else if (q.indexOf('protein') !== -1 || q.indexOf('food') !== -1 || q.indexOf('eat') !== -1 || q.indexOf('diet') !== -1) {
          out.reply = 'Fuel your training: aim for ~1.6-2.2g protein per kg bodyweight daily. Eat a balanced meal 2h before training and a protein+carb snack within 60-90 min after. Hydrate throughout.';
        } else if (q.indexOf('day') !== -1 || q.indexOf('week') !== -1 || q.indexOf('split') !== -1) {
          out.reply = 'A simple 3-day split: Mon \u2014 Upper Body, Wed \u2014 Lower Body, Fri \u2014 Full Body / Cardio. Rest at least 48h per muscle group. On your ' + planName + ' plan, consistency beats intensity \u2014 3-4 sessions/week is ideal.';
        } else if (q.indexOf('stretch') !== -1 || q.indexOf('cool') !== -1) {
          out.reply = 'Cool down with 5 min of static stretching: hamstrings, quads, chest, and glutes \u2014 hold each 30s. Then deep breathing to bring your heart rate down.';
        } else {
          out.reply = 'I\u2019m your AI gym instructor. You can ask me things like "start a workout", "how to do a squat", "warm up for me", "what should I eat", or "give me a weekly plan". I\u2019ll guide you step by step based on your ' + planName + ' plan and ' + tLevel + ' level.';
          out.session = buildSession(goal);
        }
        return aiResponse('reply', Object.assign(out, { engine: 'heuristic' }));
      }
    }

    return null;
  }).catch(function(err) {
    console.error('Ecosystem API error:', err && err.message);
    return json(res, 500, { error: 'Internal server error.' });
  }).finally(function() {
    if (db) { try { db.close(); } catch(e){} }
  });
}

module.exports = { handleEcosystem };
