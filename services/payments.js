const { createId } = require("../lib/db");

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

function isStripeConfigured() {
  return Boolean(STRIPE_SECRET_KEY);
}

async function createCheckoutSession(orderData) {
  if (!isStripeConfigured()) {
    return { ok: false, error: "Stripe not configured. Set STRIPE_SECRET_KEY in .env" };
  }
  const https = require("https");
  const payload = JSON.stringify({
    payment_method_types: ["card"],
    line_items: (orderData.items || []).map(item => ({
      price_data: {
        currency: orderData.currency || "usd",
        product_data: { name: item.name },
        unit_amount: Math.round((item.price || 0) * 100)
      },
      quantity: item.qty || 1
    })),
    mode: "payment",
    success_url: orderData.successUrl || (process.env.APP_URL || "https://oceansft.mamglobalcorporation.com") + "/dashboard.html?payment=success",
    cancel_url: orderData.cancelUrl || (process.env.APP_URL || "https://oceansft.mamglobalcorporation.com") + "/dashboard.html?payment=cancelled",
    metadata: { orderId: orderData.orderId || "", storeId: orderData.storeId || "" }
  });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: "api.stripe.com",
      path: "/v1/checkout/sessions",
      method: "POST",
      headers: {
        "Authorization": "Bearer " + STRIPE_SECRET_KEY,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          if (data.id) {
            resolve({ ok: true, sessionId: data.id, url: data.url });
          } else {
            resolve({ ok: false, error: data.error?.message || "Stripe error" });
          }
        } catch (e) {
          resolve({ ok: false, error: "Invalid response from Stripe" });
        }
      });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.write(payload);
    req.end();
  });
}

async function createPaymentIntent(amount, currency, metadata) {
  if (!isStripeConfigured()) {
    return { ok: false, error: "Stripe not configured" };
  }
  const https = require("https");
  const payload = JSON.stringify({
    amount: Math.round(amount * 100),
    currency: currency || "usd",
    metadata: metadata || {},
    automatic_payment_methods: { enabled: true }
  });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: "api.stripe.com",
      path: "/v1/payment_intents",
      method: "POST",
      headers: {
        "Authorization": "Bearer " + STRIPE_SECRET_KEY,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          if (data.id) {
            resolve({ ok: true, clientSecret: data.client_secret, id: data.id });
          } else {
            resolve({ ok: false, error: data.error?.message || "Stripe error" });
          }
        } catch (e) {
          resolve({ ok: false, error: "Invalid response" });
        }
      });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.write(payload);
    req.end();
  });
}

function recordPayment(db, paymentData) {
  const record = {
    id: createId("payment"),
    orderId: paymentData.orderId || "",
    storeId: paymentData.storeId || "",
    amount: Number(paymentData.amount || 0),
    currency: paymentData.currency || "usd",
    status: paymentData.status || "pending",
    stripeSessionId: paymentData.stripeSessionId || "",
    stripePaymentIntentId: paymentData.stripePaymentIntentId || "",
    customerEmail: paymentData.customerEmail || "",
    metadata: paymentData.metadata || {},
    createdAt: new Date().toISOString()
  };
  if (!db.payments) db.payments = [];
  db.payments.unshift(record);
  return record;
}

module.exports = { isStripeConfigured, createCheckoutSession, createPaymentIntent, recordPayment };
