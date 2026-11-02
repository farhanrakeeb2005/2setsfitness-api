const { test } = require('node:test');
const assert = require('node:assert/strict');
const { message, pushData } = require('../src/lib/push');

// FCM takes strings only; the app opens the page from type / challengeId / playerId
test('push data is all strings, the kind as type, nothing empty', () => {
  assert.deepEqual(pushData('won', { challengeId: 'abc' }), { type: 'won', challengeId: 'abc' });
  assert.deepEqual(pushData('challenged', { challengeId: 12 }), { type: 'challenged', challengeId: '12' });
  assert.deepEqual(pushData('friendAccepted', { open: 'player', playerId: 'f'.repeat(32), playerName: 'Sam', gone: null, none: undefined }),
    { type: 'friendAccepted', open: 'player', playerId: 'f'.repeat(32), playerName: 'Sam' });
  assert.equal(pushData('lost', { type: 'won' }).type, 'lost');
  assert.deepEqual(pushData('draw'), { type: 'draw' });
  for (const v of Object.values(pushData('accepted', { a: 1, b: true }))) assert.equal(typeof v, 'string');
});

test('challenge notifications read in the phone language, English otherwise', () => {
  assert.deepEqual(message('challenged', 'en', 'Sam'), { title: 'New challenge', body: 'Sam challenged you. Open it to see the challenge and accept.' });
  assert.equal(message('accepted', 'de', 'Sam').title, 'Herausforderung angenommen');
  assert.equal(message('challenged', 'xx', 'Sam').title, 'New challenge');
  assert.ok(message('challenged', 'zh-CN', 'Sam').body.includes('Sam'));
});

test('a result names the forfeit owed; forfeit messages quote it', () => {
  assert.deepEqual(message('won', 'en', 'Sam', 'Loser does 50 burpees'),
    { title: 'You won!', body: 'You beat Sam in your challenge. They owe you: Loser does 50 burpees' });
  assert.equal(message('lost', 'en', 'Sam', 'Loser does 50 burpees').body, 'Sam won this one. You owe: Loser does 50 burpees');
  assert.equal(message('lost', 'en', 'Sam').body, 'Sam won this one.');
  assert.ok(message('forfeitNudge', 'de', 'Sam', 'X').body.includes('X'));
  assert.ok(message('forfeitDone', 'so', 'Sam', 'X').body.includes('Sam'));
  assert.equal(message('draw', 'xx', 'Sam').title, "It's a draw");
});

test('friend requests and acceptances notify in the phone language', () => {
  assert.deepEqual(message('friendRequest', 'en', 'Sam'), { title: 'Friend request', body: 'Sam wants to be your friend. Open the app to accept.' });
  assert.equal(message('friendAccepted', 'de', 'Sam').title, 'Neuer Freund');
  assert.ok(message('friendAccepted', 'zh-CN', 'Sam').body.includes('Sam'));
  assert.equal(message('friendRequest', 'xx', 'Sam').title, 'Friend request');
});
