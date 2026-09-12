const { createId } = require("../lib/db");

function sendOwnerAlert(db, message, meta) {
  const alert = {
    id: createId("alert"),
    channel: process.env.ALERT_PROVIDER || "in_app",
    status: "queued",
    message,
    meta: meta || {},
    createdAt: new Date().toISOString()
  };
  db.alerts.unshift(alert);
  return alert;
}

module.exports = { sendOwnerAlert };
