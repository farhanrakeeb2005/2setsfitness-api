const { test } = require('node:test');
const assert = require('node:assert/strict');
const { message } = require('../src/lib/push');

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
