const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { MONGO_URI, MONGO_DB_NAME, DATA_DIR, STORES_DIR, ECOSYSTEM_DB } = require('./data-config');

const COLLECTION_NAME = 'sqlite_file_backups';

let client = null;

async function getClient() {
  if (client) return client;
  client = new MongoClient(MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000
  });
  await client.connect();
  return client;
}

async function getCollection() {
  const c = await getClient();
  const db = c.db(MONGO_DB_NAME);
  return db.collection(COLLECTION_NAME);
}

function listAllDbFiles() {
  const files = [];

  if (fs.existsSync(ECOSYSTEM_DB)) {
    files.push({ id: 'ecosystem', filePath: ECOSYSTEM_DB });
  }

  if (fs.existsSync(STORES_DIR)) {
    fs.readdirSync(STORES_DIR).forEach(function (file) {
      if (path.extname(file).toLowerCase() === '.db') {
        files.push({
          id: 'store_' + file,
          filePath: path.join(STORES_DIR, file),
          fileName: file
        });
      }
    });
  }

  return files;
}

async function restoreAllDbFiles() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(STORES_DIR)) fs.mkdirSync(STORES_DIR, { recursive: true });

    const col = await getCollection();
    const docs = await col.find({}).toArray();

    docs.forEach(function (doc) {
      try {
        const buffer = Buffer.from(doc.data, 'base64');
        let targetPath;
        if (doc._id === 'ecosystem') {
          targetPath = ECOSYSTEM_DB;
        } else {
          targetPath = path.join(STORES_DIR, doc.fileName);
        }
        fs.writeFileSync(targetPath, buffer);
        console.log('[sqlite-cloud-sync] Restored: ' + (doc.fileName || 'ecosystem.db'));
      } catch (e) {
        console.error('[sqlite-cloud-sync] Restore failed for ' + doc._id + ': ' + e.message);
      }
    });

    console.log('[sqlite-cloud-sync] Restore complete. ' + docs.length + ' file(s) restored.');
  } catch (e) {
    console.error('[sqlite-cloud-sync] Restore skipped: ' + e.message);
  }
}

async function backupAllDbFiles() {
  try {
    const col = await getCollection();
    const files = listAllDbFiles();

    for (const file of files) {
      try {
        const buffer = fs.readFileSync(file.filePath);
        const base64 = buffer.toString('base64');
        await col.updateOne(
          { _id: file.id },
          {
            $set: {
              data: base64,
              fileName: file.fileName || '',
              updatedAt: new Date().toISOString()
            }
          },
          { upsert: true }
        );
      } catch (e) {
        console.error('[sqlite-cloud-sync] Backup failed for ' + file.id + ': ' + e.message);
      }
    }
  } catch (e) {
    console.error('[sqlite-cloud-sync] Backup skipped: ' + e.message);
  }
}

module.exports = {
  restoreAllDbFiles,
  backupAllDbFiles
};
