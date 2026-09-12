const { SYSTEM_PROMPT } = require("../ai/prompts");
const { createId } = require("../lib/db");
const { classifyIssueType, detectPriority, detectSentiment, createTicket, addTicketMessage, summarizeTicket } = require("./ticketing");
const { detectRootCause, readErrorLogs, createIncidentReport } = require("./debugging");
const { sendOwnerAlert } = require("./alerts");
const { logAiAction, retryFailedJob, restartSafeService } = require("./tool-handlers");
const { generateAssessment } = require("./ai-provider");

function confidenceFor(event, issueType) {
  if (String(event.severity).toLowerCase() === "high") return 0.52;
  if (issueType === "stock") return 0.92;
  if (issueType === "complaint") return 0.76;
  if (issueType === "payment") return 0.66;
  return 0.84;
}

function safeAutoAction(db, event, issueType) {
  if (issueType === "stock") {
    return { tool: "send_owner_alert", result: sendOwnerAlert(db, "Low stock alert: " + event.message, { eventId: event.id }) };
  }
  if (issueType === "technical") {
    const worker = db.services.find(item => item.name === "worker" && item.safeRestart);
    if (worker) return { tool: "restart_safe_service", result: restartSafeService(db, "worker") };
  }
  if (issueType === "payment") {
    const failedJob = db.jobs.find(item => item.status === "failed");
    if (failedJob) return { tool: "retry_failed_job", result: retryFailedJob(db, failedJob.id) };
  }
  return null;
}

function createEscalation(db, event, ticket, reason, confidence) {
  const entry = {
    id: createId("escalation"),
    eventId: event.id,
    ticketId: ticket ? ticket.id : "",
    reason,
    confidence,
    status: "open",
    createdAt: new Date().toISOString()
  };
  db.escalation_queue.unshift(entry);
  return entry;
}

function runAgentCycle(db) {
  const threshold = Number(process.env.AI_SAFE_CONFIDENCE_THRESHOLD || 0.72);
  const pending = db.monitoring_events.filter(item => item.status === "open");
  const outputs = [];

  pending.forEach(event => {
    const issueType = classifyIssueType(event);
    const sentiment = detectSentiment(event.message);
    const priority = detectPriority(event, sentiment);
    const assessment = generateAssessment(event);
    const confidence = Number(assessment.confidence || confidenceFor(event, issueType));
    const logs = readErrorLogs(db, event.source);
    const ticket = createTicket(db, {
      title: issueType.toUpperCase() + ": " + event.message.slice(0, 80),
      category: issueType,
      priority,
      sentiment,
      customerId: event.customerId,
      issueType,
      confidence,
      summary: assessment.summary,
      message: event.message,
      source: "ai_monitor"
    });

    addTicketMessage(db, ticket.id, "ai_agent", "Initial agent response: we detected the issue and started investigation.");
    summarizeTicket(db, ticket.id);

    const incident = createIncidentReport(db, {
      title: "Incident: " + event.message.slice(0, 80),
      issueType,
      severity: event.severity,
      ticketId: ticket.id,
      eventId: event.id,
      rootCause: detectRootCause(event, logs),
      suggestedFix: issueType === "payment" ? "Retry failed payment worker job and validate webhook delivery." : issueType === "stock" ? "Notify owner and restock affected SKU." : "Inspect logs and restart only safe worker services if needed.",
      summary: "Created by agent using prompt: " + SYSTEM_PROMPT.slice(0, 48) + "... Provider: " + assessment.provider
    });

    let autoAction = null;
    let escalation = null;
    if (confidence >= threshold && String(event.severity).toLowerCase() !== "high") {
      autoAction = safeAutoAction(db, event, issueType);
      if (autoAction) {
        logAiAction(db, {
          eventId: event.id,
          ticketId: ticket.id,
          incidentId: incident.id,
          actionType: "auto_fix",
          toolUsed: autoAction.tool,
          reason: "Low-risk issue with safe confidence above threshold.",
          result: autoAction.result ? "success" : "no_action",
          confidence
        });
        event.status = "auto_fixed";
      } else {
        event.status = "observed";
      }
    } else {
      escalation = createEscalation(db, event, ticket, "High-risk issue or low confidence. Human review required.", confidence);
      sendOwnerAlert(db, "Escalation required: " + event.message, { eventId: event.id, ticketId: ticket.id, incidentId: incident.id });
      logAiAction(db, {
        eventId: event.id,
        ticketId: ticket.id,
        incidentId: incident.id,
        escalationId: escalation.id,
        actionType: "escalation",
        toolUsed: "send_owner_alert",
        reason: "High-risk or below safe confidence threshold.",
        result: "queued",
        confidence
      });
      event.status = "escalated";
    }

    outputs.push({ event, ticket, incident, autoAction, escalation, confidence });
  });

  return outputs;
}

module.exports = { runAgentCycle };
