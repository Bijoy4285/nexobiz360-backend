const PERMISSIONS = {
  admin: ["*"],
  manager: [
    "dashboard.read", "dashboard.write",
    "pos.read", "pos.write", "pos.delete",
    "restaurant.read", "restaurant.write", "restaurant.delete",
    "hotel.read", "hotel.write", "hotel.delete",
    "pharmacy.read", "pharmacy.write", "pharmacy.delete",
    "crm.read", "crm.write", "crm.delete",
    "invoice.read", "invoice.write", "invoice.delete",
    "accounting.read", "accounting.write",
    "hr.read", "hr.write",
    "marketing.read", "marketing.write",
    "loyalty.read", "loyalty.write",
    "supplychain.read", "supplychain.write",
    "warehouse.read", "warehouse.write",
    "reports.read", "users.read",
    "whatsapp.read", "whatsapp.write", "whatsapp.broadcast"
  ],
  cashier: [
    "dashboard.read",
    "pos.read", "pos.write",
    "pharmacy.read", "pharmacy.write",
    "restaurant.read", "restaurant.write",
    "invoice.read", "invoice.write"
  ],
  viewer: [
    "dashboard.read",
    "pos.read", "restaurant.read", "hotel.read", "pharmacy.read",
    "crm.read", "invoice.read", "accounting.read", "reports.read"
  ]
};

const ROLE_HIERARCHY = { admin: 4, manager: 3, cashier: 2, viewer: 1 };

function createRole(db, userId, role, assignedBy) {
  const validRole = PERMISSIONS[role] ? role : "viewer";
  const existing = (db.user_roles || []).find(r => r.userId === userId);
  if (existing) {
    existing.role = validRole;
    existing.updatedAt = new Date().toISOString();
    existing.assignedBy = assignedBy || "";
    return existing;
  }
  const entry = {
    id: "role_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    userId,
    role: validRole,
    assignedBy: assignedBy || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (!db.user_roles) db.user_roles = [];
  db.user_roles.push(entry);
  return entry;
}

function getUserRole(db, userId) {
  const entry = (db.user_roles || []).find(r => r.userId === userId);
  return entry ? entry.role : "viewer";
}

function getUserPermissions(db, userId) {
  const role = getUserRole(db, userId);
  return PERMISSIONS[role] || PERMISSIONS.viewer;
}

function hasPermission(db, userId, permission) {
  const perms = getUserPermissions(db, userId);
  if (perms.includes("*")) return true;
  return perms.includes(permission);
}

function requirePermission(db, userId, permission) {
  if (!hasPermission(db, userId, permission)) {
    return { allowed: false, error: "Permission denied: " + permission };
  }
  return { allowed: true };
}

function canAccessRole(requestorRole, targetRole) {
  const reqLevel = ROLE_HIERARCHY[requestorRole] || 0;
  const tgtLevel = ROLE_HIERARCHY[targetRole] || 0;
  return reqLevel > tgtLevel;
}

function listRoles(db) {
  return (db.user_roles || []).slice();
}

module.exports = { PERMISSIONS, ROLE_HIERARCHY, createRole, getUserRole, getUserPermissions, hasPermission, requirePermission, canAccessRole, listRoles };
