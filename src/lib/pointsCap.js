// How many points an account can believably have. Points are worked out on
// the phone and reported (PUT /points), so a modified app or a script could
// claim any total. A real account earns well under DAILY_POINTS_CAP a day
// (a long workout is ~150, every daily log together a few hundred), so the
// leaderboard holds at most that much per day since the account was made; a
// bigger claim (a long history brought over from guest use) is stored at the
// cap and catches up over the following days.
//
// The allowance was 2000 a day; from CAP_CHANGED_FROM it is 800. Days of an
// account's life before then keep 2000 each, so no total stored under the old
// cap is ever cut by the change.
const DAILY_POINTS_CAP = 800;
const OLD_DAILY_POINTS_CAP = 2000;
const CAP_CHANGED_FROM = Date.UTC(2026, 10, 1);   // 1 Nov 2026
const DAY_MS = 864e5;

function pointsCap(createdAt, now = Date.now()) {
  const made0 = createdAt ? new Date(createdAt).getTime() : now;
  const made = Number.isFinite(made0) ? made0 : now;
  const days = Math.max(1, Math.ceil((now - made + 1) / DAY_MS));
  // day i of the account starts at made + i days; those starting before the
  // change keep the old allowance
  const oldDays = Math.max(0, Math.min(days, Math.ceil((CAP_CHANGED_FROM - made) / DAY_MS)));
  return oldDays * OLD_DAILY_POINTS_CAP + (days - oldDays) * DAILY_POINTS_CAP;
}

// the total to store for a claim
function cappedPoints(points, createdAt, now = Date.now()) {
  return Math.max(0, Math.min(Math.round(Number(points) || 0), pointsCap(createdAt, now)));
}

// A day's rise. The age cap above allows a big jump at once on an old
// account (a total that never used its allowance), so the total also can't
// rise by more than DAILY_POINTS_CAP for each UTC day since the last day it
// was reported: the first report of a day fixes that day's ceiling (the total
// stored before it, plus the cap for every day since), and every report that
// day is held to it. An account's first report ever has only the age cap.
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
  const limit = Math.max(0, Math.round(Number(points) || 0)) + days * DAILY_POINTS_CAP;
  return { limit, day: today, dayMax: limit };
}

/**
 * The total to store for a claim, held to the account's age (cappedPoints)
 * and to the day's rise (dayLimit): { stored, day, dayMax, clamped }.
 * A first report ever sets the day's ceiling at what's stored plus the cap.
 */
function reportedPoints(claim, createdAt, state = {}, now = Date.now()) {
  const aged = cappedPoints(claim, createdAt, now);
  const lim = dayLimit(state, now);
  const stored = Math.min(aged, lim.limit);
  const dayMax = lim.dayMax == null ? stored + DAILY_POINTS_CAP : lim.dayMax;
  return { stored, day: lim.day, dayMax, clamped: Math.max(0, Math.round(Number(claim) || 0)) > stored };
}

module.exports = { DAILY_POINTS_CAP, OLD_DAILY_POINTS_CAP, CAP_CHANGED_FROM, pointsCap, cappedPoints, dayLimit, reportedPoints };
