// Welcome / update emails: HTML-escaping, unsubscribe links, who gets mail.
// No SMTP, no database. `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const mailer = require('../src/lib/mailer');

test('real addresses only: Firebase placeholders and junk are skipped', () => {
  assert.equal(mailer.realEmail('a@b.co'), true);
  assert.equal(mailer.realEmail('abc123@firebase.local'), false);
  assert.equal(mailer.realEmail('no-at-sign'), false);
  assert.equal(mailer.realEmail(undefined), false);
});

test('a name cannot inject HTML into the email', () => {
  const m = mailer.welcomeEmail('<script>alert(1)</script> Bob', 'uid1');
  assert.ok(!m.html.includes('<script>'));
  assert.ok(m.html.includes('&lt;script&gt;'));
  assert.ok(m.subject.startsWith('Welcome to 2SetsFitness'));
});

test('unsubscribe token: valid for its user only, not guessable from another', () => {
  const t = mailer.unsubToken('u1', 'secret');
  assert.equal(mailer.unsubValid('u1', t, 'secret'), true);
  assert.equal(mailer.unsubValid('u2', t, 'secret'), false);
  assert.equal(mailer.unsubValid('u1', t, 'other-secret'), false);
  assert.equal(mailer.unsubValid('u1', '', 'secret'), false);
  assert.equal(mailer.unsubValid('u1', undefined, 'secret'), false);
});

test('update email: paragraphs, escaped body, unsubscribe link in the footer', () => {
  process.env.JWT_SECRET = 'secret';
  process.env.PUBLIC_API_URL = 'https://api.example.com';
  const m = mailer.updateEmail('Sam Lee', 'New: Friends <beta>', 'One.\n\nTwo & three.', 'u1');
  assert.ok(m.html.includes('Hi Sam,'));
  assert.ok(m.html.includes('Two &amp; three.'));
  assert.ok(m.html.includes('New: Friends &lt;beta&gt;'));
  assert.ok(m.html.includes('https://api.example.com/email/unsubscribe?u=u1&amp;t='));
});

test('nothing is sent without Gmail settings', async () => {
  delete process.env.GMAIL_USER; delete process.env.GMAIL_APP_PASSWORD;
  assert.deepEqual(await mailer.send('a@b.co', { subject: 's', html: 'h' }, 'u1'), { sent: false });
});
