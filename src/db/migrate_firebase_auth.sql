-- One-time migration: switch user_id columns from UUID to TEXT so they can
-- hold Firebase Auth uids (e.g. "fK3n9xQpL2...") instead of generated UUIDs.
-- Run manually once: npm run db:migrate-firebase
-- Safe to re-run — every statement is idempotent (IF EXISTS / already-TEXT is a no-op).

-- 1. Drop FK constraints that reference users.id (must happen before either side's type changes)
ALTER TABLE profiles         DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;
ALTER TABLE routines         DROP CONSTRAINT IF EXISTS routines_user_id_fkey;
ALTER TABLE history          DROP CONSTRAINT IF EXISTS history_user_id_fkey;
ALTER TABLE leaderboard      DROP CONSTRAINT IF EXISTS leaderboard_user_id_fkey;
ALTER TABLE personal_records DROP CONSTRAINT IF EXISTS personal_records_user_id_fkey;
ALTER TABLE ai_log           DROP CONSTRAINT IF EXISTS ai_log_user_id_fkey;
ALTER TABLE body_logs        DROP CONSTRAINT IF EXISTS body_logs_user_id_fkey;
ALTER TABLE recovery_logs    DROP CONSTRAINT IF EXISTS recovery_logs_user_id_fkey;
ALTER TABLE nutrition_logs   DROP CONSTRAINT IF EXISTS nutrition_logs_user_id_fkey;
ALTER TABLE sports_logs      DROP CONSTRAINT IF EXISTS sports_logs_user_id_fkey;
ALTER TABLE water_logs       DROP CONSTRAINT IF EXISTS water_logs_user_id_fkey;

-- 2. users.id: drop the UUID auto-default, switch type to TEXT
ALTER TABLE users ALTER COLUMN id DROP DEFAULT;
ALTER TABLE users ALTER COLUMN id TYPE TEXT USING id::text;

-- 3. Every user_id column: UUID -> TEXT
ALTER TABLE profiles         ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE routines         ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE history          ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE leaderboard      ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE personal_records ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE ai_log           ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE body_logs        ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE recovery_logs    ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE nutrition_logs   ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE sports_logs      ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE water_logs       ALTER COLUMN user_id TYPE TEXT USING user_id::text;

-- 4. Re-add the FK constraints (both sides are TEXT now, so this is valid again)
ALTER TABLE profiles         ADD CONSTRAINT profiles_user_id_fkey         FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE routines         ADD CONSTRAINT routines_user_id_fkey         FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE history          ADD CONSTRAINT history_user_id_fkey          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE leaderboard      ADD CONSTRAINT leaderboard_user_id_fkey      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE personal_records ADD CONSTRAINT personal_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ai_log           ADD CONSTRAINT ai_log_user_id_fkey           FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE body_logs        ADD CONSTRAINT body_logs_user_id_fkey        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE recovery_logs    ADD CONSTRAINT recovery_logs_user_id_fkey    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE nutrition_logs   ADD CONSTRAINT nutrition_logs_user_id_fkey   FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE sports_logs      ADD CONSTRAINT sports_logs_user_id_fkey      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE water_logs       ADD CONSTRAINT water_logs_user_id_fkey       FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
