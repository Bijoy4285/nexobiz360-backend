const { makeUser } = require("../lib/auth");

function seedAdmins(db) {
  let admins = [];
  try {
    const fromEnv = process.env.ADMIN_CREDENTIALS;
    if (fromEnv) {
      const parsed = JSON.parse(fromEnv);
      if (Array.isArray(parsed)) admins = parsed;
    }
  } catch (e) {
    console.error("Invalid ADMIN_CREDENTIALS env var, ignoring it.");
  }

  // No demo/default admin accounts are created. Admins are provisioned only
  // from the ADMIN_CREDENTIALS environment variable at deploy time.
  admins.forEach(admin => {
    if (!admin.email || !admin.password) return;
    if (!db.users.some(user => user.email === admin.email.toLowerCase())) {
      const next = makeUser(admin.company, admin.email, admin.phone || "", admin.country || "", admin.password, true);
      if (admin.founder) next.founder = true;
      db.users.push(next);
      db.storage[next.id] = db.storage[next.id] || {};
    }
  });
}

module.exports = { seedAdmins };
