// Security rules: which pages may call the API from a browser, and which
// accounts the API accepts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { allowed } = require('../src/lib/corsOrigins');
const { emailOk } = require('../src/lib/accountRules');

test('browsers: only our own pages', () => {
  assert.equal(allowed('https://fitness-app-5c48a.web.app'), true);
  assert.equal(allowed('https://farhanrakeeb2005.github.io'), true);
  assert.equal(allowed('http://localhost:8081'), true);
  assert.equal(allowed(undefined), true);                       // the phone app sends no Origin
  assert.equal(allowed('https://evil.example'), false);
  assert.equal(allowed('https://fitness-app-5c48a.web.app.evil.example'), false);
  assert.equal(allowed('http://localhost.evil.example'), false);
  assert.equal(allowed('https://other.example', { CORS_ORIGINS: 'https://other.example' }), true);
});

test('accounts: email/password ones only once the address is confirmed', () => {
  assert.equal(emailOk({ firebase: { sign_in_provider: 'password' }, email_verified: false }), false);
  assert.equal(emailOk({ firebase: { sign_in_provider: 'password' }, email_verified: true }), true);
  assert.equal(emailOk({ firebase: { sign_in_provider: 'google.com' }, email_verified: true }), true);
  assert.equal(emailOk({ firebase: { sign_in_provider: 'phone' } }), true);
});
