// Could a log be real? The server's copy of the app's rules
// (formcoach-app src/lib/plausibility.js and src/lib/sportDistance.js; the
// crossRepo test checks the limits and the verdicts match). The app refuses
// ("block") or asks about ("check") a log before saving it; a modified app
// or a script could still back up anything, so challenge races
// (challengeRules.js progress) ignore every log the app would have refused:
// more reps in a set than anyone does, more sets than a workout holds, sets
// faster than the time allows (cardio minutes past the workout's time, even
// in one set), a sports session longer than its sport allows
// (3 h, 5 h for endurance sports, less at Hard), a distance faster than
// anyone goes, a log in the future; and from SPORT_RULES_FROM a session with
// no minutes or start, one over 90 minutes without proof (a photo or the
// live timer), the day's 3rd without proof, one ending after it was logged,
// or one overlapping an earlier session or a workout. Weights aren't judged
// here: the server doesn't know the account's units or body weight.
// A set marked as a warm-up (type: 'warmup', the app's lib/setTypes.js) isn't
// in the set count or the pace, as in the app; its reps are still checked.

const LIMITS = {
  repsCheck: 100,
  repsBlock: 300,
  holdSecBlock: 10800,
  cardioMinBlock: 360,
  prJump: 1.35,
  prJumpMinKg: 10,
  prMinBestKg: 20,
  bodyMultBlock: 4,
  setsCheck: 60,
  setsBlock: 150,
  dayVolumeCheckKg: 60000,
  dayVolumeBlockKg: 150000,
  secPerRep: 3,
  defaultRestSec: 75,
  restShare: 0.5,
  changeoverSec: 20,
  paceCheck: 0.7,
  paceBlock: 0.35,
  paceMinSets: 2,
  cardioSlackSec: 60,
  secPerSetBlock: 20,
  burstSets: 3,
  burstMs: 20000,
  backDays: 7,
  latePerWeek: 3,
  futureSlackMs: 5 * 60000,
  dupMs: 60000,
  sportCheckMin: 120,
  sportBlockMin: 180,
  sportLongBlockMin: 300,
  sportHardCheckMin: 90,
  sportHardBlockMin: 150,
  sportLongHardBlockMin: 240,
  sportProofMin: 90,
  sportsPerDay: 3,
  sportDayMin: 240,
  sleepCheckH: 11,
  sleepBlockH: 14,
  sleepDayBlockH: 16,
  kcalCheck: 3000,
  kcalBlock: 6000,
  proteinCheck: 200,
  dayKcalCheck: 6000,
  dayKcalBlock: 10000,
  foodDupMs: 5 * 60000,
  waterCheck: 25,
  waterBlock: 40,
  stepsBlock: 80000,
  overlapMs: 5 * 60000,
};
const L = LIMITS;
const KM_TOP_SPEED = { Running: 25, Cycling: 60, Swimming: 8, Walking: 10, Hiking: 10, Rowing: 25 };
const KM_CHECK_SPEED = { Running: 20, Cycling: 45, Swimming: 5, Walking: 7.5, Hiking: 7, Rowing: 18 };

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const doneSets = (ex) => (Array.isArray(ex && ex.sets) ? ex.sets.filter((s) => s && typeof s === 'object' && s.done !== false) : []);
const isWarmup = (s) => !!s && s.type === 'warmup';
/** the done sets that are training: every one but the warm-ups */
const workDone = (ex) => doneSets(ex).filter((s) => !isWarmup(s));

const HOLD_WORDS = /\b(plank|hold|hang|wall sit|l-sit|carry|carries|hollow)\b/i;
const CARDIO_WORDS = /\b(run|running|jog|bike|cycling|cycle|row|rowing|rower|treadmill|elliptical|walk|walking|swim|skipping|jump rope|stair)\b/i;
/** an exercise's set type: saved with it by the app (track), else guessed from its name */
function exType(ex) {
  if (ex && typeof ex.track === 'string') return ex.track;
  const name = String((ex && ex.name) || '');
  return HOLD_WORDS.test(name) ? 'hold' : CARDIO_WORDS.test(name) ? 'cardio' : 'weighted';
}

/** the least time a workout's done sets could take (seconds) and how many there are */
function minWorkoutSec(exercises = [], { restSec } = {}) {
  let work = 0, sets = 0, used = 0;
  for (const ex of exercises || []) {
    const ds = workDone(ex);
    if (!ds.length) continue;
    used += 1;
    const type = exType(ex);
    for (const s of ds) {
      sets += 1;
      const r = Math.max(0, num(s.r));
      work += type === 'hold' ? r : type === 'cardio' ? r * 60 : r * L.secPerRep;
    }
  }
  const rest = (num(restSec) > 0 ? num(restSec) : L.defaultRestSec) * L.restShare * Math.max(0, sets - 1);
  return { sec: Math.round(work + rest + L.changeoverSec * Math.max(0, used - 1)), sets };
}

/** the minutes of a workout's done cardio sets (warm-ups aside) */
function cardioMinutes(exercises = []) {
  let m = 0;
  for (const ex of exercises || []) if (exType(ex) === 'cardio') for (const s of workDone(ex)) m += Math.max(0, num(s.r));
  return m;
}

/** 'ok' | 'check' | 'block' for the time a workout took against its sets
 * (cardio minutes past the time it took, even in one set, are refused) */
function paceLevel(exercises, durationSec, opts = {}) {
  const dur = num(durationSec);
  if (!(dur > 0)) return 'ok';
  if (cardioMinutes(exercises) * 60 > dur + L.cardioSlackSec) return 'block';
  const { sec, sets } = minWorkoutSec(exercises, opts);
  if (sets < L.paceMinSets || !(sec > 0)) return 'ok';
  if (dur < sec * L.paceBlock || (sets >= 10 && dur < sets * L.secPerSetBlock)) return 'block';
  if (dur < sec * L.paceCheck) return 'check';
  return 'ok';
}

/** a backed-up workout a race ignores: impossible reps, set length, set count or pace (weights aren't judged) */
function raceWorkoutBlocked(h) {
  const exercises = Array.isArray(h && h.exercises) ? h.exercises : [];
  let sets = 0;
  for (const ex of exercises) {
    const type = exType(ex);
    for (const s of doneSets(ex)) {
      if (!isWarmup(s)) sets += 1;
      const r = Math.max(0, num(s.r));
      if (type === 'hold' ? r > L.holdSecBlock : type === 'cardio' ? r > L.cardioMinBlock : r > L.repsBlock) return true;
    }
  }
  if (sets > L.setsBlock) return true;
  return paceLevel(exercises, h && h.durationSec) === 'block';
}

/** { ok } when km in minutes could be real (the app's sportDistance.js checkKm) */
function checkKm(sport, km, minutes) {
  const top = KM_TOP_SPEED[sport];
  if (!top || !(km > 0) || !(minutes > 0)) return { ok: true };
  const max = (top * minutes) / 60;
  if (km <= max) return { ok: true };
  return { ok: false, metres: km / 1000 <= max ? km : null };
}

// ── sports (the app's plausibility.js: the same rules, as far as a backup shows them) ──
const SPORT_RULES_FROM = Date.UTC(2026, 10, 4);   // 4 Nov 2026
const ENDURANCE_SPORTS = ['Running', 'Cycling', 'Swimming', 'Hiking', 'Walking', 'Rowing', 'Golf', 'Cricket'];
const DAY_MS = 864e5;
/** a session's limits in minutes, { check, block }, by its sport and intensity */
function sportLimits(kind, intensity) {
  const long = ENDURANCE_SPORTS.includes(String(kind || ''));
  if (intensity === 'hard') return { check: L.sportHardCheckMin, block: long ? L.sportLongHardBlockMin : L.sportHardBlockMin };
  return { check: L.sportCheckMin, block: long ? L.sportLongBlockMin : L.sportBlockMin };
}
/** proof a session happened: timed with the app's live timer, or a photo (its path on the phone) */
const hasProof = (e) => !!e && (e.timed === true || (typeof e.photo === 'string' && e.photo.length > 0));
const minsOf = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const overlaps = (a, b) => !!a && !!b && Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > L.overlapMs;
const workoutWindow = (h) => (num(h && h.startedAt) > 0 && num(h && h.durationSec) > 0 ? [num(h.startedAt), num(h.startedAt) + num(h.durationSec) * 1000] : null);
const raceWindow = (s) => (num(s && s.startedAt) > 0 && num(s && s.duration) > 0 ? [num(s.startedAt), num(s.startedAt) + num(s.duration) * 60000] : null);
const utcDay = (ts) => Math.floor(num(ts) / DAY_MS);

/**
 * A backed-up sports session a race ignores (the app refuses it): longer
 * than its sport allows, or faster than anyone goes; from SPORT_RULES_FROM
 * also no minutes or start, over sportProofMin minutes without proof, the
 * UTC day's sportsPerDay-th without proof, ending after it was logged, or
 * overlapping an earlier session (others: the player's sessions) or a
 * workout (history), by the startedAt the app saves.
 */
function raceSportBlocked(s, { others = [], history = [] } = {}) {
  const dur = num(s && s.duration), km = num(s && s.km);
  if (dur > sportLimits(String((s && s.sport) || ''), s && s.intensity).block) return true;
  if (km > 0 && dur > 0 && !checkKm(String((s && s.sport) || ''), km, dur).ok) return true;
  const ts = num(s && s.ts);
  if (!(ts >= SPORT_RULES_FROM)) return false;
  if (!(dur > 0) || (!(num(s.startedAt) > 0) && minsOf(s.startTime) == null)) return true;
  if (!hasProof(s) && dur > L.sportProofMin) return true;
  const earlier = (others || []).filter((o) => o && o !== s && (num(o.ts) < ts || (num(o.ts) === ts && String(o.id || '') < String(s.id || ''))));
  if (!hasProof(s) && earlier.filter((o) => utcDay(o.ts) === utcDay(ts)).length === L.sportsPerDay - 1) return true;
  const win = raceWindow(s);
  if (!win) return false;
  if (win[1] > ts + L.futureSlackMs) return true;
  return earlier.some((o) => overlaps(win, raceWindow(o))) || (history || []).some((h) => h && h.imported !== true && overlaps(win, workoutWindow(h)));
}
/** a player's backed-up sessions a race counts (every one raceSportBlocked lets through) */
const raceSportsKept = (sports = [], history = []) => (sports || []).filter((s) => s && !raceSportBlocked(s, { others: sports, history }));

/**
 * A late log: added through the app's "Forgot to log a workout?" (late:
 * true, even for earlier today) or an older log saved on a later day
 * (backdated: true); the app's isLateLog. A race counts only what was
 * tracked live, so it ignores these (challengeRules.js progress).
 */
const isLateLog = (e) => !!e && typeof e === 'object' && (e.late === true || e.backdated === true);

/** a log's time that hasn't come yet (a clock a few minutes out aside) */
const inFuture = (ts, now = Date.now()) => Number.isFinite(ts) && ts > now + L.futureSlackMs;

module.exports = {
  LIMITS, KM_TOP_SPEED, KM_CHECK_SPEED, exType, minWorkoutSec, cardioMinutes, paceLevel, raceWorkoutBlocked, checkKm, raceSportBlocked, inFuture, isLateLog,
  SPORT_RULES_FROM, ENDURANCE_SPORTS, sportLimits, hasProof, raceSportsKept,
};
