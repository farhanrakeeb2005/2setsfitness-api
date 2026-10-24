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
  // what a challenge is (lib/challengeRules.js): its kind, days, stake and
  // forfeit, a target or routine race's goal, and how it ended
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'points'`,
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS days INTEGER NOT NULL DEFAULT 7`,
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS stake INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS forfeit TEXT`,
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS target JSONB`,
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS routine JSONB`,
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS winner TEXT`,
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS moved INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS from_value NUMERIC`,
  `ALTER TABLE challenges ADD COLUMN IF NOT EXISTS to_value NUMERIC`,
  // the points a player's challenges have won (+) or lost (-), on top of the
  // total the app reports (the leaderboard shows the two together, never below 0)
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS challenge_pts INTEGER NOT NULL DEFAULT 0`,
  // proof snaps (src/routes/snaps.js): the photo is dropped once seen or
  // after 24 h; rows go after 7 days (reported ones are kept 30 for review)
  `CREATE TABLE IF NOT EXISTS snaps (
    id TEXT PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
    from_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    challenge_id TEXT,
    caption TEXT,
    image BYTEA,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    opened_at TIMESTAMPTZ,
    screenshot BOOLEAN NOT NULL DEFAULT FALSE,
    reported BOOLEAN NOT NULL DEFAULT FALSE,
    report_reason TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS snaps_to ON snaps (to_user, created_at)`,
  `CREATE INDEX IF NOT EXISTS snaps_from ON snaps (from_user, created_at)`,
  // who has blocked whom (snaps and challenges)
  `CREATE TABLE IF NOT EXISTS blocks (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, blocked_id)
  )`,
  // Settings -> receive proof snaps (off: nobody can send this player one)
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS snaps_off BOOLEAN NOT NULL DEFAULT FALSE`,
  // friends (src/routes/friends.js): a row each way once accepted; one row is a request
  `CREATE TABLE IF NOT EXISTS friends (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, friend_id)
  )`,
  `CREATE INDEX IF NOT EXISTS friends_friend ON friends (friend_id)`,
  // the short code a player shares to be added (shown as 2S-XXXXXX)
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS friend_code TEXT DEFAULT upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS profiles_friend_code ON profiles (friend_code)`,
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
