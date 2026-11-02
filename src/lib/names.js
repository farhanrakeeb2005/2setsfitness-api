// Players' names. An account made before its owner typed a name (an email
// sign-up, until setup's name step) holds the placeholder 'Athlete'
// (db/schema.sql); those aren't shown to other players (leaderboard, name
// search) until a real name arrives.
const PLACEHOLDER = 'Athlete';
const { checkName, okName } = require('./nameCheck');

// A name typed for this account (PUT /profile's name): undefined when none
// was given (absent, blank or the placeholder: the stored one stays), else
// { name } (tidied) or { reason } when it fails lib/nameCheck.js
function nameUpdate(n) {
  const s = typeof n === 'string' ? n.trim() : '';
  if (!s || s === PLACEHOLDER) return undefined;
  const r = checkName(s);
  return r.ok ? { name: r.name } : { reason: r.reason, name: r.name };
}

// The name other players see (leaderboard, friends, challenges, profiles,
// notifications): the stored name when it passes lib/nameCheck.js, else
// "Athlete" and the first 4 characters of the public id ("Athlete 3F2A"): a
// Google account's name or one saved before the check isn't shown, and the
// stored row isn't changed
const shownName = (n, publicId) => {
  const ok = okName(n);
  if (ok) return ok;
  const tag = String(publicId || '').replace(/[^0-9a-f]/gi, '').slice(0, 4).toUpperCase();
  return tag ? `${PLACEHOLDER} ${tag}` : PLACEHOLDER;
};

// SQL: the users row <alias> has a real name
const NAMED = (alias) => `btrim(${alias}.name) NOT IN ('', '${PLACEHOLDER}')`;

module.exports = { PLACEHOLDER, NAMED, nameUpdate, shownName };
