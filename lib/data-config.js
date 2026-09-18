// Central data-directory resolver.
// MongoDB connection string is read from the OCEAN_MONGO_URI env var.
const path = require("path");

function resolveMongoUri() {
  const uri = process.env.OCEAN_MONGO_URI;
  if (uri && uri.trim()) {
    return uri.trim();
  }
  // Fallback (only for local dev testing without MongoDB configured).
  return "";
}

function resolveDbName() {
  const name = process.env.OCEAN_MONGO_DB_NAME;
  if (name && name.trim()) return name.trim();
  return "nexobiz360";
}

module.exports = {
  MONGO_URI: resolveMongoUri(),
  MONGO_DB_NAME: resolveDbName(),
  // Legacy exports kept so any old code referencing these doesn't crash.
  DATA_DIR: path.join(__dirname, "..", "data"),
  STORES_DIR: path.join(__dirname, "..", "data", "stores")
};
