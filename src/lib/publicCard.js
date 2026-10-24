// A player's public profile card, as other players see it (GET
// /profile/public/:id). The app works it out on the phone from the user's
// own logs (its src/lib/publicProfile.js) and sends it with PUT
// /profile/card; nothing else about the account is shown. Everything is
// rebuilt here from known fields with fixed limits, so a client can't store
// arbitrary JSON, long strings or markup for other players to load.

const HEX = /^#[0-9A-Fa-f]{6}$/;
const AVATAR_COLOURS = ['skinTone', 'hairColor', 'kitColor', 'hijabColor', 'bottomsColor', 'bootsColor', 'lowerColor'];
const MAX_COUNT = 100000;

// text without control characters or angle brackets, trimmed and cut to max
function text(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
  return s || null;
}
function count(v, max = MAX_COUNT) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
}

function cleanAvatar(a) {
  if (!a || typeof a !== 'object') return null;
  const out = {};
  for (const k of AVATAR_COLOURS) if (typeof a[k] === 'string' && HEX.test(a[k])) out[k] = a[k];
  if (typeof a.hair3d === 'string' && /^[a-z0-9]{2,12}$/.test(a.hair3d)) out.hair3d = a.hair3d;
  if (a.legs === 'shorts') out.legs = 'shorts';
  // a female player's choice to wear the hijab (off unless chosen)
  if (a.hijabOn === true) out.hijabOn = true;
  // the still pose on their profile
  if (['flex', 'crossed', 'hips', 'victory', 'wave'].includes(a.pose)) out.pose = a.pose;
  return Object.keys(out).length ? out : null;
}

function cleanList(list, withSport) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const it of list.slice(0, 3)) {
    if (!it || typeof it !== 'object') continue;
    const name = text(it.name, withSport ? 40 : 60);
    if (!name) continue;
    const row = { name, count: count(it.count) };
    if (withSport) {
      row.emoji = text(it.emoji, 8);
      row.minutes = count(it.minutes, 10_000_000);
    }
    out.push(row);
  }
  return out;
}

function cleanCard(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  return {
    v: 1,
    gender: c.gender === 'female' ? 'female' : c.gender === 'male' ? 'male' : null,
    avatar: cleanAvatar(c.avatar),
    workouts: count(c.workouts),
    sportSessions: count(c.sportSessions),
    sportMinutes: count(c.sportMinutes, 10_000_000),
    streak: count(c.streak, 10000),
    bestStreak: count(c.bestStreak, 10000),
    records: count(c.records, 10000),
    topSports: cleanList(c.topSports, true),
    topExercises: cleanList(c.topExercises, false),
    main: c.main === 'gym' || c.main === 'sport' ? c.main : null,
    goal: text(c.goal, 24),
    level: text(c.level, 24),
    // body weight in kg, only when the player chose to show it (app Settings)
    weightKg: Number(c.weightKg) >= 25 && Number(c.weightKg) <= 300 ? Math.round(Number(c.weightKg) * 10) / 10 : null,
  };
}

// the leaderboard picture: a small JPEG/PNG data URL (the app sends a 96 px
// thumbnail, ~5 KB), or nothing
const MAX_PHOTO = 40000;
function cleanPhoto(p) {
  if (typeof p !== 'string' || p.length > MAX_PHOTO) return null;
  return /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(p) ? p : null;
}
function cleanEmoji(e) {
  return text(e, 8);
}

module.exports = { cleanCard, cleanPhoto, cleanEmoji };
