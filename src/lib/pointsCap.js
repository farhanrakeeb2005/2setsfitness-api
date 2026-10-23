// How many points an account can believably have. Points are worked out on
// the phone and reported (PUT /points), so a modified app or a script could
// claim any total. A real account earns well under DAILY_POINTS_CAP a day
// (a long workout is ~150, every daily log together a few hundred), so the
// leaderboard holds at most that much per day since the account was made; a
// bigger claim (a long history brought over from guest use) is stored at the
// cap and catches up over the following days.
const DAILY_POINTS_CAP = 2000;
const DAY_MS = 864e5;

function pointsCap(createdAt, now = Date.now()) {
  const made = createdAt ? new Date(createdAt).getTime() : now;
  const days = Math.max(1, Math.ceil(((Number.isFinite(made) ? now - made : 0) + 1) / DAY_MS));
  return days * DAILY_POINTS_CAP;
}

// the total to store for a claim
function cappedPoints(points, createdAt, now = Date.now()) {
  return Math.max(0, Math.min(Math.round(Number(points) || 0), pointsCap(createdAt, now)));
}

module.exports = { DAILY_POINTS_CAP, pointsCap, cappedPoints };
