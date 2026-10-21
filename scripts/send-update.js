// Emails everyone who has update emails on. Dry run unless you pass --send.
//   node scripts/send-update.js "Subject" "First paragraph.\n\nSecond paragraph." [--send] [--to someone@example.com]
// Needs DATABASE_URL, JWT_SECRET, PUBLIC_API_URL, GMAIL_USER, GMAIL_APP_PASSWORD (.env or the environment).
// Gmail allows about 500 emails a day, so a big list is sent over several days.
require('dotenv').config();
const pool = require('../src/db');
const mail = require('../src/lib/mailer');

(async () => {
  const args = process.argv.slice(2);
  const real = args.includes('--send');
  const toIdx = args.indexOf('--to');
  const only = toIdx >= 0 ? args[toIdx + 1] : null;
  const [subject, body] = args.filter((a, i) => !a.startsWith('--') && i !== toIdx + 1);
  if (!subject || !body) { console.log('usage: send-update.js "Subject" "Body" [--send] [--to email]'); process.exit(1); }
  if (real && (!process.env.PUBLIC_API_URL || !process.env.JWT_SECRET)) { console.log('Set PUBLIC_API_URL and JWT_SECRET first'); process.exit(1); }
  const { rows } = await pool.query(
    "SELECT id, email, name FROM users WHERE email_updates AND email NOT LIKE '%@firebase.local'" + (only ? ' AND email = $1' : ''),
    only ? [only] : []);
  console.log(`${rows.length} recipients${real ? '' : ' (dry run: nothing sent, add --send)'}`);
  let sent = 0;
  for (const u of rows) {
    if (!real) { console.log('would send to', u.email); continue; }
    try {
      const r = await mail.send(u.email, mail.updateEmail(u.name, subject, body.replace(/\\n/g, '\n'), u.id), u.id);
      if (r.sent) sent += 1;
    } catch (e) { console.log('failed', u.email, e.message); }
  }
  if (real) console.log('sent', sent);
  await pool.end();
})();
