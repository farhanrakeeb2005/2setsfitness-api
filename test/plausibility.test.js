// What a challenge race ignores (lib/plausibility.js, the app's rules) and
// how far a reported points total may rise in a day (lib/pointsCap.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/lib/plausibility');
const R = require('../src/lib/challengeRules');
const { dayLimit, reportedPoints, DAILY_POINTS_CAP } = require('../src/lib/pointsCap');

const sets = (n, r, extra = {}) => Array.from({ length: n }, () => ({ w: 0, r, done: true, ...extra }));
const day = 864e5, T0 = 1_800_000_000_000;

test('race: impossible reps, sets, set length and pace are ignored; unusual ones count', () => {
  assert.equal(P.raceWorkoutBlocked({ exercises: [{ name: 'Push-up', sets: sets(1, 300) }] }), false);
  assert.equal(P.raceWorkoutBlocked({ exercises: [{ name: 'Push-up', sets: sets(1, 301) }] }), true);
  assert.equal(P.raceWorkoutBlocked({ exercises: [{ name: 'Plank', sets: sets(1, 600) }] }), false);     // seconds
  assert.equal(P.raceWorkoutBlocked({ exercises: [{ name: 'Push-up', sets: sets(151, 10) }] }), true);
  // the Farhan Day example: 38 sets of 10, in 2 h fine, in 15 min impossible
  const farhan = Array.from({ length: 12 }, (_, i) => ({ name: `Lift ${i}`, sets: sets(i < 2 ? 4 : 3, 10) }));
  assert.equal(P.minWorkoutSec(farhan).sets, 38);
  assert.equal(P.paceLevel(farhan, 7200, { restSec: 90 }), 'ok');
  assert.equal(P.paceLevel(farhan, 1800, { restSec: 90 }), 'check');
  assert.equal(P.paceLevel(farhan, 900, { restSec: 90 }), 'block');
  assert.equal(P.raceWorkoutBlocked({ durationSec: 600, exercises: farhan }), true);
  assert.equal(P.raceWorkoutBlocked({ durationSec: 1800, exercises: farhan }), false);   // only asked in the app
  assert.equal(P.raceSportBlocked({ sport: 'Running', duration: 60, km: 26 }), true);
  assert.equal(P.raceSportBlocked({ sport: 'Running', duration: 60, km: 21 }), false);
  assert.equal(P.raceSportBlocked({ sport: 'Football', duration: 361 }), true);
  assert.equal(P.raceSportBlocked({ sport: 'Football', duration: 181 }), true);
  assert.equal(P.raceSportBlocked({ sport: 'Running', duration: 290 }), false);   // endurance: up to 5 h
  assert.equal(P.raceSportBlocked({ sport: 'MMA', duration: 151, intensity: 'hard' }), true);
});

test('race: warm-up sets are left out of the set count and the pace, but their reps are checked', () => {
  const warm = (n, r = 10) => sets(n, r, { type: 'warmup' });
  // 150 warm-ups and 5 work sets: 5 sets, not an impossible 155
  assert.equal(P.raceWorkoutBlocked({ exercises: [{ name: 'Push-up', sets: [...warm(150), ...sets(5, 10)] }] }), false);
  assert.equal(P.raceWorkoutBlocked({ exercises: [{ name: 'Push-up', sets: sets(155, 10) }] }), true);
  assert.deepEqual(P.minWorkoutSec([{ name: 'Push-up', sets: [...warm(10), ...sets(3, 10)] }]), P.minWorkoutSec([{ name: 'Push-up', sets: sets(3, 10) }]));
  // 10 warm-ups and 2 sets in 3 minutes is fine; 12 counted sets would be impossible
  assert.equal(P.paceLevel([{ name: 'Push-up', sets: [...warm(10), ...sets(2, 10)] }], 180), 'ok');
  assert.equal(P.paceLevel([{ name: 'Push-up', sets: sets(12, 10) }], 180), 'block');
  // an impossible warm-up is still impossible; drop and failure sets count as sets
  assert.equal(P.raceWorkoutBlocked({ exercises: [{ name: 'Push-up', sets: [...warm(1, 301), ...sets(1, 10)] }] }), true);
  assert.equal(P.raceWorkoutBlocked({ exercises: [{ name: 'Push-up', sets: sets(151, 10, { type: 'drop' }) }] }), true);
});

test('race progress skips impossible logs and logs in the future', () => {
  const spec = R.cleanSpec({ kind: 'target', target: { key: 'pushups', amount: 100 } }).spec;
  const H = (ts, exercises, extra = {}) => ({ id: String(ts), ts, name: 'W', exercises, startedAt: ts - 1800e3, durationSec: 1800, ...extra });
  const history = [
    H(T0 + 1, [{ name: 'Push-up', sets: sets(2, 20) }]),
    H(T0 + 2, [{ name: 'Push-up', sets: sets(1, 1000) }]),                                  // impossible
    H(T0 + 3, [{ name: 'Push-up', sets: sets(20, 50) }], { durationSec: 60 }),               // 20 sets in a minute
    H(T0 + 2 * day, [{ name: 'Push-up', sets: sets(1, 30) }]),                               // after "now"
  ];
  assert.deepEqual(R.progress(spec, { history }, T0, T0 + 7 * day, T0 + day), { value: 40, reachedAt: null });
  const run = R.cleanSpec({ kind: 'target', target: { key: 'run', amount: 10 } }).spec;
  const sports = [{ ts: T0 + 1, sport: 'Running', km: 5, duration: 30, startedAt: T0 - 3 * 3600e3 }, { ts: T0 + 2, sport: 'Running', km: 40, duration: 30, startedAt: T0 - 3600e3 }];
  assert.deepEqual(R.progress(run, { sports }, T0, T0 + day, T0 + day), { value: 5, reachedAt: null });
});

test('points: the total rises at most the daily cap a day since the last report', () => {
  const at = (iso) => Date.parse(iso);
  assert.equal(DAILY_POINTS_CAP, 500);
  // no day stored (the first report ever, or one from before days were
  // kept): as if reported yesterday, what's stored plus today's 500, never
  // the old account's whole allowance at once
  assert.deepEqual(dayLimit({}, at('2026-11-05T08:00:00Z')), { limit: DAILY_POINTS_CAP, day: '2026-11-05', dayMax: DAILY_POINTS_CAP });
  const first = reportedPoints(3000, '2026-01-01', {}, at('2026-11-05T08:00:00Z'));
  assert.deepEqual(first, { stored: DAILY_POINTS_CAP, day: '2026-11-05', dayMax: DAILY_POINTS_CAP, peak: DAILY_POINTS_CAP, clamped: true });
  assert.equal(reportedPoints(30000, '2025-01-01', { points: 1200, day: null, dayMax: null }, at('2026-11-05T08:00:00Z')).stored, 1700);
  // (a day from before 4 Nov keeps its 800)
  assert.equal(reportedPoints(3000, '2026-01-01', {}, at('2026-11-03T08:00:00Z')).dayMax, 800);
  // the next day: what was stored plus one day's cap
  const next = reportedPoints(9000, '2026-01-01', { points: 3000, day: '2026-11-05', dayMax: 3500 }, at('2026-11-06T09:00:00Z'));
  assert.deepEqual(next, { stored: 3500, day: '2026-11-06', dayMax: 3500, peak: 3500, clamped: true });
  // the same day again: held to the day's ceiling, however often it reports
  assert.equal(reportedPoints(4500, '2026-01-01', { points: 3500, day: '2026-11-06', dayMax: 3500 }, at('2026-11-06T20:00:00Z')).stored, 3500);
  assert.equal(reportedPoints(3200, '2026-01-01', { points: 3500, day: '2026-11-06', dayMax: 3500 }, at('2026-11-06T21:00:00Z')).stored, 3200);   // down: as reported
  // three days away, over the change: 2 and 3 Nov at 800, 4 Nov at 500
  assert.equal(reportedPoints(9000, '2026-01-01', { points: 3000, day: '2026-11-01', dayMax: 3100 }, at('2026-11-04T09:00:00Z')).stored, 3000 + 2 * 800 + 500);
  // still under the account's age cap
  assert.equal(reportedPoints(9000, new Date(at('2026-11-05T00:00:00Z')), { points: 0, day: '2026-11-04', dayMax: 0 }, at('2026-11-05T09:00:00Z')).stored, DAILY_POINTS_CAP);
  // a lower claim (the app's caps took points back) is stored as it is; the
  // day's ceiling comes down to it plus a day's 500, the peak stays
  const down = reportedPoints(560, '2026-10-20', { points: 1196, day: '2026-11-04', dayMax: 1196 }, at('2026-11-04T15:00:00Z'));
  assert.deepEqual(down, { stored: 560, day: '2026-11-04', dayMax: 1060, peak: 1196, clamped: false });
});
