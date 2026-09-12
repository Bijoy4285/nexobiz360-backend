const { createId } = require("../lib/db");

function detectSentiment(text) {
  const value = String(text || "").toLowerCase();
  if (/(angry|refund|broken|worst|hate|fraud|late|delay|not working|failed)/.test(value)) return "negative";
  if (/(thanks|good|fixed|great|resolved)/.test(value)) return "positive";
  return "neutral";
}

function classifyIssueType(event) {
  const text = (event.issueType || event.type || event.message || "").toLowerCase();
  if (/payment|billing|invoice/.test(text)) return "payment";
  if (/stock|inventory|low_stock/.test(text)) return "stock";
  if (/order|delivery/.test(text)) return "order";
  if (/complaint|angry|delay/.test(text)) return "complaint";
  if (/db|api|error|technical|timeout|slow/.test(text)) return "technical";
  return "technical";
}

function detectPriority(event, sentiment) {
  const severity = String(event.severity || "").toLowerCase();
  const text = String(event.message || "").toLowerCase();
  if (severity === "high" || /payment failure|db failure|server|critical/.test(text)) return "critical";
  if (severity === "medium" || sentiment === "negative") return "high";
  return "normal";
}

function createTicket(db, data) {
  const ticket = {
    id: createId("ticket"),
    title: data.title || data.subject || "New issue",
    category: data.category || "technical",
    priority: data.priority || "normal",
    sentiment: data.sentiment || "neutral",
    status: data.status || "open",
    source: data.source || "system",
    customerId: data.customerId || "",
    issueType: data.issueType || data.category || "technical",
    confidence: Number(data.confidence || 0),
    summary: data.summary || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.tickets.unshift(ticket);
  if (data.message) {
    db.ticket_messages.unshift({
      id: createId("ticket_msg"),
      ticketId: ticket.id,
      sender: data.sender || "system",
      message: data.message,
      createdAt: new Date().toISOString()
    });
  }
  return ticket;
}

function addTicketMessage(db, ticketId, sender, message) {
  const entry = {
    id: createId("ticket_msg"),
    ticketId,
    sender,
    message,
    createdAt: new Date().toISOString()
  };
  db.ticket_messages.unshift(entry);
  const ticket = db.tickets.find(item => item.id === ticketId);
  if (ticket) ticket.updatedAt = new Date().toISOString();
  return entry;
}

function summarizeTicket(db, ticketId) {
  const ticket = db.tickets.find(item => item.id === ticketId);
  const messages = db.ticket_messages.filter(item => item.ticketId === ticketId);
  if (!ticket) return null;
  ticket.summary = messages.slice(0, 5).map(item => item.sender + ": " + item.message).join(" | ");
  ticket.updatedAt = new Date().toISOString();
  return ticket.summary;
}

function updateTicketPriority(db, ticketId, priority) {
  const ticket = db.tickets.find(item => item.id === ticketId);
  if (!ticket) return null;
  ticket.priority = priority;
  ticket.updatedAt = new Date().toISOString();
  return ticket;
}

module.exports = {
  detectSentiment,
  classifyIssueType,
  detectPriority,
  createTicket,
  addTicketMessage,
  summarizeTicket,
  updateTicketPriority
};
