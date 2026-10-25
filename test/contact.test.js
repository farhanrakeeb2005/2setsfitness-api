// Website contact form: what's accepted, bot checks, the email it becomes.
// No SMTP, no database. `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanContact, looksLikeBot, contactEmail, TOPICS } = require('../src/lib/contact');

const good = { name: '  Alex  Smith ', email: 'alex@example.com', topic: TOPICS[1], message: 'The timer stops when I lock my phone.' };

test('a proper message is accepted and tidied', () => {
  const c = cleanContact(good);
  assert.equal(c.ok, true);
  assert.equal(c.value.name, 'Alex Smith');
  assert.equal(c.value.topic, 'Something is broken');
});

test('missing or bad fields are refused with a message to show', () => {
  assert.match(cleanContact({ ...good, name: '' }).error, /name/);
  assert.match(cleanContact({ ...good, email: 'nope' }).error, /email/);
  assert.match(cleanContact({ ...good, message: 'hi' }).error, /message/);
  assert.match(cleanContact({ ...good, message: 'x'.repeat(4001) }).error, /4000/);
  assert.match(cleanContact({ ...good, name: 'n'.repeat(81) }).error, /long/);
});

test('an unknown topic falls back to the first', () => {
  assert.equal(cleanContact({ ...good, topic: 'spam' }).value.topic, TOPICS[0]);
});

test('bots: the hidden field filled, or sent too fast', () => {
  assert.equal(looksLikeBot({ website: 'http://x', ms: 9000 }), true);
  assert.equal(looksLikeBot({ website: '', ms: 800 }), true);
  assert.equal(looksLikeBot({ website: '', ms: 9000 }), false);
  assert.equal(looksLikeBot({}), true);
});

test('the email: escaped, reply goes to the sender, no header injection', () => {
  const m = contactEmail({ ...cleanContact(good).value, name: 'Eve"\r\nBcc: x@y.z', message: '<img src=x onerror=alert(1)>' });
  assert.ok(!m.html.includes('<img'));
  assert.ok(m.html.includes('&lt;img'));
  assert.ok(!/[\r\n]/.test(m.replyTo));
  assert.ok(m.replyTo.endsWith('<alex@example.com>'));
  assert.match(m.subject, /Something is broken/);
});
