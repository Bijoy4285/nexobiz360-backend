const { createId } = require("../lib/db");

const MAX_EVENTS = 500;
const MAX_LOGS = 500;

function limitText(value, max) {
  return String(value == null ? "" : value).slice(0, max);
}

function limitObject(value) {
  try {
    if (typeof value === "string") return value.slice(0, 2000);
    if (!value || typeof value !== "object") return {};
    return JSON.stringify(value).length > 2000 ? {} : value;
  } catch (error) {
    return {};
  }
}

function recordSystemLog(db, payload) {
  const entry = Object.assign({
    id: createId("log"),
    level: "error",
    serviceName: "frontend",
    createdAt: new Date().toISOString()
  }, payload);
  entry.message = limitText(entry.message, 1000);
  entry.details = limitObject(entry.details);
  db.system_logs.unshift(entry);
  if (db.system_logs.length > MAX_LOGS) db.system_logs.length = MAX_LOGS;
  return entry;
}

function recordMonitoringEvent(db, payload) {
  const entry = Object.assign({
    id: createId("event"),
    type: "generic",
    issueType: "technical",
    severity: "low",
    source: "app",
    status: "open",
    customerId: "",
    orderId: "",
    message: "",
    metadata: {},
    createdAt: new Date().toISOString()
  }, payload);
  entry.message = limitText(entry.message, 1000);
  entry.metadata = limitObject(entry.metadata);
  db.monitoring_events.unshift(entry);
  if (db.monitoring_events.length > MAX_EVENTS) db.monitoring_events.length = MAX_EVENTS;
  return entry;
}

function getMonitoringStatus(db, userId) {
  const ownOnly = userId !== undefined && userId !== null;
  const allOpenEvents = db.monitoring_events.filter(item => item.status !== "resolved");
  const openEvents = ownOnly ? allOpenEvents.filter(item => item.userId === userId) : allOpenEvents;
  const openIncidents = ownOnly ? [] : db.incidents.filter(item => item.status !== "resolved");
  const openEscalations = ownOnly ? [] : db.escalation_queue.filter(item => item.status !== "resolved");
  return {
    openEvents: openEvents.length,
    openIncidents: openIncidents.length,
    openEscalations: openEscalations.length,
    lastEventAt: openEvents[0] ? openEvents[0].createdAt : null,
    services: db.services,
    recentEvents: openEvents.slice(0, 20)
  };
}

module.exports = { recordSystemLog, recordMonitoringEvent, getMonitoringStatus };
