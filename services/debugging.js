const { createId } = require("../lib/db");

function readErrorLogs(db, serviceName) {
  return db.system_logs.filter(log => !serviceName || log.serviceName === serviceName).slice(0, 50);
}

function detectRootCause(event, relatedLogs) {
  const message = String(event.message || "").toLowerCase();
  if (/payment/.test(message)) return "Downstream payment provider or webhook retry issue.";
  if (/db|query|database/.test(message)) return "Database query or connection failure.";
  if (/timeout|slow|latency/.test(message)) return "Performance bottleneck or overloaded worker.";
  if (relatedLogs.length) return "Repeated application errors detected in system logs.";
  return "General application failure requiring investigation.";
}

function createIncidentReport(db, data) {
  const incident = {
    id: createId("incident"),
    title: data.title || "Incident report",
    issueType: data.issueType || "technical",
    severity: data.severity || "medium",
    status: data.status || "open",
    rootCause: data.rootCause || "",
    suggestedFix: data.suggestedFix || "",
    eventId: data.eventId || "",
    ticketId: data.ticketId || "",
    summary: data.summary || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.incidents.unshift(incident);
  return incident;
}

module.exports = { readErrorLogs, detectRootCause, createIncidentReport };
