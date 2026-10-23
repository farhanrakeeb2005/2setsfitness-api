const app  = require('./src/app');
const pool = require('./src/db');
const PORT = process.env.PORT || 3000;

const MIGRATIONS = [
  // Columns added after initial schema.sql deploy
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS points INT DEFAULT 0`,
  // the leaderboard picture: a small JPEG data URL from the app (PUT /points)
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_photo TEXT`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT false`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS week_schedule JSONB`,
  // Settings → Show me on the leaderboard (off: the account isn't listed to others)
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS leaderboard_hidden BOOLEAN NOT NULL DEFAULT FALSE`,
  // the leaderboard picture beside the name (a small thumbnail data URL)
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_photo TEXT`,
  // public player profiles (GET /profile/public/:id): an opaque id for each
  // player (never the account id) and the card the app sends (publicCard.js)
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS public_id TEXT DEFAULT replace(gen_random_uuid()::text, '-', '')`,
  `CREATE UNIQUE INDEX IF NOT EXISTS profiles_public_id ON profiles (public_id)`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS public_card JSONB`,
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
  // challenges: 7-day points races between two players (src/routes/challenges.js);
  // an account's challenges go with it
  `CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
    from_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ,
    from_start INTEGER, to_start INTEGER, from_end INTEGER, to_end INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS challenges_from ON challenges (from_user, status)`,
  `CREATE INDEX IF NOT EXISTS challenges_to ON challenges (to_user, status)`,
  // each phone's push token (lib/push.js), with the app's language; they go with the account
  `CREATE TABLE IF NOT EXISTS push_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lang TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS push_tokens_user ON push_tokens (user_id)`,
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
