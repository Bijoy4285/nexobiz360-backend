const { SYSTEM_PROMPT } = require("../ai/prompts");
const https = require("https");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const AI_PROVIDER = process.env.AI_PROVIDER || "heuristic";

// M.A.M Commander AI — our own full-brain endpoint
const COMMANDER_API_KEY = process.env.COMMANDER_API_KEY || "";
const COMMANDER_URL = process.env.COMMANDER_URL || "https://bisoxai.mamglobalcorporation.com/api/v1/hardcore/commander/chat";
const isCommanderConfigured = () => Boolean(COMMANDER_API_KEY && /hc_/.test(COMMANDER_API_KEY));

// Strip the Commander brain's memory/context dump so users only ever see a clean answer.
function cleanCommanderReply(reply) {
  let r = String(reply || "").trim();
  if (!r) return "";
  r = r
    .replace(/\[RECENT CONVERSATION\][\s\S]*?\[\/RECENT CONVERSATION\]/gi, " ")
    .replace(/\*\*RELEVANT MEMORIES[\s\S]*/gi, " ")
    .replace(/KNOWN FACTS ABOUT USER[\s\S]*/gi, " ")
    .replace(/\[personal\]\s*You are the/gi, " ")
    .replace(/Based on my general knowledge/gi, " ")
    .replace(/\*\*\[?[/]?RECENT CONVERSATION\]?/gi, " ")
    .replace(/(Here'?s a|Here is) (detailed )[Bb]reakdown:?\s*/gi, "")
    .replace(/(Executive [Ss]ummary|Answer:?|Summary:?)\s*/gi, "")
    .replace(/[*_`>]/g, " ")
    .replace(/[ \t][ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (/RELEVANT MEMORIES|RECENT CONVERSATION|KNOWN FACTS|You are the|detailed breakdown|Based on my general knowledge/.test(r)) return "";
  return r;
}

function callCommander(message, history, contextText) {
  return new Promise((resolve) => {
    const messages = (Array.isArray(history) ? history : []).map(function(h) {
      return { role: h.role || "user", content: h.content || h.message || "" };
    });
    const finalMsg = (contextText ? contextText + "\n\n" : "") + String(message || "");
    const payload = JSON.stringify({ message: finalMsg, history: messages, effort: "high", think: true });
    const options = {
      hostname: new URL(COMMANDER_URL).hostname,
      path: new URL(COMMANDER_URL).pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + COMMANDER_API_KEY,
        "User-Agent": "Mozilla/5.0 OceanSFT-Commander/1.0",
        "Accept": "application/json",
        "Accept-Encoding": "identity",
        "Connection": "keep-alive",
        "Content-Length": Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          if (data && data.reply) {
            const cleaned = cleanCommanderReply(data.reply);
            resolve({ ok: true, content: cleaned || "I received that. Could you rephrase your question?", provider: "commander", agent: data.agent || "COMMANDER" });
          } else if (data && data.error) {
            resolve({ ok: false, error: typeof data.error === "string" ? data.error : JSON.stringify(data.error) });
          } else {
            resolve({ ok: false, error: "No reply from Commander" });
          }
        } catch (e) {
          resolve({ ok: false, error: "Invalid Commander response: " + body.slice(0, 200) });
        }
      });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.write(payload);
    req.end();
  });
}

function callOpenAI(messages) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      max_tokens: 500,
      temperature: 0.3
    });
    const req = https.request({
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Authorization": "Bearer " + OPENAI_API_KEY,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          if (data.choices && data.choices[0]) {
            resolve({ ok: true, content: data.choices[0].message.content, usage: data.usage });
          } else if (data.error) {
            resolve({ ok: false, error: data.error.message });
          } else {
            resolve({ ok: false, error: "No response from OpenAI" });
          }
        } catch (e) {
          resolve({ ok: false, error: "Invalid OpenAI response" });
        }
      });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.write(payload);
    req.end();
  });
}

function generateAssessment(event) {
  if (!OPENAI_API_KEY || AI_PROVIDER === "heuristic") {
    return {
      provider: "heuristic",
      summary: "Autonomous agent assessed the event using built-in safe heuristics.",
      confidence: String(event.severity || "").toLowerCase() === "high" ? 0.58 : 0.86,
      reasoning: "Heuristic-based assessment: severity=" + (event.severity || "low") + ", type=" + (event.issueType || "unknown")
    };
  }

  const prompt = [
    { role: "system", content: SYSTEM_PROMPT + "\n\nAnalyze this monitoring event and provide:\n1. A brief summary (1-2 sentences)\n2. A confidence score (0.0-1.0)\n3. Recommended action\n4. Root cause assessment\n\nRespond in JSON: { \"summary\": \"...\", \"confidence\": 0.85, \"action\": \"...\", \"rootCause\": \"...\" }" },
    { role: "user", content: "Event: " + JSON.stringify({ type: event.type, issueType: event.issueType, severity: event.severity, message: event.message, source: event.source, metadata: event.metadata }) }
  ];

  return callOpenAI(prompt).then(result => {
    if (result.ok) {
      try {
        const parsed = JSON.parse(result.content);
        return {
          provider: "openai",
          model: OPENAI_MODEL,
          summary: parsed.summary || result.content,
          confidence: Number(parsed.confidence) || 0.8,
          action: parsed.action || "review",
          rootCause: parsed.rootCause || "",
          usage: result.usage
        };
      } catch (e) {
        return {
          provider: "openai",
          model: OPENAI_MODEL,
          summary: result.content,
          confidence: 0.8,
          action: "review",
          rootCause: "",
          usage: result.usage
        };
      }
    }
    return {
      provider: "heuristic",
      summary: "AI assessment failed, using fallback heuristics.",
      confidence: String(event.severity || "").toLowerCase() === "high" ? 0.52 : 0.82,
      error: result.error
    };
  });
}

async function aiChat(messages, context) {
  // Prefer M.A.M Commander AI when configured
  if (isCommanderConfigured()) {
    var lastUserMsg = "";
    (Array.isArray(messages) ? messages : []).forEach(function(m) { if (m && m.role === "user") lastUserMsg = m.content || ""; });
    // Send only minimal, non-sensitive context (never email/plans/ids) to keep replies clean.
    var ctx = context || {};
    var safeCtx = { company: (ctx.user && ctx.user.company) || "", moduleCount: ctx.moduleCount || 0 };
    const instruction = "You are Ocean SFT AI, a helpful assistant for the Ocean SFT business platform. " +
      "Answer this question directly and concisely in a friendly way. " +
      "NEVER repeat, quote, or mention anything about memory, known-facts, conversation history, other users, or metadata. " +
      "Do not echo the request back. Output only the answer.";
    const contextText = "Helpful context: " + JSON.stringify(safeCtx).replace(/[{}"]/g, "");
    const history = messages.map(function(m){ return { role: "user", content: m.content }; });
    return callCommander(instruction + "\n\nQuestion: " + (lastUserMsg || "Hello"), history, contextText);
  }
  if (!OPENAI_API_KEY) {
    return { ok: false, error: "OpenAI API key not configured" };
  }
  const systemMsg = {
    role: "system",
    content: SYSTEM_PROMPT + "\n\nYou are Ocean SFT AI assistant. Help users with their business operations. Be concise and helpful.\n\nContext: " + JSON.stringify(context || {}).slice(0, 1000)
  };
  const allMessages = [systemMsg, ...messages];
  return callOpenAI(allMessages);
}

async function generateReport(data) {
  if (isCommanderConfigured()) {
    const prompt = "Generate a concise business report from this data. Respond with JSON only: {summary, revenue, orders, trends:[], recommendations:[]}.\nData: " + JSON.stringify(data).slice(0, 1500);
    const r = await callCommander(prompt, [], "Ocean SFT business report");
    if (r.ok) {
      try {
        const parsed = JSON.parse(r.content);
        return { ok: true, report: Object.assign({ revenue: data.revenue || 0, orders: data.orders || 0, provider: "commander" }, parsed) };
      } catch (e) {
        return { ok: true, report: { summary: r.content, revenue: data.revenue || 0, orders: data.orders || 0, trends: [], recommendations: [], provider: "commander" } };
      }
    }
    return { ok: false, error: r.error };
  }
  if (!OPENAI_API_KEY) {
    return {
      ok: false,
      report: {
        summary: "AI report generation requires OpenAI API key. Configure OPENAI_API_KEY in .env",
        revenue: data.revenue || 0,
        orders: data.orders || 0,
        trends: [],
        recommendations: ["Configure AI provider for automated reports"]
      }
    };
  }
  const prompt = [
    { role: "system", content: "Generate a business report in JSON format with: summary, revenue analysis, order analysis, trends (array), recommendations (array). Be data-driven and concise." },
    { role: "user", content: "Business data: " + JSON.stringify(data).slice(0, 2000) }
  ];
  const result = await callOpenAI(prompt);
  if (result.ok) {
    try {
      return { ok: true, report: JSON.parse(result.content) };
    } catch (e) {
      return { ok: true, report: { summary: result.content, revenue: data.revenue || 0, orders: data.orders || 0, trends: [], recommendations: [] } };
    }
  }
  return { ok: false, error: result.error };
}

async function predictSales(historicalData) {
  if (isCommanderConfigured()) {
    const prompt = "Analyze this sales data and predict future sales. Respond with JSON only: {nextDayEstimate, weeklyForecast, confidence, trend, insights:[]}.\nData: " + JSON.stringify(historicalData).slice(0, 1500);
    const r = await callCommander(prompt, [], "Ocean SFT sales prediction");
    if (r.ok) {
      try {
        const parsed = JSON.parse(r.content);
        return { ok: true, prediction: Object.assign({ provider: "commander" }, parsed) };
      } catch (e) {
        return { ok: true, prediction: { summary: r.content, confidence: 0.7, nextDayEstimate: historicalData.avgDaily || 0, weeklyForecast: (historicalData.avgDaily || 0) * 7, trend: "stable", provider: "commander" } };
      }
    }
    return { ok: false, error: r.error };
  }
  if (!OPENAI_API_KEY) {
    return {
      ok: false,
      prediction: {
        nextDayEstimate: historicalData.avgDaily || 0,
        weeklyForecast: (historicalData.avgDaily || 0) * 7,
        confidence: 0.5,
        trend: "stable",
        note: "AI prediction requires OpenAI API key"
      }
    };
  }
  const prompt = [
    { role: "system", content: "Analyze sales data and predict future sales in JSON: { nextDayEstimate, weeklyForecast, confidence, trend, insights (array) }" },
    { role: "user", content: "Historical data: " + JSON.stringify(historicalData).slice(0, 2000) }
  ];
  const result = await callOpenAI(prompt);
  if (result.ok) {
    try {
      return { ok: true, prediction: JSON.parse(result.content) };
    } catch (e) {
      return { ok: true, prediction: { summary: result.content, confidence: 0.7 } };
    }
  }
  return { ok: false, error: result.error };
}

module.exports = { generateAssessment, aiChat, generateReport, predictSales, isAIConfigured: () => Boolean(OPENAI_API_KEY) || isCommanderConfigured(), callCommander, isCommanderConfigured };
