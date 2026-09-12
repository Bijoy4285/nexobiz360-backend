const { createId } = require("../lib/db");

function recordSystemLog(db, payload) {
  const entry = Object.assign({
    id: createId("log"),
    level: "error",
    serviceName: "frontend",
    createdAt: new Date().toISOString()
  }, payload);
  db.system_logs.unshift(entry);
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
  db.monitoring_events.unshift(entry);
  return entry;
}

function getMonitoringStatus(db) {
  const openEvents = db.monitoring_events.filter(item => item.status !== "resolved");
  const openIncidents = db.incidents.filter(item => item.status !== "resolved");
  const openEscalations = db.escalation_queue.filter(item => item.status !== "resolved");
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
