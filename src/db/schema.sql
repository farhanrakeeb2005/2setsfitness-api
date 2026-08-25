-- Users
CREATE TABLE IF NOT EXISTS users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT UNIQUE NOT NULL,
  password   TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT 'Athlete',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
 
-- Profile (goal, level, units, streak)
CREATE TABLE IF NOT EXISTS profiles (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  goal       TEXT,
  level      TEXT,
  units      TEXT DEFAULT 'kg',
  streak     INT  DEFAULT 0,
  last_workout_day DATE,
  avatar_emoji     TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
 
-- Routines
CREATE TABLE IF NOT EXISTS routines (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  icon       TEXT DEFAULT '⭐',
  exercises  JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
 
-- Workout history
CREATE TABLE IF NOT EXISTS history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  volume     NUMERIC DEFAULT 0,
  sets       INT     DEFAULT 0,
  exercises  JSONB   DEFAULT '[]',
  logged_at  TIMESTAMPTZ DEFAULT NOW()
);
 
-- Leaderboard
CREATE TABLE IF NOT EXISTS leaderboard (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  metric      TEXT NOT NULL,
  value       NUMERIC NOT NULL,
  period      TEXT DEFAULT 'weekly',
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);
 
-- Personal records
CREATE TABLE IF NOT EXISTS personal_records (
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  exercise    TEXT NOT NULL,
  weight      NUMERIC NOT NULL,
  recorded_at DATE DEFAULT CURRENT_DATE,
  PRIMARY KEY (user_id, exercise)
);
 
-- AI coaching log (optional — tracks what AI said for learning)
CREATE TABLE IF NOT EXISTS ai_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  tokens_used INT  DEFAULT 0,
  logged_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Phone verification columns (migration-safe)
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE;

-- Week schedule stored on profile
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS week_schedule JSONB DEFAULT '{}';

-- Recovery logs
CREATE TABLE IF NOT EXISTS recovery_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  score       INT NOT NULL,
  sleep_hours NUMERIC,
  soreness    INT,
  note        TEXT,
  logged_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Nutrition logs
CREATE TABLE IF NOT EXISTS nutrition_logs (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  meal      TEXT DEFAULT 'Any',
  protein   NUMERIC DEFAULT 0,
  carbs     NUMERIC DEFAULT 0,
  fat       NUMERIC DEFAULT 0,
  calories  NUMERIC DEFAULT 0,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sports logs
CREATE TABLE IF NOT EXISTS sports_logs (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  sport     TEXT NOT NULL,
  emoji     TEXT,
  duration  INT DEFAULT 0,
  calories  NUMERIC DEFAULT 0,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

-- Water logs (one row per user per day)
CREATE TABLE IF NOT EXISTS water_logs (
  user_id  UUID REFERENCES users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  cups     INT DEFAULT 0,
  PRIMARY KEY (user_id, log_date)
);

-- Form scores
CREATE TABLE IF NOT EXISTS form_scores (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  exercise  TEXT NOT NULL,
  score     INT NOT NULL,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cumulative points (awarded server-side on each log action)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS points INT DEFAULT 0;

