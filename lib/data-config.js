// Central data-directory resolver.
// All persistent data (db.json, ecosystem.db, stores/*.db) lives inside ONE
// folder so it can be stored/backed up separately and survive app re-uploads.
//
// Configure the folder with the OCEAN_DATA_DIR env var (an absolute path on the
// server, e.g. outside public_html). When unset it falls back to
// backend/data (kept inside the project, matching the legacy layout).
const path = require("path");
const fs = require("fs");

function resolveDataDir() {
  const override = process.env.OCEAN_DATA_DIR;
  if (override && override.trim()) {
    return path.resolve(override.trim());
  }
  return path.join(__dirname, "..", "data");
}

function ensureDataDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = {
  DATA_DIR: resolveDataDir(),
  DB_FILE: path.join(resolveDataDir(), "db.json"),
  ECOSYSTEM_DB: path.join(resolveDataDir(), "ecosystem.db"),
  STORES_DIR: path.join(resolveDataDir(), "stores"),
  ensureDataDir,
  resolveDataDir
};