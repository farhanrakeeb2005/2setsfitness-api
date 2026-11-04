// How many points an account can believably have. Points are worked out on
// the phone and reported (PUT /points), so a modified app or a script could
// claim any total. A real account earns well under DAILY_POINTS_CAP a day,
// and the app itself never counts more than that in a day (its
// src/lib/pointValues.js DAILY_POINTS_CAP, the same number:
// test/crossRepo.test.js), so the leaderboard holds at most that much per
// day since the account was made; a bigger claim (a long history brought
// over from guest use) is stored at the cap and catches up over the
// following days. A lower claim is stored as it is (the app's rules can
// take points back: the sports caps, 4 Nov 2026).
//
// The allowance was 2000 a day; from CAP_CHANGED_FROM 800, and from
// CAP_LOWERED_FROM 500. Each day keeps the allowance it had when it began,
// so no total stored under an older cap is ever cut by a change.
const DAILY_POINTS_CAP = 500;
const OLD_DAILY_POINTS_CAP = 2000;
const CAP_CHANGED_FROM = Date.UTC(2026, 10, 1);   // 1 Nov 2026: 800
const MID_DAILY_POINTS_CAP = 800;
const CAP_LOWERED_FROM = Date.UTC(2026, 10, 4);   // 4 Nov 2026: 500
const DAY_MS = 864e5;
// [from (ms), the allowance of a day starting then], oldest first
const CAP_STEPS = [[-Infinity, OLD_DAILY_POINTS_CAP], [CAP_CHANGED_FROM, MID_DAILY_POINTS_CAP], [CAP_LOWERED_FROM, DAILY_POINTS_CAP]];

/** the allowance of a day that starts at `ms` */
function capOfDay(ms) {
  let cap = CAP_STEPS[0][1];
  for (const [from, c] of CAP_STEPS) if (ms >= from) cap = c;
  return cap;
}

/** the allowance of `days` days, the first starting at `first` (ms), a day apart */
function allowance(first, days) {
  let total = 0;
  for (let k = 0; k < CAP_STEPS.length; k++) {
    const lo = CAP_STEPS[k][0];
    const hi = k + 1 < CAP_STEPS.length ? CAP_STEPS[k + 1][0] : Infinity;
    // the days i in [0, days) with lo <= first + i*DAY < hi
    const a = lo === -Infinity ? 0 : Math.min(days, Math.max(0, Math.ceil((lo - first) / DAY_MS)));
    const b = hi === Infinity ? days : Math.min(days, Math.max(0, Math.ceil((hi - first) / DAY_MS)));
    if (b > a) total += (b - a) * CAP_STEPS[k][1];
  }
  return total;
}

function pointsCap(createdAt, now = Date.now()) {
  const made0 = createdAt ? new Date(createdAt).getTime() : now;
  const made = Number.isFinite(made0) ? made0 : now;
  const days = Math.max(1, Math.ceil((now - made + 1) / DAY_MS));
  // day i of the account starts at made + i days, with that day's allowance
  return allowance(made, days);
}

// the total to store for a claim
function cappedPoints(points, createdAt, now = Date.now()) {
  return Math.max(0, Math.min(Math.round(Number(points) || 0), pointsCap(createdAt, now)));
}

// A day's rise. The age cap above allows a big jump at once on an old
// account (a total that never used its allowance), so the total also can't
// rise by more than each UTC day's allowance since the last day it was
// reported: the first report of a day fixes that day's ceiling (the total
// stored before it, plus the allowance of every day since), and every report
// that day is held to it. An account's first report ever has only the age cap.
// state: { points (stored now), day ('YYYY-MM-DD' of the last report, or
// null), dayMax (that day's ceiling, or null) }. Returns { limit (the most
// the total may be now), day, dayMax (to store) }.
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);
function dayLimit({ points = 0, day = null, dayMax = null } = {}, now = Date.now()) {
  const today = dayStr(now);
  const max = Number(dayMax);
  if (day === today && dayMax != null && Number.isFinite(max)) return { limit: max, day: today, dayMax: max };
  const last = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00Z`) : NaN;
  if (!Number.isFinite(last)) return { limit: Infinity, day: today, dayMax: null };
  const days = Math.max(1, Math.round((Date.parse(`${today}T00:00:00Z`) - last) / DAY_MS));
  // the days after the last report's, up to today, each with its allowance
  const limit = Math.max(0, Math.round(Number(points) || 0)) + allowance(last + DAY_MS, days);
  return { limit, day: today, dayMax: limit };
}

/**
 * The total to store for a claim, held to the account's age (cappedPoints)
 * and to the day's rise (dayLimit): { stored, day, dayMax, clamped }.
 * A first report ever sets the day's ceiling at what's stored plus today's
 * allowance. A claim below what's stored is stored as it is.
 */
function reportedPoints(claim, createdAt, state = {}, now = Date.now()) {
  const aged = cappedPoints(claim, createdAt, now);
  const lim = dayLimit(state, now);
  const stored = Math.min(aged, lim.limit);
  const dayMax = lim.dayMax == null ? stored + capOfDay(Date.parse(`${lim.day}T00:00:00Z`)) : lim.dayMax;
  return { stored, day: lim.day, dayMax, clamped: Math.max(0, Math.round(Number(claim) || 0)) > stored };
}

module.exports = {
  DAILY_POINTS_CAP, OLD_DAILY_POINTS_CAP, MID_DAILY_POINTS_CAP, CAP_CHANGED_FROM, CAP_LOWERED_FROM, CAP_STEPS,
  capOfDay, pointsCap, cappedPoints, dayLimit, reportedPoints,
};
