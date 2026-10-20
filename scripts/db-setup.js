// One-time setup of an empty database (e.g. a new Neon project):
// src/db/schema.sql, then src/db/migrate_firebase_auth.sql (user ids become
// TEXT for Firebase uids). Both are safe to re-run. No psql needed:
//   DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require" npm run db:setup:node
// server.js adds the later columns/tables itself on every start.
const fs = require('fs');
const path = require('path');
const pool = require('../src/db');

const FILES = ['schema.sql', 'migrate_firebase_auth.sql'];

(async () => {
  try {
    for (const f of FILES) {
      const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', f), 'utf8');
      await pool.query(sql);
      console.log(`ran ${f}`);
    }
    const { rows } = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1");
    console.log('tables:', rows.map((r) => r.table_name).join(', '));
  } catch (e) {
    console.error('setup failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
