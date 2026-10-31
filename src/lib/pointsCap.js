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

module.exports = { DAILY_POINTS_CAP, OLD_DAILY_POINTS_CAP, CAP_CHANGED_FROM, pointsCap, cappedPoints };
