// The points-farming gaps closed on 4 Nov 2026: the day's rise with no day
// stored, unreported days banking up, a dip before a race, challenge points
// fed by spare accounts, target races from untimed workouts, and cardio
// minutes past a workout's time. `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dayLimit, reportedPoints, raceStartPoints, CATCH_UP_DAYS, DAILY_POINTS_CAP } = require('../src/lib/pointsCap');
const R = require('../src/lib/challengeRules');
const P = require('../src/lib/plausibility');

const at = (iso) => Date.parse(iso);
const DAY = 864e5;

test('fix 1: no day stored counts as reported yesterday, never the age allowance at once', () => {
  // an account made in 2025 (thousands a day of allowance), never reported a day
  const r = reportedPoints(50000, '2025-01-01', { points: 2000, day: null, dayMax: null }, at('2026-11-10T09:00:00Z'));
  assert.equal(r.stored, 2000 + DAILY_POINTS_CAP);
  assert.equal(r.clamped, true);
  // a bad day string is the same as none
  assert.equal(dayLimit({ points: 10, day: 'nope' }, at('2026-11-10T09:00:00Z')).limit, 10 + DAILY_POINTS_CAP);
});

test('fix 2: unreported days bank up for 3 days at most', () => {
  assert.equal(CATCH_UP_DAYS, 3);
  const state = (day) => ({ points: 1000, day, dayMax: 1000 });
  const now = at('2026-12-10T12:00:00Z');
  assert.equal(dayLimit(state('2026-12-09'), now).limit, 1000 + 500);
  assert.equal(dayLimit(state('2026-12-08'), now).limit, 1000 + 1000);
  assert.equal(dayLimit(state('2026-12-07'), now).limit, 1000 + 1500);
  // 30 quiet days: still 3 days' worth, not 15,000
  assert.equal(dayLimit(state('2026-11-10'), now).limit, 1000 + 1500);
  assert.equal(reportedPoints(99999, '2025-01-01', state('2026-11-10'), now).stored, 2500);
});

test('fix 3: report 0, then climb back: no further today than earning, and a race starts from the peak', () => {
  const t = at('2026-11-10T08:00:00Z');
  const first = reportedPoints(3000, '2025-01-01', { points: 3000, day: '2026-11-09', dayMax: 3400 }, t);
  assert.deepEqual([first.stored, first.dayMax, first.peak], [3000, 3500, 3000]);
  const dip = reportedPoints(0, '2025-01-01', { points: first.stored, day: first.day, dayMax: first.dayMax, peak: first.peak }, t + 1000);
  assert.deepEqual([dip.stored, dip.dayMax, dip.peak], [0, DAILY_POINTS_CAP, 3000]);
  const back = reportedPoints(3000, '2025-01-01', { points: 0, day: dip.day, dayMax: dip.dayMax, peak: dip.peak }, t + 2000);
  assert.equal(back.stored, DAILY_POINTS_CAP, 'held to the lowered ceiling');
  // a race accepted during the dip starts from the peak: climbing back is no gain
  assert.equal(raceStartPoints(0, 3000), 3000);
  assert.equal(raceStartPoints(3200, 3000), 3200);
  assert.equal(raceStartPoints(500, null), 500);
});

test('fix 4: a winner takes at most 150 a week from everyone together, and 100 from one player', () => {
  assert.equal(R.WEEKLY_WON_MAX, 150);
  assert.equal(R.transfer(100, 1000, 0, 0), 100);
  assert.equal(R.transfer(100, 1000, 0, 100), 50);     // a second spare account: only 50 more
  assert.equal(R.transfer(100, 1000, 0, 150), 0);      // a third: nothing
  assert.equal(R.transfer(100, 1000, 75, 75), 25);     // the per-player cap still holds
});

test('fix 4: stakes need a week-old account and 3 live logs in the last 14 days', () => {
  const now = at('2026-11-20T12:00:00Z');
  const logs = (n, extra = {}, ago = DAY) => Array.from({ length: n }, (_, i) => ({ id: `w${i}`, ts: now - ago - i * 3600e3, ...extra }));
  const old = new Date(now - 30 * DAY);
  assert.equal(R.STAKE_MIN_AGE_DAYS, 7);
  assert.equal(R.stakeReady(old, { history: logs(3) }, now), true);
  assert.equal(R.stakeReady(old, { history: logs(2), sports: logs(1) }, now), true);
  assert.equal(R.stakeReady(new Date(now - 6 * DAY), { history: logs(10) }, now), false, 'six days old');
  assert.equal(R.stakeReady(old, { history: logs(5, { imported: true }) }, now), false, 'imports');
  assert.equal(R.stakeReady(old, { history: logs(5, { late: true }) }, now), false, '"Forgot to log"');
  assert.equal(R.stakeReady(old, { history: logs(5, {}, 15 * DAY) }, now), false, 'over 14 days ago');
  assert.equal(R.stakeReady(old, { history: logs(5, {}, -DAY) }, now), false, 'in the future');
  assert.equal(R.stakeReady(null, { history: logs(5) }, now), false);
});

test('fix 12: from 4 Nov a target race counts only timed workouts, reps held to their minutes', () => {
  const spec = R.cleanSpec({ kind: 'target', target: { key: 'pushups', amount: 1000 } }).spec;
  const T = at('2026-11-10T12:00:00Z');
  const push = (r, n = 1) => [{ name: 'Push-up', sets: Array.from({ length: n }, () => ({ w: 0, r, done: true })) }];
  // typed with no timing: nothing
  assert.equal(R.progress(spec, { history: [{ id: 'a', ts: T, exercises: push(50) }] }, T - DAY, T + DAY, T + DAY).value, 0);
  // timed: counted
  const timed = { id: 'b', ts: T, startedAt: T - 600e3, durationSec: 600, exercises: push(50) };
  assert.equal(R.progress(spec, { history: [timed] }, T - DAY, T + DAY, T + DAY).value, 50);
  // one set of 100 in a 1-minute workout (one set isn't paced): held to 57
  assert.equal(R.raceRepCap(60), 57);
  const quick = { id: 'c', ts: T, startedAt: T - 60e3, durationSec: 60, exercises: push(100) };
  assert.equal(P.raceWorkoutBlocked(quick), false);
  assert.equal(R.progress(spec, { history: [quick] }, T - DAY, T + DAY, T + DAY).value, 57);
  // older workouts keep counting as they did
  const before = { id: 'd', ts: at('2026-11-02T12:00:00Z'), exercises: push(40) };
  assert.equal(R.progress(spec, { history: [before] }, at('2026-11-01T00:00:00Z'), T, T).value, 40);
});

test('fix 5: cardio minutes past the workout\'s time are refused, even in one set', () => {
  const cardio = (min) => [{ name: 'Sprint intervals', track: 'cardio', sets: [{ r: min, done: true }] }];
  assert.equal(P.paceLevel(cardio(120), 60), 'block');     // the audit's probe: 120 min in a 1-minute workout
  assert.equal(P.paceLevel(cardio(20), 20 * 60), 'ok');
  assert.equal(P.paceLevel(cardio(21), 20 * 60), 'ok');    // a minute's slack
  assert.equal(P.paceLevel(cardio(22), 20 * 60), 'block');
  assert.equal(P.raceWorkoutBlocked({ durationSec: 60, exercises: cardio(120) }), true);
  assert.equal(P.cardioMinutes([{ name: 'Treadmill run', sets: [{ r: 10, done: true }, { r: 5, done: true, type: 'warmup' }] }]), 10);
});
