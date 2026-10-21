// One-time setup of an empty database (e.g. a new Neon project):
// src/db/schema.sql, then src/db/migrate_firebase_auth.sql (user ids become
// TEXT for Firebase uids). Both are safe to re-run. No psql needed:
//   DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require" npm run db:setup:node
// server.js adds the later columns/tables itself on every start.
// With Neon's DATABASE_URL_UNPOOLED set (neon env pull writes it), schema
// changes run over the direct connection: the pooled one is PgBouncer in
// transaction mode, which Neon advises against for migrations.
const fs = require('fs');
const path = require('path');
require('dotenv').config();
if (process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
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
