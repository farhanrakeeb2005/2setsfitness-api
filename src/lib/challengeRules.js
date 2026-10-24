// What a challenge is and how it's won (routes/challenges.js). Three kinds:
//
//   points   most points gained over the days (the leaderboard's capped points)
//   target   first to a target: reps of an exercise (100 push-ups) or km of a
//            sport (10 km run), from the workouts and sports the app backs up
//            (/sync: the history and sports collections)
//   routine  first to finish one of the challenger's routines (`times` times):
//            a workout with the routine's name and a done set of each exercise
//
// If nobody gets there before the end, whoever got closest wins; level is a
// draw. A stake (points) goes from the loser to the winner; a forfeit is
// words on the result card, nothing more. Reps are taken on trust, with caps
// (a set counts for at most SET_REPS, a day for at most DAY_REPS): the only
// person you cheat is yourself.

const KINDS = ['points', 'target', 'routine'];
const DAYS = [1, 3, 7, 14];
const STAKES = [0, 10, 25, 50, 100];
const FORFEIT_MAX = 60;
const SET_REPS = 100;
const DAY_REPS = 1000;
const DAY_KM = { run: 100, cycle: 400, swim: 20 };
// a winner takes at most this much a week off the same player (two accounts
// of one person can't pass points between them)
const WEEKLY_FROM_ONE = 100;
// both players' accounts this old to play for points
const STAKE_MIN_AGE_DAYS = 7;

// the targets on offer; reps match the exercise names the app logs
const TARGETS = {
  pushups: { unit: 'reps', match: /\b(push|press)[\s-]?ups?\b/i, min: 10, max: 5000 },
  squats:  { unit: 'reps', match: /\bsquats?\b/i, min: 10, max: 5000 },
  situps:  { unit: 'reps', match: /\bsit[\s-]?ups?\b/i, min: 10, max: 5000 },
  burpees: { unit: 'reps', match: /\bburpees?\b/i, min: 10, max: 5000 },
  pullups: { unit: 'reps', match: /\b(pull|chin)[\s-]?ups?\b/i, min: 5, max: 2000 },
  lunges:  { unit: 'reps', match: /\blunges?\b/i, min: 10, max: 5000 },
  run:     { unit: 'km', sport: /^running$/i, min: 1, max: 500 },
  cycle:   { unit: 'km', sport: /^cycling$/i, min: 1, max: 2000 },
  swim:    { unit: 'km', sport: /^swimming$/i, min: 0.5, max: 100 },
};

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** { spec } for a valid challenge body, else { error } */
function cleanSpec(b = {}) {
  const kind = b.kind == null ? 'points' : b.kind;
  if (!KINDS.includes(kind)) return { error: 'Invalid kind' };
  const days = b.days == null ? 7 : Number(b.days);
  if (!DAYS.includes(days)) return { error: 'Invalid days' };
  const stake = b.stake == null ? 0 : Number(b.stake);
  if (!STAKES.includes(stake)) return { error: 'Invalid stake' };
  const forfeit = str(b.forfeit, FORFEIT_MAX + 1);
  if (forfeit.length > FORFEIT_MAX) return { error: 'Forfeit too long' };
  const spec = { kind, days, stake, forfeit: forfeit || null, target: null, routine: null };
  if (kind === 'target') {
    const key = b.target?.key, t = TARGETS[key];
    const amount = Number(b.target?.amount);
    if (!t) return { error: 'Invalid target' };
    if (!Number.isFinite(amount) || amount < t.min || amount > t.max) return { error: 'Invalid amount' };
    spec.target = { key, unit: t.unit, amount: t.unit === 'km' ? Math.round(amount * 10) / 10 : Math.round(amount) };
  }
  if (kind === 'routine') {
    const name = str(b.routine?.name, 60);
    const exercises = Array.isArray(b.routine?.exercises)
      ? [...new Set(b.routine.exercises.map((e) => str(e, 80)).filter(Boolean))].slice(0, 20) : [];
    const times = b.routine?.times == null ? 1 : Number(b.routine.times);
    if (!name || !exercises.length) return { error: 'Invalid routine' };
    if (![1, 2, 3, 5].includes(times)) return { error: 'Invalid times' };
    spec.routine = { name, exercises, times };
  }
  return { spec };
}

const dayOf = (ts) => Math.floor(ts / 864e5);
const done = (s) => s && s.done !== false;

/**
 * One player's progress toward a target or routine between start and end
 * (ms): { value, reachedAt } (reachedAt: ms of the log that got there, or null).
 * history / sports: the items of the player's backed-up collections.
 */
function progress(spec, { history = [], sports = [] }, start, end) {
  const inside = (x) => Number.isFinite(x?.ts) && x.ts >= start && x.ts <= end;
  const events = [];   // [ts, amount]
  if (spec.kind === 'target') {
    const t = TARGETS[spec.target.key];
    if (t.unit === 'reps') {
      const perDay = {};
      for (const h of history.filter(inside).sort((a, b) => a.ts - b.ts)) {
        let n = 0;
        for (const ex of Array.isArray(h.exercises) ? h.exercises : []) {
          if (!t.match.test(String(ex?.name || ''))) continue;
          for (const s of Array.isArray(ex.sets) ? ex.sets : []) {
            if (done(s)) n += Math.min(SET_REPS, Math.max(0, Math.round(Number(s.r) || 0)));
          }
        }
        const d = dayOf(h.ts);
        const room = DAY_REPS - (perDay[d] || 0);
        n = Math.min(n, room);
        if (n > 0) { perDay[d] = (perDay[d] || 0) + n; events.push([h.ts, n]); }
      }
    } else {
      const cap = DAY_KM[spec.target.key];
      const perDay = {};
      for (const s of sports.filter(inside).sort((a, b) => a.ts - b.ts)) {
        if (!t.sport.test(String(s.sport || ''))) continue;
        const d = dayOf(s.ts);
        const km = Math.min(Math.max(0, Number(s.km) || 0), cap - (perDay[d] || 0));
        if (km > 0) { perDay[d] = (perDay[d] || 0) + km; events.push([s.ts, km]); }
      }
    }
  } else if (spec.kind === 'routine') {
    const want = spec.routine.exercises.map((e) => e.toLowerCase());
    const name = spec.routine.name.toLowerCase();
    for (const h of history.filter(inside).sort((a, b) => a.ts - b.ts)) {
      if (String(h.name || '').trim().toLowerCase() !== name) continue;
      const doneEx = new Set((Array.isArray(h.exercises) ? h.exercises : [])
        .filter((ex) => (Array.isArray(ex.sets) ? ex.sets : []).some(done))
        .map((ex) => String(ex.name || '').toLowerCase()));
      if (want.every((e) => doneEx.has(e))) events.push([h.ts, 1]);
    }
  }
  const goal = goalOf(spec);
  let value = 0, reachedAt = null;
  for (const [ts, n] of events) {
    value += n;
    if (reachedAt == null && value >= goal) reachedAt = ts;
  }
  return { value: Math.round(value * 10) / 10, reachedAt };
}

const goalOf = (spec) => (spec.kind === 'target' ? spec.target.amount : spec.kind === 'routine' ? spec.routine.times : null);

/**
 * The result, from the challenger's (from) and the challenged's (to) side:
 * 'from' | 'to' | 'draw', or null while it's still on. Points races only end
 * with the time; a target or routine also ends as soon as someone gets there.
 */
function decide(spec, from, to, ended) {
  if (spec.kind !== 'points') {
    const a = from.reachedAt, b = to.reachedAt;
    if (a != null || b != null) {
      if (a != null && (b == null || a < b)) return 'from';
      if (b != null && (a == null || b < a)) return 'to';
      return 'draw';
    }
  }
  if (!ended) return null;
  return from.value > to.value ? 'from' : to.value > from.value ? 'to' : 'draw';
}

/** the points that move: the stake, no more than the loser has, nor past the weekly cap */
function transfer(stake, loserPoints, wonFromThemThisWeek) {
  return Math.max(0, Math.min(stake, Math.max(0, loserPoints), WEEKLY_FROM_ONE - Math.max(0, wonFromThemThisWeek)));
}

module.exports = {
  KINDS, DAYS, STAKES, TARGETS, FORFEIT_MAX, SET_REPS, DAY_REPS, WEEKLY_FROM_ONE, STAKE_MIN_AGE_DAYS,
  cleanSpec, progress, decide, transfer, goalOf,
};
