const { test } = require('node:test');
const assert = require('node:assert/strict');
const { message } = require('../src/lib/push');

test('challenge notifications read in the phone language, English otherwise', () => {
  assert.deepEqual(message('challenged', 'en', 'Sam'), { title: 'New challenge', body: 'Sam challenged you to a 7-day points race. Accept?' });
  assert.equal(message('accepted', 'de', 'Sam').title, 'Herausforderung angenommen');
  assert.equal(message('challenged', 'xx', 'Sam').title, 'New challenge');
  assert.ok(message('challenged', 'zh-CN', 'Sam').body.includes('Sam'));
});
