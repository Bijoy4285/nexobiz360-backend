const https = require("https");
const http = require("http");
let nodemailer = null;
try { nodemailer = require("nodemailer"); } catch (e) {
  console.error("[notifications] nodemailer unavailable (" + (e && e.message) + "). Email features disabled but app keeps running.");
}

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || "";
const NOTIFICATION_PROVIDER = process.env.NOTIFICATION_PROVIDER || "in_app";

// Gmail SMTP (App Password)
const GMAIL_USER = process.env.GMAIL_USER || process.env.GMAIL_EMAIL || "";
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || "";
const GMAIL_FROM = process.env.GMAIL_FROM || GMAIL_USER || "";
const isGmailConfigured = () => Boolean(GMAIL_USER && GMAIL_APP_PASSWORD);

async function sendGmail(to, subject, htmlBody) {
  if (!nodemailer) return { ok: false, provider: "gmail", error: "nodemailer not installed on this server" };
  let transporter;
  try {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
    });
  } catch (e) {
    return { ok: false, provider: "gmail", error: e.message };
  }
  try {
    const info = await transporter.sendMail({
      from: GMAIL_FROM ? (GMAIL_FROM + "").includes("@") ? { name: (process.env.GMAIL_NAME || "Ocean SFT"), address: GMAIL_FROM } : { name: GMAIL_FROM, address: GMAIL_USER } : GMAIL_USER,
      to: to,
      subject: subject,
      html: htmlBody
    });
    return { ok: true, provider: "gmail", messageId: info.messageId };
  } catch (e) {
    return { ok: false, provider: "gmail", error: e.message };
  }
}

async function sendEmail(to, subject, htmlBody) {
  if (NOTIFICATION_PROVIDER === "in_app") {
    return { ok: false, provider: "in_app", reason: "Email provider not configured (set NOTIFICATION_PROVIDER=gmail or sendgrid)" };
  }
  // Prefer Gmail App Password when configured
  if (isGmailConfigured()) {
    return sendGmail(to, subject, htmlBody);
  }
  if (!SENDGRID_API_KEY) {
    return { ok: false, provider: "in_app", reason: "SendGrid not configured" };
  }
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: process.env.FROM_EMAIL || "noreply@oceansft.com", name: "Ocean SFT" },
      subject,
      content: [{ type: "text/html", value: htmlBody }]
    });
    const req = https.request({
      hostname: "api.sendgrid.com",
      path: "/v3/mail/send",
      method: "POST",
      headers: {
        "Authorization": "Bearer " + SENDGRID_API_KEY,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode }));
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.write(payload);
    req.end();
  });
}

async function sendSMS(to, message) {
  if (!TWILIO_ACCOUNT_SID || NOTIFICATION_PROVIDER === "in_app") {
    return { ok: false, provider: "in_app", reason: "Twilio not configured" };
  }
  const auth = Buffer.from(TWILIO_ACCOUNT_SID + ":" + TWILIO_AUTH_TOKEN).toString("base64");
  const payload = "To=" + encodeURIComponent(to) + "&From=" + encodeURIComponent(TWILIO_PHONE_NUMBER) + "&Body=" + encodeURIComponent(message);
  return new Promise((resolve) => {
    const req = https.request({
      hostname: "api.twilio.com",
      path: "/2010-04-01/Accounts/" + TWILIO_ACCOUNT_SID + "/Messages.json",
      method: "POST",
      headers: {
        "Authorization": "Basic " + auth,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode }));
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.write(payload);
    req.end();
  });
}

function premium() {
  try { return require("./email-templates"); } catch(e) { return null; }
}

function notifyOrderUpdate(db, order, storeName, customerPhone, customerEmail) {
  const message = "Your order at " + storeName + " (#" + order.id.slice(-6).toUpperCase() + ") is now " + order.status + ".";
  const results = [];
  const t = premium();
  const emailBody = t ? t.notificationEmail("Order Update - " + storeName, message) : ("<p>" + message + "</p>");
  if (customerPhone) results.push({ channel: "sms", result: sendSMS(customerPhone, message) });
  if (customerEmail) results.push({ channel: "email", result: sendEmail(customerEmail, "Order Update - " + storeName, emailBody) });
  return results;
}

function notifyBookingUpdate(db, booking, storeName, customerPhone, customerEmail) {
  const message = "Your booking at " + storeName + " on " + booking.booking_date + " at " + booking.booking_time + " is now " + booking.status + ".";
  const results = [];
  const t = premium();
  const emailBody = t ? t.notificationEmail("Booking Update - " + storeName, message) : ("<p>" + message + "</p>");
  if (customerPhone) results.push({ channel: "sms", result: sendSMS(customerPhone, message) });
  if (customerEmail) results.push({ channel: "email", result: sendEmail(customerEmail, "Booking Update - " + storeName, emailBody) });
  return results;
}

function notifyLowStock(db, itemName, currentStock, storeName) {
  const message = "Low stock alert: " + itemName + " has only " + currentStock + " units left at " + storeName + ".";
  const adminEmail = process.env.ADMIN_EMAIL || "";
  const results = [];
  const t = premium();
  const emailBody = t ? t.notificationEmail("Low Stock - " + storeName, "<p>" + message + "</p>") : ("<p>" + message + "</p>");
  if (adminEmail) results.push({ channel: "email", result: sendEmail(adminEmail, "Low Stock - " + storeName, emailBody) });
  return results;
}

module.exports = { sendEmail, sendSMS, notifyOrderUpdate, notifyBookingUpdate, notifyLowStock, isGmailConfigured, sendGmail };
