const assert = require("assert");
const { baseSchema } = require("../lib/db");
const { runAgentCycle } = require("../services/ai-agent");

function createDb() {
  const db = baseSchema();
  db.monitoring_events = [
    {
      id: "event_test_1",
      type: "low_stock",
      issueType: "stock",
      severity: "medium",
      source: "pharmacy",
      status: "open",
      customerId: "",
      orderId: "",
      message: "Low stock detected for Napa",
      metadata: { stock: 3 },
      createdAt: new Date().toISOString()
    },
    {
      id: "event_test_2",
      type: "payment_failure",
      issueType: "payment",
      severity: "high",
      source: "payments",
      status: "open",
      customerId: "cust_1",
      orderId: "order_77",
      message: "Payment capture failed for order order_77",
      metadata: {},
      createdAt: new Date().toISOString()
    }
  ];
  return db;
}

const db = createDb();
const result = runAgentCycle(db);

assert.strictEqual(result.length, 2, "agent should process both events");
assert.ok(db.tickets.length >= 2, "tickets should be created");
assert.ok(db.incidents.length >= 2, "incidents should be created");
assert.ok(db.ai_actions.length >= 1, "ai actions should be logged");
assert.ok(db.alerts.length >= 1, "alerts should be created");
assert.ok(db.escalation_queue.length >= 1, "high risk issue should escalate");
assert.ok(db.monitoring_events.some(item => item.status === "auto_fixed" || item.status === "observed"), "low risk issue should be handled");

console.log("AI agent tests passed.");
