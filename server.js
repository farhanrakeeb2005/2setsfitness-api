const app  = require('./src/app');
const pool = require('./src/db');
const PORT = process.env.PORT || 3000;

const MIGRATIONS = [
  // Columns added after initial schema.sql deploy
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS points INT DEFAULT 0`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT false`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS week_schedule JSONB`,
  // Body weight tracking table
  `CREATE TABLE IF NOT EXISTS body_logs (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
    weight_kg NUMERIC(5,2) NOT NULL,
    note      TEXT,
    logged_at TIMESTAMPTZ DEFAULT NOW()
  )`,
];

async function runMigrations() {
  for (const sql of MIGRATIONS) {
    try { await pool.query(sql); } catch (e) { console.error('Migration failed:', sql, e.message); }
  }
}

runMigrations().then(() => {
  app.listen(PORT, () => console.log(`API running on port ${PORT}`));
});
