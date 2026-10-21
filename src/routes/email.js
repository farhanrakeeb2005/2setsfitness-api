const router = require('express').Router();
const pool = require('../db');
const { unsubValid } = require('../lib/mailer');

// One click from the footer of any email: no login needed, the link carries a
// signature of the user id.
router.get('/unsubscribe', async (req, res) => {
  const { u, t } = req.query;
  const page = (msg) => res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>2SetsFitness</title><body style="font-family:system-ui,sans-serif;max-width:30rem;margin:15vh auto;padding:0 20px;text-align:center"><h1>2SetsFitness</h1><p>${msg}</p></body>`);
  if (!u || !unsubValid(String(u), t)) return res.status(400).type('html').send('<!doctype html><meta charset="utf-8"><p>This link is not valid.</p>');
  await pool.query('UPDATE users SET email_updates = FALSE WHERE id = $1', [String(u)]);
  page('You are unsubscribed from update emails. You can turn them back on in the app.');
});

module.exports = router;
