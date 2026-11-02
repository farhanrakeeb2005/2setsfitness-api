// lib/sql.js: the shared points SQL and public id check. `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { effectiveSql, EFFECTIVE_SQL, PUBLIC_ID } = require('../src/lib/sql');

test('effective points SQL: with and without a table alias', () => {
  assert.equal(EFFECTIVE_SQL, 'GREATEST(0, COALESCE(points, 0) + COALESCE(challenge_pts, 0))');
  assert.equal(effectiveSql('p'), 'GREATEST(0, COALESCE(p.points, 0) + COALESCE(p.challenge_pts, 0))');
});

test('public id: 32 lowercase hex only', () => {
  assert.ok(PUBLIC_ID.test('0123456789abcdef0123456789abcdef'));
  for (const bad of ['', '0123456789ABCDEF0123456789ABCDEF', '0123456789abcdef0123456789abcde', '0123456789abcdef0123456789abcdef0', "x' OR 1=1 --"]) {
    assert.equal(PUBLIC_ID.test(bad), false, bad);
  }
});
