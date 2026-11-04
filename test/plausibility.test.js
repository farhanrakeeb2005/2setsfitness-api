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
  const H = (ts, exercises, extra = {}) => ({ id: String(ts), ts, name: 'W', exercises, ...extra });
  const history = [
    H(T0 + 1, [{ name: 'Push-up', sets: sets(2, 20) }]),
    H(T0 + 2, [{ name: 'Push-up', sets: sets(1, 1000) }]),                                  // impossible
    H(T0 + 3, [{ name: 'Push-up', sets: sets(20, 50) }], { durationSec: 60 }),               // 20 sets in a minute
    H(T0 + 2 * day, [{ name: 'Push-up', sets: sets(1, 30) }]),                               // after "now"
  ];
  assert.deepEqual(R.progress(spec, { history }, T0, T0 + 7 * day, T0 + day), { value: 40, reachedAt: null });
  const run = R.cleanSpec({ kind: 'target', target: { key: 'run', amount: 10 } }).spec;
  const sports = [{ ts: T0 + 1, sport: 'Running', km: 5, duration: 30 }, { ts: T0 + 2, sport: 'Running', km: 40, duration: 30 }];
  assert.deepEqual(R.progress(run, { sports }, T0, T0 + day, T0 + day), { value: 5, reachedAt: null });
});

test('points: the total rises at most the daily cap a day since the last report', () => {
  const at = (iso) => Date.parse(iso);
  // the first report ever: the age cap only, and the day's ceiling set from it
  assert.deepEqual(dayLimit({}, at('2026-11-03T08:00:00Z')), { limit: Infinity, day: '2026-11-03', dayMax: null });
  const first = reportedPoints(3000, '2026-01-01', {}, at('2026-11-03T08:00:00Z'));
  assert.deepEqual(first, { stored: 3000, day: '2026-11-03', dayMax: 3000 + DAILY_POINTS_CAP, clamped: false });
  // the next day: what was stored plus one day's cap
  const next = reportedPoints(9000, '2026-01-01', { points: 3000, day: '2026-11-03', dayMax: 3800 }, at('2026-11-04T09:00:00Z'));
  assert.deepEqual(next, { stored: 3800, day: '2026-11-04', dayMax: 3800, clamped: true });
  // the same day again: held to the day's ceiling, however often it reports
  assert.equal(reportedPoints(4500, '2026-01-01', { points: 3800, day: '2026-11-04', dayMax: 3800 }, at('2026-11-04T20:00:00Z')).stored, 3800);
  assert.equal(reportedPoints(3500, '2026-01-01', { points: 3800, day: '2026-11-04', dayMax: 3800 }, at('2026-11-04T21:00:00Z')).stored, 3500);   // down: as reported
  // three days away: three days' cap
  assert.equal(reportedPoints(9000, '2026-01-01', { points: 3000, day: '2026-11-01', dayMax: 3100 }, at('2026-11-04T09:00:00Z')).stored, 3000 + 3 * DAILY_POINTS_CAP);
  // still under the account's age cap
  assert.equal(reportedPoints(9000, new Date(at('2026-11-04T00:00:00Z')), { points: 0, day: '2026-11-03', dayMax: 0 }, at('2026-11-04T09:00:00Z')).stored, DAILY_POINTS_CAP);
});
