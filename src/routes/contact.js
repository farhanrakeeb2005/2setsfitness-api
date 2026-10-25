// POST /contact: the website's contact form. No login. The message is saved
// (so nothing is lost if email is down) and emailed to the team's inbox with
// Reply-To set to the sender. Nothing is sent to the address the person typed,
// so the form can't be used to mail strangers.
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const mailer = require('../lib/mailer');
const { cleanContact, looksLikeBot, contactEmail } = require('../lib/contact');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages from here. Please try again in a few minutes.' },
});

router.post('/', limiter, async (req, res) => {
  // (bots get the same answer as people, so they don't learn to dodge the check)
  if (looksLikeBot(req.body)) return res.json({ ok: true });
  const c = cleanContact(req.body);
  if (!c.ok) return res.status(400).json({ error: c.error });
  try {
    await pool.query('INSERT INTO contact_messages (name, email, topic, message) VALUES ($1, $2, $3, $4)',
      [c.value.name, c.value.email, c.value.topic, c.value.message]);
  } catch (e) {
    console.error('contact: save failed', e.message);
    return res.status(500).json({ error: 'Could not send right now. Please email us instead.' });
  }
  const to = process.env.CONTACT_TO || process.env.GMAIL_USER;
  mailer.send(to, contactEmail(c.value)).catch((e) => console.error('contact: email failed', e.message));
  res.json({ ok: true });
});

module.exports = router;
