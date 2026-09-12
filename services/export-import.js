function escapeCSV(value) {
  const str = String(value == null ? "" : value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function arrayToCSV(headers, rows) {
  const lines = [headers.map(escapeCSV).join(",")];
  rows.forEach(row => {
    lines.push(headers.map(h => escapeCSV(row[h])).join(","));
  });
  return lines.join("\n");
}

function exportToCSV(data, moduleName) {
  if (!data || !data.length) return { csv: "", filename: moduleName + "_export.csv", count: 0 };
  const headers = Object.keys(data[0]);
  const csv = arrayToCSV(headers, data);
  return { csv, filename: moduleName + "_export_" + new Date().toISOString().slice(0, 10) + ".csv", count: data.length };
}

function exportToJSON(data, moduleName) {
  return {
    json: JSON.stringify(data, null, 2),
    filename: moduleName + "_export_" + new Date().toISOString().slice(0, 10) + ".json",
    count: Array.isArray(data) ? data.length : 0
  };
}

function parseCSV(text) {
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map(v => v.trim().replace(/^"|"$/g, ""));
    const row = {};
    headers.forEach((h, j) => { row[h] = values[j] || ""; });
    rows.push(row);
  }
  return rows;
}

function parseImportFile(content, filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  if (ext === "json") {
    try {
      const data = JSON.parse(content);
      return { ok: true, data: Array.isArray(data) ? data : [data], format: "json" };
    } catch (e) {
      return { ok: false, error: "Invalid JSON file" };
    }
  }
  if (ext === "csv") {
    const data = parseCSV(content);
    return { ok: true, data, format: "csv" };
  }
  return { ok: false, error: "Unsupported file format. Use CSV or JSON." };
}

function getModuleData(db, userStorage, module) {
  const MODULE_KEY_MAP = {
    pos: "ocean_pos_sales",
    restaurant: "restaurant_pos_orders",
    hotel: "hotel_pos_bookings",
    pharmacy: "pharmacy_sales",
    pharmacy_medicines: "pharmacy_simple_medicines",
    crm: "crm_contacts",
    invoice: "invoices",
    accounting: "accounting_transactions",
    hr: "hr_employees",
    marketing: "marketing_campaigns",
    loyalty: "loyalty_customers",
    supplychain: "supplychain_orders",
    warehouse: "warehouse_inventory"
  };
  const key = MODULE_KEY_MAP[module] || module;
  try {
    return JSON.parse(userStorage[key] || "[]");
  } catch (e) {
    return [];
  }
}

module.exports = { exportToCSV, exportToJSON, parseCSV, parseImportFile, getModuleData };
