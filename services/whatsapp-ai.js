const { createId } = require("../lib/db");

const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || "https://graph.facebook.com/v18.0";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "";
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";

function isWhatsAppConfigured() {
  return Boolean(WHATSAPP_TOKEN && WHATSAPP_PHONE_NUMBER_ID);
}

async function sendWhatsAppMessage(to, message) {
  if (!isWhatsAppConfigured()) {
    return { ok: false, error: "WhatsApp Business API not configured" };
  }
  const https = require("https");
  const payload = JSON.stringify({
    messaging_product: "whatsapp",
    to: to,
    type: "text",
    text: { body: message }
  });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: "graph.facebook.com",
      path: "/v18.0/" + WHATSAPP_PHONE_NUMBER_ID + "/messages",
      method: "POST",
      headers: {
        "Authorization": "Bearer " + WHATSAPP_TOKEN,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, data });
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

async function sendTemplateMessage(to, templateName, languageCode, components) {
  if (!isWhatsAppConfigured()) {
    return { ok: false, error: "WhatsApp Business API not configured" };
  }
  const https = require("https");
  const payload = JSON.stringify({
    messaging_product: "whatsapp",
    to: to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode || "en" },
      components: components || []
    }
  });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: "graph.facebook.com",
      path: "/v18.0/" + WHATSAPP_PHONE_NUMBER_ID + "/messages",
      method: "POST",
      headers: {
        "Authorization": "Bearer " + WHATSAPP_TOKEN,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, data });
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

function processIncomingMessage(db, message) {
  const from = message.from || "";
  const text = (message.text?.body || "").toLowerCase();
  const contactName = message.contacts?.[0]?.profile?.name || from;

  let reply = "";
  let action = null;

  if (text.match(/^(hi|hello|hey|salam|assalam)/)) {
    reply = "Welcome to Ocean SFT! I'm your AI assistant. How can I help you today?\n\nType:\n• *menu* - View products/services\n• *order* - Place an order\n• *book* - Make a booking\n• *status* - Check order status\n• *help* - Get help";
  } else if (text.includes("menu") || text.includes("product")) {
    const stores = db.prepare ? null : null;
    reply = "Here are our available services:\n\n🍽️ Restaurant - View menu & order\n🏨 Hotel - Book rooms\n💊 Pharmacy - Order medicines\n🛒 Store - Browse products\n\nReply with a service name to get started!";
  } else if (text.includes("order")) {
    reply = "To place an order, please visit our store at the link provided by the business, or reply with:\n\n*order [item name] [quantity]*\n\nExample: order pizza 2";
    action = { type: "create_order", from, contactName };
  } else if (text.includes("book")) {
    reply = "To make a booking, please reply with:\n\n*book [date] [time] [name]*\n\nExample: book tomorrow 3pm Ahmed";
    action = { type: "create_booking", from, contactName };
  } else if (text.includes("status")) {
    reply = "To check your order status, please provide your order ID (e.g., ORD-123456).";
    action = { type: "check_status", from };
  } else if (text.includes("help")) {
    reply = "I can help you with:\n\n• *menu* - View products\n• *order* - Place an order\n• *book* - Make a booking\n• *status* - Check order status\n• *contact* - Get contact info\n• *hours* - Business hours\n\nJust type any of these keywords!";
  } else if (text.includes("contact") || text.includes("phone")) {
    reply = "You can reach us at the phone number provided in the store profile, or reply *call* and we'll have someone contact you.";
  } else if (text.includes("hours") || text.includes("open")) {
    reply = "Our business hours are listed on our store page. Reply *hours* for more details, or visit our website.";
  } else {
    reply = "I received your message: \"" + message.text?.body + "\"\n\nI can help with: *menu*, *order*, *book*, *status*, *help*\n\nOr type *help* for all options.";
  }

  return { reply, action, contactName, from };
}

function processWebhookPayload(db, body) {
  if (body.object !== "whatsapp_business_account") return null;
  const entries = body.entry || [];
  const results = [];
  entries.forEach(entry => {
    const changes = entry.changes || [];
    changes.forEach(change => {
      if (change.field === "messages") {
        const value = change.value || {};
        const messages = value.messages || [];
        messages.forEach(msg => {
          const result = processIncomingMessage(db, msg);
          results.push(result);
        });
      }
    });
  });
  return results;
}

async function broadcastMessage(db, storeId, recipients, message, templateName) {
  const results = [];
  for (const recipient of recipients) {
    let result;
    if (templateName) {
      result = await sendTemplateMessage(recipient, templateName, "en");
    } else {
      result = await sendWhatsAppMessage(recipient, message);
    }
    results.push({ recipient, ...result });
    if (!db.whatsapp_broadcast_log) db.whatsapp_broadcast_log = [];
    db.whatsapp_broadcast_log.push({
      id: createId("wabcast"),
      storeId,
      recipient,
      status: result.ok ? "sent" : "failed",
      error: result.error || "",
      createdAt: new Date().toISOString()
    });
  }
  return results;
}

module.exports = {
  isWhatsAppConfigured,
  sendWhatsAppMessage,
  sendTemplateMessage,
  processIncomingMessage,
  processWebhookPayload,
  broadcastMessage
};
