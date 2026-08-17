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

