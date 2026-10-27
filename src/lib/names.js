// Players' names. An account made before its owner typed a name (an email
// sign-up, until setup's name step) holds the placeholder 'Athlete'
// (db/schema.sql); those aren't shown to other players (leaderboard, name
// search) until a real name arrives.
const PLACEHOLDER = 'Athlete';

// a usable name, else null (blank, or the placeholder)
const realName = (n) => {
  const s = typeof n === 'string' ? n.trim().slice(0, 60) : '';
  return s && s !== PLACEHOLDER ? s : null;
};

// SQL: the users row <alias> has a real name
const NAMED = (alias) => `btrim(${alias}.name) NOT IN ('', '${PLACEHOLDER}')`;

module.exports = { PLACEHOLDER, realName, NAMED };
