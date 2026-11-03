// Could a log be real? The server's copy of the app's rules
// (formcoach-app src/lib/plausibility.js and src/lib/sportDistance.js; the
// crossRepo test checks the limits and the verdicts match). The app refuses
// ("block") or asks about ("check") a log before saving it; a modified app
// or a script could still back up anything, so challenge races
// (challengeRules.js progress) ignore every log the app would have refused:
// more reps in a set than anyone does, more sets than a workout holds, sets
// faster than the time allows, a session longer than 6 h, a distance faster
// than anyone goes, a log in the future. Weights aren't judged here: the
// server doesn't know the account's units or body weight.

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
  secPerSetBlock: 20,
  burstSets: 3,
  burstMs: 20000,
  backDays: 7,
  futureSlackMs: 5 * 60000,
  dupMs: 60000,
  sportCheckMin: 180,
  sportBlockMin: 360,
  sleepCheckH: 11,
  sleepBlockH: 14,
  sleepDayBlockH: 16,
  kcalCheck: 3000,
  kcalBlock: 6000,
  proteinCheck: 200,
  dayKcalCheck: 10000,
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
    const ds = doneSets(ex);
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

/** 'ok' | 'check' | 'block' for the time a workout took against its sets */
function paceLevel(exercises, durationSec, opts = {}) {
  const dur = num(durationSec);
  if (!(dur > 0)) return 'ok';
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
      sets += 1;
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

/** a backed-up sports session a race ignores: over 6 h, or faster than anyone goes */
function raceSportBlocked(s) {
  const dur = num(s && s.duration), km = num(s && s.km);
  if (dur > L.sportBlockMin) return true;
  return km > 0 && dur > 0 && !checkKm(String((s && s.sport) || ''), km, dur).ok;
}

/** a log's time that hasn't come yet (a clock a few minutes out aside) */
const inFuture = (ts, now = Date.now()) => Number.isFinite(ts) && ts > now + L.futureSlackMs;

module.exports = {
  LIMITS, KM_TOP_SPEED, KM_CHECK_SPEED, exType, minWorkoutSec, paceLevel, raceWorkoutBlocked, checkKm, raceSportBlocked, inFuture,
};
