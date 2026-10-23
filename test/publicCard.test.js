// Public player profiles: the card other players see is rebuilt from known
// fields with fixed limits, whatever the client sends. `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanCard, cleanPhoto, cleanEmoji } = require('../src/lib/publicCard');

test('keeps the known fields, drops the rest', () => {
  const c = cleanCard({
    gender: 'male', avatar: { skinTone: '#8D5524', kitColor: 'red', hair3d: 'afro01', legs: 'shorts', extra: '#FFFFFF' },
    workouts: 42.4, sportSessions: -3, streak: 5, bestStreak: 12, records: 4,
    topSports: [{ name: 'Football', emoji: '⚽', count: 7, minutes: 600 }],
    topExercises: [{ name: 'Bench Press', count: 20 }],
    main: 'gym', goal: 'muscle', level: 'beginner', secret: 'x',
  });
  assert.deepEqual(c, {
    v: 1, gender: 'male', avatar: { skinTone: '#8D5524', hair3d: 'afro01', legs: 'shorts' },
    workouts: 42, sportSessions: 0, sportMinutes: 0, streak: 5, bestStreak: 12, records: 4,
    topSports: [{ name: 'Football', count: 7, emoji: '⚽', minutes: 600 }],
    topExercises: [{ name: 'Bench Press', count: 20 }],
    main: 'gym', goal: 'muscle', level: 'beginner',
  });
});

test('no markup, long text or long lists', () => {
  const c = cleanCard({
    avatar: { hair3d: '../../etc' },
    topExercises: [{ name: '<img src=x onerror=alert(1)>Squat' }, { name: 'x'.repeat(500), count: 1e12 }, { name: 'A' }, { name: 'B' }],
    topSports: ['Football', null, { name: '' }],
    main: 'admin', goal: { $ne: 1 },
  });
  assert.equal(c.avatar, null);
  assert.equal(c.topExercises.length, 3);
  assert.equal(c.topExercises[0].name, 'img src=x onerror=alert(1)Squat');
  assert.equal(c.topExercises[1].name.length, 60);
  assert.equal(c.topExercises[1].count, 100000);
  assert.deepEqual(c.topSports, []);
  assert.equal(c.main, null);
  assert.equal(c.goal, null);
});

test('not an object: no card', () => {
  for (const bad of [null, undefined, 'x', 5, [1, 2]]) assert.equal(cleanCard(bad), null);
});

test('photo: a small JPEG or PNG data URL only', () => {
  const ok = 'data:image/jpeg;base64,' + Buffer.from('jpeg').toString('base64');
  assert.equal(cleanPhoto(ok), ok);
  assert.equal(cleanPhoto('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(cleanPhoto('https://evil.example/x.jpg'), null);
  assert.equal(cleanPhoto('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.equal(cleanPhoto('data:image/jpeg;base64,' + 'A'.repeat(50000)), null);
  assert.equal(cleanPhoto(null), null);
  assert.equal(cleanEmoji('🔥'), '🔥');
  assert.equal(cleanEmoji('<b>'), 'b');
});
