const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/lib/challengeRules');

const H = (ts, name, exercises) => ({ id: String(ts), ts, name, exercises });
const set = (r, done = true) => ({ w: 0, r, done });
const day = 864e5, T0 = 1_800_000_000_000;

test('a challenge body: defaults to a 7-day points race, rejects what is not on offer', () => {
  assert.deepEqual(R.cleanSpec({}).spec, { kind: 'points', days: 7, stake: 0, forfeit: null, target: null, routine: null });
  assert.equal(R.cleanSpec({ days: 5 }).error, 'Invalid days');
  assert.equal(R.cleanSpec({ stake: 30 }).error, 'Invalid stake');
  assert.equal(R.cleanSpec({ forfeit: 'x'.repeat(61) }).error, 'Forfeit too long');
  assert.equal(R.cleanSpec({ kind: 'target', target: { key: 'pushups', amount: 3 } }).error, 'Invalid amount');
  assert.equal(R.cleanSpec({ kind: 'target', target: { key: 'planks', amount: 30 } }).error, 'Invalid target');
  assert.deepEqual(R.cleanSpec({ kind: 'target', days: 3, stake: 25, forfeit: ' Loser buys the shakes ', target: { key: 'run', amount: 10.04 } }).spec,
    { kind: 'target', days: 3, stake: 25, forfeit: 'Loser buys the shakes', target: { key: 'run', unit: 'km', amount: 10 }, routine: null });
  assert.equal(R.cleanSpec({ kind: 'routine', routine: { name: 'Leg Day', exercises: [] } }).error, 'Invalid routine');
});

test('reps: done sets of the matching exercise inside the window, capped per set and per day', () => {
  const spec = R.cleanSpec({ kind: 'target', target: { key: 'pushups', amount: 100 } }).spec;
  const history = [
    H(T0 - 1, 'Before', [{ name: 'Push-up', sets: [set(50)] }]),                       // before it began
    H(T0 + 10, 'Chest', [{ name: 'Push-ups', sets: [set(30), set(20, false)] }, { name: 'Bench press', sets: [set(10)] }]),
    H(T0 + 20, 'Silly', [{ name: 'Press-up', sets: [set(5000)] }]),                     // a set counts for 100
  ];
  assert.deepEqual(R.progress(spec, { history }, T0, T0 + 7 * day), { value: 130, reachedAt: T0 + 20 });
  const lots = Array.from({ length: 12 }, (_, i) => H(T0 + i, 'x', [{ name: 'Push-up', sets: [set(100)] }]));
  const big = R.cleanSpec({ kind: 'target', target: { key: 'pushups', amount: 5000 } }).spec;
  assert.equal(R.progress(big, { history: lots }, T0, T0 + day).value, R.DAY_REPS);
});

test('km: logged sport distance; a routine: a workout of that name with every exercise done', () => {
  const run = R.cleanSpec({ kind: 'target', target: { key: 'run', amount: 10 } }).spec;
  const sports = [{ ts: T0 + 5, sport: 'Running', km: 6 }, { ts: T0 + 9, sport: 'Cycling', km: 30 }, { ts: T0 + 50, sport: 'Running', km: 4.5 }];
  assert.deepEqual(R.progress(run, { sports }, T0, T0 + day), { value: 10.5, reachedAt: T0 + 50 });
  const legs = R.cleanSpec({ kind: 'routine', routine: { name: 'Leg Day', exercises: ['Squat', 'Calf raise'], times: 2 } }).spec;
  const history = [
    H(T0 + 1, 'Leg Day', [{ name: 'Squat', sets: [set(5)] }, { name: 'Calf raise', sets: [set(10, false)] }]),   // calf raise not done
    H(T0 + 2, 'leg day', [{ name: 'Squat', sets: [set(5)] }, { name: 'Calf raise', sets: [set(10)] }]),
    H(T0 + 3, 'Leg Day', [{ name: 'squat', sets: [set(5)] }, { name: 'Calf Raise', sets: [set(10)] }]),
  ];
  assert.deepEqual(R.progress(legs, { history }, T0, T0 + day), { value: 2, reachedAt: T0 + 3 });
});

test('first to the goal wins; at the end the closest wins; level is a draw', () => {
  const spec = { kind: 'target' };
  assert.equal(R.decide(spec, { value: 100, reachedAt: 5 }, { value: 100, reachedAt: 9 }, false), 'from');
  assert.equal(R.decide(spec, { value: 40, reachedAt: null }, { value: 100, reachedAt: 9 }, false), 'to');
  assert.equal(R.decide(spec, { value: 40, reachedAt: null }, { value: 60, reachedAt: null }, false), null);
  assert.equal(R.decide(spec, { value: 80, reachedAt: null }, { value: 60, reachedAt: null }, true), 'from');
  assert.equal(R.decide(spec, { value: 60, reachedAt: null }, { value: 60, reachedAt: null }, true), 'draw');
  assert.equal(R.decide({ kind: 'points' }, { value: 90 }, { value: 10 }, false), null, 'a points race runs to the end');
});

test('the stake moved: no more than the loser has, nor past 100 a week off the same player', () => {
  assert.equal(R.transfer(50, 1000, 0), 50);
  assert.equal(R.transfer(50, 20, 0), 20);
  assert.equal(R.transfer(100, 1000, 75), 25);
  assert.equal(R.transfer(25, 1000, 100), 0);
});
