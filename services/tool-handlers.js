const { createId } = require("../lib/db");
const { createTicket, updateTicketPriority, addTicketMessage, summarizeTicket } = require("./ticketing");
const { sendOwnerAlert } = require("./alerts");
const { readErrorLogs, createIncidentReport } = require("./debugging");

function logAiAction(db, payload) {
  const action = Object.assign({
    id: createId("ai_action"),
    createdAt: new Date().toISOString()
  }, payload);
  db.ai_actions.unshift(action);
  return action;
}

function getCustomerHistory(db, customerId) {
  const tickets = db.tickets.filter(item => item.customerId === customerId).slice(0, 10);
  const context = db.customer_context.find(item => item.customerId === customerId) || null;
  return { tickets, context };
}

function getOrderStatus(db, orderId) {
  const storage = Object.values(db.storage || {});
  let found = null;
  storage.some(entry => {
    try {
      const sales = JSON.parse(entry.ocean_pos_sales || "[]");
      found = sales.find(item => String(item.id) === String(orderId) || String(item.orderId) === String(orderId)) || null;
      return Boolean(found);
    } catch (error) {
      return false;
    }
  });
  return found;
}

function getPaymentLogs(db, orderId) {
  return db.system_logs.filter(log => log.serviceName === "payments" && String(log.orderId || "") === String(orderId)).slice(0, 20);
}

function retryFailedJob(db, jobId) {
  const job = db.jobs.find(item => item.id === jobId);
  if (!job) return null;
  job.status = "retried";
  job.retries = Number(job.retries || 0) + 1;
  job.updatedAt = new Date().toISOString();
  return job;
}

function restartSafeService(db, serviceName) {
  const service = db.services.find(item => item.name === serviceName);
  if (!service || !service.safeRestart) return null;
  service.status = "restarting";
  service.updatedAt = new Date().toISOString();
  return service;
}

function handleTool(db, toolName, args) {
  const safeArgs = args || {};
  switch (toolName) {
    case "get_customer_history":
      return getCustomerHistory(db, safeArgs.customerId);
    case "get_order_status":
      return getOrderStatus(db, safeArgs.orderId);
    case "get_payment_logs":
      return getPaymentLogs(db, safeArgs.orderId);
    case "create_ticket":
      return createTicket(db, safeArgs);
    case "update_ticket_priority":
      return updateTicketPriority(db, safeArgs.ticketId, safeArgs.priority);
    case "send_customer_reply":
      return addTicketMessage(db, safeArgs.ticketId, "ai_agent", safeArgs.message);
    case "read_error_logs":
      return readErrorLogs(db, safeArgs.serviceName);
    case "retry_failed_job":
      return retryFailedJob(db, safeArgs.jobId);
    case "restart_safe_service":
      return restartSafeService(db, safeArgs.serviceName);
    case "send_owner_alert":
      return sendOwnerAlert(db, safeArgs.message, safeArgs.meta);
    case "create_incident_report":
      return createIncidentReport(db, safeArgs);
    case "summarize_ticket":
      return summarizeTicket(db, safeArgs.ticketId);
    default:
      return null;
  }
}

module.exports = {
  handleTool,
  logAiAction,
  getCustomerHistory,
  getOrderStatus,
  getPaymentLogs,
  retryFailedJob,
  restartSafeService
};
