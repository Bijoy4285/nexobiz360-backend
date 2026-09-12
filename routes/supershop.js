var QRCode = null;
try { QRCode = require('qrcode'); } catch (e) { console.error('[supershop] qrcode unavailable: ' + (e && e.message)); }
var crypto = require('crypto');
var https = require('https');
var ecoDbLib = require('../lib/ecosystem-db');
var authLib = require('../lib/auth');

function genId(prefix) {
  return (prefix || 'ss') + '_' + Date.now().toString(36) + '_' + crypto.randomBytes(6).toString('hex');
}

function genToken() {
  return crypto.randomBytes(16).toString('hex');
}

function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(obj));
}

function parseBody(req) {
  return new Promise(function(resolve, reject) {
    var raw = '';
    req.on('data', function(chunk) { raw += chunk; });
    req.on('end', function() {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch(e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function now() { return new Date().toISOString(); }

// ============ SSE (real-time push, no extra deps) ============
// storeId -> array of open response objects. Customer PWA and owner dashboard
// subscribe; checkout/confirm/flag events are pushed instantly.
var sseClients = {};
function sseBroadcast(storeId, type, payload) {
  var clients = sseClients[storeId];
  if (!clients || !clients.length) return;
  var msg = 'event: ' + type + '\ndata: ' + JSON.stringify(payload) + '\n\n';
  for (var i = clients.length - 1; i >= 0; i--) {
    try { clients[i].write(msg); } catch (e) { clients.splice(i, 1); }
  }
}

function handleRoutes(urlPath, req, res, user, db, writeDb) {
  // ============ OPTIONS ============
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    });
    res.end();
    return true;
  }

  // ============ SSE STREAM (real-time updates) ============
  if (urlPath.match(/^\/api\/supershop\/stream\/[^/]+$/) && req.method === 'GET') {
    var sid = urlPath.split('/').pop();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('retry: 3000\n\n');
    res.write(': connected\n\n');
    if (!sseClients[sid]) sseClients[sid] = [];
    sseClients[sid].push(res);
    var hb = setInterval(function() { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
    req.on('close', function() {
      clearInterval(hb);
      var arr = sseClients[sid];
      if (arr) { var idx = arr.indexOf(res); if (idx !== -1) arr.splice(idx, 1); }
    });
    return true;
  }

  // ============ GENERIC QR IMAGE ============
  if (urlPath === '/api/supershop/qr' && req.method === 'GET') {
    var q = require('url').parse(req.url, true).query;
    if (!q || !q.text) return json(res, 400, { error: 'text required' });
    var size = parseInt(q.size || '300', 10) || 300;
    if (!QRCode) return json(res, 503, { error: 'qrcode package not installed on this server' });
    QRCode.toBuffer(q.text, { width: size, margin: 2, errorCorrectionLevel: 'M' }, function(err, buf) {
      if (err) return json(res, 500, { error: 'qr generation failed' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
      res.end(buf);
    });
    return true;
  }

  // ============ ENABLE SUPERSHOP ============
  if (urlPath === '/api/supershop/enable' && req.method === 'POST') {
    if (!user) return json(res, 401, { error: 'Unauthorized' });
    return (async function() {
      var body = await parseBody(req);
      var storeId = String(body.storeId || '').trim();
      if (!storeId) return json(res, 400, { ok: false, error: 'storeId required' });
       var ecoDb = ecoDbLib.getDb();
       var store = ecoDb.prepare('SELECT * FROM stores WHERE id = ?').get(storeId);
       if (!store) { ecoDb.close(); return json(res, 404, { ok: false, error: 'Store not found' }); }
       var isAdmin = authLib.isAdminEmail && authLib.isAdminEmail(user.email);
       var unowned = !store.owner_id;
       if (String(store.owner_id) !== String(user.id) && !isAdmin && !unowned) {
         ecoDb.close(); return json(res, 403, { ok: false, error: 'Not your store' });
       }

        var entryToken = store.entry_qr_token || genToken();
        var checkoutToken = store.checkout_qr_token || genToken();
        var wantEnabled = body.enabled !== false;
        // Claim unowned (demo) stores to the enabling user so they become manageable.
        if (unowned && user.id && wantEnabled) {
          ecoDb.prepare('UPDATE stores SET owner_id = ? WHERE id = ? AND (owner_id IS NULL OR owner_id = \'\')').run(user.id, storeId);
        }
        ecoDb.prepare('UPDATE stores SET entry_qr_token = ?, checkout_qr_token = ?, supershop_enabled = ? WHERE id = ?')
          .run(entryToken, checkoutToken, wantEnabled ? 1 : 0, storeId);

      var baseUrl = (req.headers['x-forwarded-proto'] || 'http') + '://' + (req.headers.host || 'localhost:3000');
      var entryUrl = baseUrl + '/supershop?entry=' + storeId + '&t=' + entryToken;
      var checkoutUrl = baseUrl + '/supershop?checkout=' + storeId + '&t=' + checkoutToken;

      var entryQr = QRCode ? await QRCode.toDataURL(entryUrl, { width: 400, margin: 1 }) : '';
      var checkoutQr = QRCode ? await QRCode.toDataURL(checkoutUrl, { width: 400, margin: 1 }) : '';

      ecoDb.close();
      return json(res, 200, { ok: true, entryToken: entryToken, checkoutToken: checkoutToken, entryUrl: entryUrl, checkoutUrl: checkoutUrl, entryQr: entryQr, checkoutQr: checkoutQr });
    })();
  }

  // ============ GET STORE SUPERHOP INFO ============
  if (urlPath.match(/^\/api\/supershop\/store\/[^/]+$/) && req.method === 'GET') {
    var storeId = urlPath.split('/').pop();
    var ecoDb = ecoDbLib.getDb();
    var store = ecoDb.prepare('SELECT id, name, type, address, phone, entry_qr_token, checkout_qr_token, supershop_enabled FROM stores WHERE id = ?').get(storeId);
    ecoDb.close();
    if (!store) return json(res, 404, { ok: false, error: 'Store not found' });
    return json(res, 200, { ok: true, store: store });
  }

  // ============ LIST PRODUCTS BY STORE (customer view) ============
  if (urlPath.match(/^\/api\/supershop\/products\/[^/]+$/) && req.method === 'GET') {
    var storeId = urlPath.split('/').pop();
    var ecoDb = ecoDbLib.getDb();
    var products = ecoDb.prepare('SELECT id, name, description, price, image_url, barcode, stock_qty, is_available, regular_price, shelf_location FROM menu_items WHERE store_id = ? AND is_visible_to_customers = 1 AND is_available = 1 ORDER BY name').all(storeId);
    // Also check global DB for demo stores (empty owner_id)
    if (products.length === 0) {
      try {
        var globalDb = ecoDbLib.getDb();
        products = globalDb.prepare('SELECT id, name, description, price, image_url, barcode, stock_qty, is_available, regular_price, shelf_location FROM menu_items WHERE store_id = ? AND is_visible_to_customers = 1 AND is_available = 1 ORDER BY name').all(storeId);
        globalDb.close();
      } catch(e) {}
    }
    ecoDb.close();
    return json(res, 200, { ok: true, products: products });
  }

  // ============ LOOKUP PRODUCT BY BARCODE ============
  if (urlPath.match(/^\/api\/supershop\/scan\/[^/]+\/[^/]+$/) && req.method === 'GET') {
    var parts = urlPath.split('/');
    var barcode = decodeURIComponent(parts[4]);
    var storeId = parts[5];
    var ecoDb = ecoDbLib.getDb();
    var product = ecoDb.prepare('SELECT id, name, description, price, image_url, barcode, stock_qty, is_available, regular_price, shelf_location FROM menu_items WHERE store_id = ? AND barcode = ? AND is_available = 1').get(storeId, barcode);
    if (!product) {
      try {
        var globalDb = ecoDbLib.getDb();
        product = globalDb.prepare('SELECT id, name, description, price, image_url, barcode, stock_qty, is_available, regular_price, shelf_location FROM menu_items WHERE store_id = ? AND barcode = ? AND is_available = 1').get(storeId, barcode);
        globalDb.close();
      } catch(e) {}
    }
    ecoDb.close();
    if (!product) return json(res, 404, { ok: false, error: 'Product not found for barcode: ' + barcode });
    if (product.stock_qty === 0) return json(res, 409, { ok: false, error: 'Out of stock', product: product });
    return json(res, 200, { ok: true, product: product });
  }

  // ============ OWNER BARCODE LOOKUP (local first, then Open Food Facts) ============
  if (urlPath.match(/^\/api\/supershop\/lookup\/[^/]+\/[^/]+$/) && req.method === 'GET') {
    var lparts = urlPath.split('/');
    var lcode = decodeURIComponent(lparts[4]);
    var lstore = lparts[5];
    // 1) Local catalog
    var leco = ecoDbLib.getDb();
    var lprod = leco.prepare('SELECT id, name, description, price, image_url, barcode, stock_qty, is_available, regular_price, shelf_location FROM menu_items WHERE store_id = ? AND barcode = ?').get(lstore, lcode);
    if (!lprod) {
      try { var lg = ecoDbLib.getDb(); lprod = lg.prepare('SELECT id, name, description, price, image_url, barcode, stock_qty, is_available, regular_price, shelf_location FROM menu_items WHERE store_id = ? AND barcode = ?').get(lstore, lcode); lg.close(); } catch(e) {}
    }
    leco.close();
    if (lprod) return json(res, 200, { ok: true, found: true, source: 'local', product: lprod });

    // 2) Open Food Facts (free, no key). Best-effort; never blocks the owner.
    var offUrl = 'https://world.openfoodfacts.org/api/v0/product/' + encodeURIComponent(lcode) + '.json';
    var reqOpts = { headers: { 'User-Agent': 'OceanSFT-SuperShop/1.0' }, timeout: 6000 };
    var offReq = https.get(offUrl, reqOpts, function(offRes) {
      var chunks = '';
      offRes.on('data', function(c) { chunks += c; });
      offRes.on('end', function() {
        try {
          var data = JSON.parse(chunks);
          if (data && data.status === 1 && data.product) {
            var p = data.product;
            var name = (p.product_name || p.product_name_en || '').trim();
            var img = p.image_front_url || p.image_url || (p.images && p.images.front && p.images.front.display && p.images.front.display.url) || '';
            var brand = (p.brands || '').trim();
            return json(res, 200, { ok: true, found: true, source: 'openfoodfacts', name: name, image_url: img, brand: brand, barcode: lcode });
          }
          return json(res, 200, { ok: true, found: false, barcode: lcode });
        } catch (e) {
          return json(res, 200, { ok: true, found: false, barcode: lcode });
        }
      });
    });
    offReq.on('error', function() { return json(res, 200, { ok: true, found: false, barcode: lcode }); });
    offReq.on('timeout', function() { offReq.destroy(); return json(res, 200, { ok: true, found: false, barcode: lcode }); });
    return true;
  }

  // ============ CREATE CART SESSION ============
  if (urlPath === '/api/supershop/cart/create' && req.method === 'POST') {
    return (async function() {
      var body = await parseBody(req);
      var storeId = String(body.storeId || '').trim();
      var phone = String(body.phone || '').trim();
      var email = String(body.email || '').trim();
      var name = String(body.name || '').trim();
      if (!storeId) return json(res, 400, { ok: false, error: 'storeId required' });

      var ecoDb = ecoDbLib.getDb();
      var cartId = genId('cart');
      var token = genToken();
      ecoDb.prepare('INSERT INTO cart_sessions (id, store_id, customer_phone, customer_email, status, qr_token, last_scan_at, created_at) VALUES (?, ?, ?, ?, \'active\', ?, ?, ?)')
        .run(cartId, storeId, phone, email, token, now(), now());

      // Upsert customer/lead
      if (phone || email) {
        try {
          var existing = null;
          if (phone) existing = ecoDb.prepare('SELECT id FROM supershop_customers WHERE store_id = ? AND phone = ?').get(storeId, phone);
          if (!existing && email) existing = ecoDb.prepare('SELECT id FROM supershop_customers WHERE store_id = ? AND email = ?').get(storeId, email);
          if (existing) {
            ecoDb.prepare('UPDATE supershop_customers SET last_seen_at = ?, visit_count = visit_count + 1 WHERE id = ?').run(now(), existing.id);
          } else {
            ecoDb.prepare('INSERT INTO supershop_customers (id, store_id, phone, email, name, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(genId('cust'), storeId, phone, email, name, now(), now());
          }
        } catch(e) {}
      }

      ecoDb.close();
      return json(res, 201, { ok: true, cartId: cartId, token: token });
    })();
  }

  // ============ GET CART SESSION ============
  if (urlPath.match(/^\/api\/supershop\/cart\/[^/]+$/) && req.method === 'GET') {
    var cartId = urlPath.split('/').pop();
    var ecoDb = ecoDbLib.getDb();
    var session = ecoDb.prepare('SELECT * FROM cart_sessions WHERE id = ?').get(cartId);
    if (!session) { ecoDb.close(); return json(res, 404, { ok: false, error: 'Cart not found' }); }
    var items = ecoDb.prepare('SELECT ci.*, mi.image_url, mi.description FROM cart_items ci LEFT JOIN menu_items mi ON ci.product_id = mi.id WHERE ci.cart_session_id = ? ORDER BY ci.created_at').all(cartId);
    ecoDb.close();
    var subtotal = items.reduce(function(s, i) { return s + (Number(i.price) * Number(i.qty)); }, 0);
    return json(res, 200, { ok: true, session: session, items: items, subtotal: subtotal });
  }

  // ============ ADD ITEM TO CART ============
  if (urlPath.match(/^\/api\/supershop\/cart\/[^/]+\/add$/) && req.method === 'POST') {
    return (async function() {
      var cartId = urlPath.split('/')[4];
      var body = await parseBody(req);
      var productId = String(body.productId || '').trim();
      var qty = Number(body.qty) || 1;
      if (!cartId || !productId) return json(res, 400, { ok: false, error: 'cartId and productId required' });

      var ecoDb = ecoDbLib.getDb();
      var session = ecoDb.prepare('SELECT * FROM cart_sessions WHERE id = ?').get(cartId);
      if (!session) { ecoDb.close(); return json(res, 404, { ok: false, error: 'Cart not found' }); }
      if (session.status !== 'active') { ecoDb.close(); return json(res, 400, { ok: false, error: 'Cart is not active' }); }

      var product = ecoDb.prepare('SELECT * FROM menu_items WHERE id = ? AND store_id = ?').get(productId, session.store_id);
      if (!product) { ecoDb.close(); return json(res, 404, { ok: false, error: 'Product not found' }); }
      if (!product.is_available) { ecoDb.close(); return json(res, 409, { ok: false, error: 'Product unavailable' }); }

      // Check stock
      var existingItem = ecoDb.prepare('SELECT * FROM cart_items WHERE cart_session_id = ? AND product_id = ?').get(cartId, productId);
      var newQty = existingItem ? Number(existingItem.qty) + qty : qty;
      if (product.stock_qty >= 0 && newQty > product.stock_qty) {
        ecoDb.close();
        return json(res, 409, { ok: false, error: 'Not enough stock. Available: ' + product.stock_qty });
      }

      if (existingItem) {
        ecoDb.prepare('UPDATE cart_items SET qty = ? WHERE id = ?').run(newQty, existingItem.id);
      } else {
        ecoDb.prepare('INSERT INTO cart_items (id, cart_session_id, product_id, name, price, qty, price_at_scan, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(genId('ci'), cartId, productId, product.name, product.price, qty, product.price, now());
      }
      ecoDb.prepare('UPDATE cart_sessions SET last_scan_at = ? WHERE id = ?').run(now(), cartId);

      var items = ecoDb.prepare('SELECT ci.*, mi.image_url FROM cart_items ci LEFT JOIN menu_items mi ON ci.product_id = mi.id WHERE ci.cart_session_id = ? ORDER BY ci.created_at').all(cartId);
      ecoDb.close();
      var subtotal = items.reduce(function(s, i) { return s + (Number(i.price) * Number(i.qty)); }, 0);
      return json(res, 200, { ok: true, items: items, subtotal: subtotal });
    })();
  }

  // ============ UPDATE ITEM QTY ============
  if (urlPath.match(/^\/api\/supershop\/cart\/[^/]+\/item\/[^/]+\/qty$/) && req.method === 'PUT') {
    return (async function() {
      var parts = urlPath.split('/');
      var cartId = parts[4];
      var itemId = parts[6];
      var body = await parseBody(req);
      var qty = Number(body.qty);
      if (isNaN(qty) || qty < 0) return json(res, 400, { ok: false, error: 'Invalid qty' });

      var ecoDb = ecoDbLib.getDb();
      var session = ecoDb.prepare('SELECT * FROM cart_sessions WHERE id = ?').get(cartId);
      if (!session || session.status !== 'active') { ecoDb.close(); return json(res, 400, { ok: false, error: 'Cart not active' }); }

      if (qty === 0) {
        ecoDb.prepare('DELETE FROM cart_items WHERE id = ? AND cart_session_id = ?').run(itemId, cartId);
      } else {
        var item = ecoDb.prepare('SELECT * FROM cart_items WHERE id = ? AND cart_session_id = ?').get(itemId, cartId);
        if (!item) { ecoDb.close(); return json(res, 404, { ok: false, error: 'Item not found' }); }
        var product = ecoDb.prepare('SELECT stock_qty FROM menu_items WHERE id = ?').get(item.product_id);
        if (product && product.stock_qty >= 0 && qty > product.stock_qty) {
          ecoDb.close();
          return json(res, 409, { ok: false, error: 'Not enough stock. Available: ' + product.stock_qty });
        }
        ecoDb.prepare('UPDATE cart_items SET qty = ? WHERE id = ?').run(qty, itemId);
      }

      var items = ecoDb.prepare('SELECT ci.*, mi.image_url FROM cart_items ci LEFT JOIN menu_items mi ON ci.product_id = mi.id WHERE ci.cart_session_id = ? ORDER BY ci.created_at').all(cartId);
      ecoDb.close();
      var subtotal = items.reduce(function(s, i) { return s + (Number(i.price) * Number(i.qty)); }, 0);
      return json(res, 200, { ok: true, items: items, subtotal: subtotal });
    })();
  }

  // ============ REMOVE ITEM FROM CART ============
  if (urlPath.match(/^\/api\/supershop\/cart\/[^/]+\/item\/[^/]+$/) && req.method === 'DELETE') {
    var parts = urlPath.split('/');
    var cartId = parts[4];
    var itemId = parts[6];
    var ecoDb = ecoDbLib.getDb();
    ecoDb.prepare('DELETE FROM cart_items WHERE id = ? AND cart_session_id = ?').run(itemId, cartId);
    var items = ecoDb.prepare('SELECT ci.*, mi.image_url FROM cart_items ci LEFT JOIN menu_items mi ON ci.product_id = mi.id WHERE ci.cart_session_id = ? ORDER BY ci.created_at').all(cartId);
    ecoDb.close();
    var subtotal = items.reduce(function(s, i) { return s + (Number(i.price) * Number(i.qty)); }, 0);
    return json(res, 200, { ok: true, items: items, subtotal: subtotal });
  }

  // ============ CUSTOMER CHECKOUT REQUEST ============
  if (urlPath.match(/^\/api\/supershop\/cart\/[^/]+\/checkout$/) && req.method === 'POST') {
    return (async function() {
      var cartId = urlPath.split('/')[4];
      var body = await parseBody(req);
      var phone = String(body.phone || '').trim();
      var email = String(body.email || '').trim();

      var ecoDb = ecoDbLib.getDb();
      var session = ecoDb.prepare('SELECT * FROM cart_sessions WHERE id = ?').get(cartId);
      if (!session) { ecoDb.close(); return json(res, 404, { ok: false, error: 'Cart not found' }); }
      if (session.status !== 'active') { ecoDb.close(); return json(res, 400, { ok: false, error: 'Cart already ' + session.status }); }

      var items = ecoDb.prepare('SELECT * FROM cart_items WHERE cart_session_id = ?').all(cartId);
      if (items.length === 0) { ecoDb.close(); return json(res, 400, { ok: false, error: 'Cart is empty' }); }

      var subtotal = items.reduce(function(s, i) { return s + (Number(i.price_at_scan) * Number(i.qty)); }, 0);
       ecoDb.prepare('UPDATE cart_sessions SET status = \'pending_checkout\', closed_at = ?, customer_phone = COALESCE(NULLIF(?, \'\'), customer_phone), customer_email = COALESCE(NULLIF(?, \'\'), customer_email) WHERE id = ?')
         .run(now(), phone, email, cartId);

      ecoDb.close();
      sseBroadcast(session.store_id, 'cart', { id: cartId, status: 'pending_checkout', subtotal: subtotal, itemCount: items.length });
      return json(res, 200, { ok: true, status: 'pending_checkout', subtotal: subtotal, itemCount: items.length });
    })();
  }

  // ============ ACTIVE SESSIONS (owner dashboard) ============
  if (urlPath.match(/^\/api\/supershop\/sessions\/[^/]+$/) && req.method === 'GET') {
    if (!user) return json(res, 401, { error: 'Unauthorized' });
    var storeId = urlPath.split('/').pop();
    var ecoDb = ecoDbLib.getDb();
    var sessions = ecoDb.prepare('SELECT * FROM cart_sessions WHERE store_id = ? AND status IN (\'active\', \'pending_checkout\') ORDER BY last_scan_at DESC').all(storeId);
    var result = sessions.map(function(s) {
      var items = ecoDb.prepare('SELECT ci.*, mi.image_url FROM cart_items ci LEFT JOIN menu_items mi ON ci.product_id = mi.id WHERE ci.cart_session_id = ?').all(s.id);
      var subtotal = items.reduce(function(sum, i) { return sum + (Number(i.price) * Number(i.qty)); }, 0);
      return { session: s, items: items, subtotal: subtotal, itemCount: items.reduce(function(sum, i) { return sum + Number(i.qty); }, 0) };
    });
    ecoDb.close();
    return json(res, 200, { ok: true, sessions: result });
  }

  // ============ STAFF CONFIRM CHECKOUT ============
  if (urlPath.match(/^\/api\/supershop\/confirm\/[^/]+$/) && req.method === 'POST') {
    if (!user) return json(res, 401, { error: 'Unauthorized' });
    return (async function() {
      var cartId = urlPath.split('/').pop();
      var body = await parseBody(req);
      var paymentMethod = String(body.paymentMethod || 'cash');
      var discount = Number(body.discount) || 0;
      var taxRate = Number(body.taxRate) || 0;
      var note = String(body.note || '').trim();

      var ecoDb = ecoDbLib.getDb();
      var session = ecoDb.prepare('SELECT * FROM cart_sessions WHERE id = ?').get(cartId);
      if (!session) { ecoDb.close(); return json(res, 404, { ok: false, error: 'Cart not found' }); }
      if (session.status !== 'pending_checkout') { ecoDb.close(); return json(res, 400, { ok: false, error: 'Cart not in pending_checkout status' }); }

      var items = ecoDb.prepare('SELECT * FROM cart_items WHERE cart_session_id = ?').all(cartId);
      if (items.length === 0) { ecoDb.close(); return json(res, 400, { ok: false, error: 'Cart is empty' }); }

      // Server-side price/stock validation
      var subtotal = 0;
      for (var i = 0; i < items.length; i++) {
        var ci = items[i];
        var product = ecoDb.prepare('SELECT id, price, stock_qty, name FROM menu_items WHERE id = ?').get(ci.product_id);
        if (!product) {
          try {
            var globalDb = ecoDbLib.getDb();
            product = globalDb.prepare('SELECT id, price, stock_qty, name FROM menu_items WHERE id = ?').get(ci.product_id);
            globalDb.close();
          } catch(e) {}
        }
        if (!product) { ecoDb.close(); return json(res, 400, { ok: false, error: 'Product not found: ' + ci.name }); }
        var lineTotal = Number(product.price) * Number(ci.qty);
        subtotal += lineTotal;
        // Decrement stock
        if (product.stock_qty >= 0) {
          var newStock = product.stock_qty - Number(ci.qty);
          if (newStock < 0) { ecoDb.close(); return json(res, 409, { ok: false, error: 'Insufficient stock for: ' + product.name }); }
          // Try per-user DB first, then global
          try { ecoDb.prepare('UPDATE menu_items SET stock_qty = ? WHERE id = ?').run(newStock, product.id); }
          catch(e) {
            try {
              var gDb = ecoDbLib.getDb();
              gDb.prepare('UPDATE menu_items SET stock_qty = ? WHERE id = ?').run(newStock, product.id);
              gDb.close();
            } catch(e2) {}
          }
        }
      }

      var taxable = Math.max(0, subtotal - discount);
      var tax = taxable * taxRate / 100;
      var total = taxable + tax;

      // Create POS order
      var orderId = genId('ord');
      var invoiceNo = 'SS-' + String(Date.now()).slice(-8);
      ecoDb.prepare('INSERT INTO store_orders (id, store_id, customer_name, customer_phone, customer_email, order_type, status, subtotal, tax, discount, total, note, payment_method, payment_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, \'supershop\', \'completed\', ?, ?, ?, ?, ?, ?, \'paid\', ?, ?)')
        .run(orderId, session.store_id, '', session.customer_phone, session.customer_email, subtotal, tax, discount, total, note, paymentMethod, now(), now());
      items.forEach(function(ci) {
        ecoDb.prepare('INSERT INTO order_items (id, order_id, menu_item_id, name, price, qty, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(genId('oi'), orderId, ci.product_id, ci.name, ci.price_at_scan, ci.qty, '');
      });

      // Update cart session
      ecoDb.prepare('UPDATE cart_sessions SET status = \'completed\', closed_at = ? WHERE id = ?').run(now(), cartId);

      // Update customer spend
      if (session.customer_phone || session.customer_email) {
        try {
          var cust = null;
          if (session.customer_phone) cust = ecoDb.prepare('SELECT id FROM supershop_customers WHERE store_id = ? AND phone = ?').get(session.store_id, session.customer_phone);
          if (!cust && session.customer_email) cust = ecoDb.prepare('SELECT id FROM supershop_customers WHERE store_id = ? AND email = ?').get(session.store_id, session.customer_email);
          if (cust) {
            ecoDb.prepare('UPDATE supershop_customers SET total_spend = total_spend + ?, last_seen_at = ? WHERE id = ?').run(total, now(), cust.id);
          }
        } catch(e) {}
      }

       ecoDb.close();
      sseBroadcast(session.store_id, 'cart', { id: cartId, status: 'completed', orderId: orderId, invoiceNo: invoiceNo, total: total });
      return json(res, 200, { ok: true, orderId: orderId, invoiceNo: invoiceNo, total: total });
    })();
  }

  // ============ FLAG SESSION (abandonment / security) ============
  if (urlPath.match(/^\/api\/supershop\/flag\/[^/]+$/) && req.method === 'POST') {
    if (!user) return json(res, 401, { error: 'Unauthorized' });
    return (async function() {
      var cartId = urlPath.split('/').pop();
      var body = await parseBody(req);
      var reason = String(body.reason || 'abandoned');
      var ecoDb = ecoDbLib.getDb();
      var session = ecoDb.prepare('SELECT * FROM cart_sessions WHERE id = ?').get(cartId);
      if (!session) { ecoDb.close(); return json(res, 404, { ok: false, error: 'Cart not found' }); }
      var flagId = genId('flag');
      ecoDb.prepare('INSERT INTO security_flags (id, store_id, cart_session_id, reason, flagged_at, status) VALUES (?, ?, ?, ?, ?, \'open\')')
        .run(flagId, session.store_id, cartId, reason, now());
       ecoDb.prepare('UPDATE cart_sessions SET status = \'abandoned\' WHERE id = ? AND status = \'active\'').run(cartId);
      ecoDb.close();
      sseBroadcast(session.store_id, 'flag', { cartId: cartId, reason: reason, flagId: flagId });
      return json(res, 200, { ok: true, flagId: flagId });
    })();
  }

  // ============ GET SECURITY FLAGS ============
  if (urlPath.match(/^\/api\/supershop\/flags\/[^/]+$/) && req.method === 'GET') {
    if (!user) return json(res, 401, { error: 'Unauthorized' });
    var storeId = urlPath.split('/').pop();
    var ecoDb = ecoDbLib.getDb();
    var flags = ecoDb.prepare('SELECT sf.*, cs.customer_phone, cs.customer_email, cs.created_at as session_created FROM security_flags sf LEFT JOIN cart_sessions cs ON sf.cart_session_id = cs.id WHERE sf.store_id = ? ORDER BY sf.flagged_at DESC').all(storeId);
    ecoDb.close();
    return json(res, 200, { ok: true, flags: flags });
  }

  // ============ RESOLVE FLAG ============
  if (urlPath.match(/^\/api\/supershop\/resolve\/[^/]+$/) && req.method === 'POST') {
    if (!user) return json(res, 401, { error: 'Unauthorized' });
    return (async function() {
      var flagId = urlPath.split('/').pop();
       var ecoDb = ecoDbLib.getDb();
       var flag = ecoDb.prepare('SELECT store_id FROM security_flags WHERE id = ?').get(flagId);
       ecoDb.prepare('UPDATE security_flags SET status = \'resolved\', resolved_by = ?, resolved_at = ? WHERE id = ?')
         .run(user.email || user.id, now(), flagId);
       ecoDb.close();
       if (flag) sseBroadcast(flag.store_id, 'resolve', { flagId: flagId });
      return json(res, 200, { ok: true });
    })();
  }

  // ============ CRM LEADS ============
  if (urlPath.match(/^\/api\/supershop\/leads\/[^/]+$/) && req.method === 'GET') {
    if (!user) return json(res, 401, { error: 'Unauthorized' });
    var storeId = urlPath.split('/').pop();
    var ecoDb = ecoDbLib.getDb();
    var leads = ecoDb.prepare('SELECT * FROM supershop_customers WHERE store_id = ? ORDER BY last_seen_at DESC').all(storeId);
    ecoDb.close();
    return json(res, 200, { ok: true, leads: leads });
  }

  // ============ COMPLETED ORDERS / RECEIPTS ============
  if (urlPath.match(/^\/api\/supershop\/orders\/[^/]+$/) && req.method === 'GET') {
    if (!user) return json(res, 401, { error: 'Unauthorized' });
    var storeId = urlPath.split('/').pop();
    var ecoDb = ecoDbLib.getDb();
    var orders = ecoDb.prepare('SELECT * FROM store_orders WHERE store_id = ? AND order_type = ? ORDER BY created_at DESC LIMIT 100').all(storeId, 'supershop');
    var result = orders.map(function(o) {
      var items = ecoDb.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
      return { order: o, items: items };
    });
    ecoDb.close();
    return json(res, 200, { ok: true, orders: result });
  }

  // ============ LOW STOCK PRODUCTS ============
  if (urlPath.match(/^\/api\/supershop\/lowstock\/[^/]+$/) && req.method === 'GET') {
    if (!user) return json(res, 401, { error: 'Unauthorized' });
    var storeId2 = urlPath.split('/').pop();
    var ecoDb2 = ecoDbLib.getDb();
    var low = ecoDb2.prepare('SELECT id, name, barcode, stock_qty FROM menu_items WHERE store_id = ? AND stock_qty >= 0 AND stock_qty <= 5 ORDER BY stock_qty ASC').all(storeId2);
    ecoDb2.close();
    return json(res, 200, { ok: true, products: low });
  }

  // ============ PRODUCT / INVENTORY CRUD ============
  if (urlPath === '/api/supershop/product' && req.method === 'POST') {
    if (!user) return json(res, 401, { error: 'Unauthorized' });
    return (async function() {
      var body = await parseBody(req);
      var storeId = String(body.storeId || '').trim();
      if (!storeId) return json(res, 400, { ok: false, error: 'storeId required' });
      if (!body.name || body.price === undefined) return json(res, 400, { ok: false, error: 'name and price required' });
      var ecoDb = ecoDbLib.getDb();
      var itemId = genId('item');
      var regularPrice = (body.regular_price === undefined || body.regular_price === null || body.regular_price === '') ? -1 : Number(body.regular_price);
      ecoDb.prepare('INSERT INTO menu_items (id, store_id, name, description, price, image_url, barcode, stock_qty, is_available, is_visible_to_customers, regular_price, shelf_location, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(itemId, storeId, body.name, body.description || '', body.price, body.image_url || '', body.barcode || '', body.stock_qty === undefined ? -1 : Number(body.stock_qty), body.is_available !== undefined ? (body.is_available ? 1 : 0) : 1, body.is_visible_to_customers !== undefined ? (body.is_visible_to_customers ? 1 : 0) : 1, regularPrice, body.shelf_location || '', 0);
      ecoDb.close();
      return json(res, 201, { ok: true, id: itemId });
    })();
  }

  if (urlPath.match(/^\/api\/supershop\/product\/[^/]+$/) && req.method === 'PUT') {
    if (!user) return json(res, 401, { error: 'Unauthorized' });
    return (async function() {
      var productId = urlPath.split('/').pop();
      var body = await parseBody(req);
      var ecoDb = ecoDbLib.getDb();
      var existing = ecoDb.prepare('SELECT * FROM menu_items WHERE id = ?').get(productId);
      if (!existing) { ecoDb.close(); return json(res, 404, { ok: false, error: 'Product not found' }); }
      var fields = [];
      var vals = [];
      function set(col, v) { fields.push(col + ' = ?'); vals.push(v); }
      if (body.name !== undefined) set('name', body.name);
      if (body.description !== undefined) set('description', body.description);
      if (body.price !== undefined) set('price', body.price);
      if (body.image_url !== undefined) set('image_url', body.image_url);
       if (body.barcode !== undefined) set('barcode', String(body.barcode || ''));
       if (body.regular_price !== undefined) set('regular_price', (body.regular_price === '' || body.regular_price === null) ? -1 : Number(body.regular_price));
       if (body.shelf_location !== undefined) set('shelf_location', String(body.shelf_location || ''));
       if (body.stock_qty !== undefined) set('stock_qty', Number(body.stock_qty));
      if (body.is_available !== undefined) set('is_available', body.is_available ? 1 : 0);
      if (body.is_visible_to_customers !== undefined) set('is_visible_to_customers', body.is_visible_to_customers ? 1 : 0);
      if (fields.length) {
        vals.push(productId);
        var updStmt = ecoDb.prepare('UPDATE menu_items SET ' + fields.join(', ') + ' WHERE id = ?');
        updStmt.run.apply(updStmt, vals);
      }
      ecoDb.close();
      return json(res, 200, { ok: true });
    })();
  }

  if (urlPath.match(/^\/api\/supershop\/product\/[^/]+$/) && req.method === 'DELETE') {
    if (!user) return json(res, 401, { error: 'Unauthorized' });
    var productId = urlPath.split('/').pop();
    var ecoDbP = ecoDbLib.getDb();
    ecoDbP.prepare('DELETE FROM menu_items WHERE id = ?').run(productId);
    ecoDbP.close();
    return json(res, 200, { ok: true });
  }

  // ============ PER-CART CHECKOUT QR (customer shows at exit) ============
  if (urlPath.match(/^\/api\/supershop\/cart\/[^/]+\/qr$/) && req.method === 'GET') {
    return (async function() {
      var cartIdQr = urlPath.split('/')[4];
      var ecoDbQ = ecoDbLib.getDb();
      var sessQ = ecoDbQ.prepare('SELECT * FROM cart_sessions WHERE id = ?').get(cartIdQr);
      ecoDbQ.close();
      if (!sessQ) return json(res, 404, { ok: false, error: 'Cart not found' });
      var host = (req.headers['x-forwarded-proto'] || 'http') + '://' + (req.headers.host || 'localhost:3000');
      var link = host + '/supershop-dashboard?store=' + encodeURIComponent(sessQ.store_id) + '&cart=' + encodeURIComponent(cartIdQr);
      var qr = QRCode ? await QRCode.toDataURL(link, { width: 360, margin: 1 }) : '';
      return json(res, 200, { ok: true, link: link, qr: qr });
    })();
  }

  return false; // not handled by this module
}

module.exports = { handleRoutes: handleRoutes };
