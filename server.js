const app  = require('./src/app');
const pool = require('./src/db');
const PORT = process.env.PORT || 3000;

const MIGRATIONS = [
  // Columns added after initial schema.sql deploy
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS points INT DEFAULT 0`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT false`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS week_schedule JSONB`,
  // update emails: on by default, one-click off from the email footer (src/routes/email.js)
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_updates BOOLEAN NOT NULL DEFAULT TRUE`,
  // Body weight tracking table
  `CREATE TABLE IF NOT EXISTS body_logs (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id   TEXT REFERENCES users(id) ON DELETE CASCADE,   -- Firebase uid, like users.id
    weight_kg NUMERIC(5,2) NOT NULL,
    note      TEXT,
    logged_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Cloud backup of the app's local data (src/routes/sync.js): one JSON
  // document per user and collection
  `CREATE TABLE IF NOT EXISTS user_sync (
    user_id    TEXT NOT NULL,
    collection TEXT NOT NULL,
    data       JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, collection)
  )`,
  `CREATE INDEX IF NOT EXISTS user_sync_updated ON user_sync (user_id, updated_at)`,
  // per-user daily AI caps count a user's calls over the last 24 h (src/lib/aiQuota.js)
  `CREATE INDEX IF NOT EXISTS ai_log_user_time ON ai_log (user_id, logged_at)`,
];

async function runMigrations() {
  for (const sql of MIGRATIONS) {
    try { await pool.query(sql); } catch (e) { console.error('Migration failed:', sql, e.message); }
  }
}

runMigrations().then(() => {
  const server = app.listen(PORT, () => console.log(`API running on port ${PORT}`));
  // Cloud Run stops an idle instance with SIGTERM: finish requests, close the pool
  process.on('SIGTERM', () => {
    server.close(() => pool.end().finally(() => process.exit(0)));
  });
});
