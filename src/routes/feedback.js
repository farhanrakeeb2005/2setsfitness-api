// POST /feedback: the app's "Enjoying 2SetsFitness?" prompt, signed-in users
// only. Body: { kind: 'like'|'improve', text, name?, canQuote, appVersion?, lang? }.
// Saved first (so nothing is lost if email is down), then emailed to the
// team's inbox. Nothing is ever shown publicly from here: a 'like' with
// canQuote is only the user's permission, which the team acts on by hand.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { cleanFeedback, feedbackEmail } = require('../lib/feedback');

function createFeedbackRouter({ pool, auth, mailer, limiter } = {}) {
  const router = express.Router();
  const limit = limiter || rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    // after the token check: counted per signed-in user, not per IP
    keyGenerator: (req) => req.user.id,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Thanks, we already have your feedback. Try again a bit later.' },
  });

  router.post('/', auth, limit, async (req, res) => {
    const f = cleanFeedback(req.body);
    if (!f.ok) return res.status(400).json({ error: f.error });
    const v = f.value;
    try {
      await pool.query(
        `INSERT INTO app_feedback (uid, kind, text, name, can_quote, app_version, lang)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [req.user.id, v.kind, v.text, v.name, v.canQuote, v.appVersion, v.lang]);
    } catch (e) {
      console.error('feedback: save failed', e.message);
      return res.status(500).json({ error: 'Could not send right now.' });
    }
    const to = process.env.CONTACT_TO || process.env.GMAIL_USER;
    mailer.send(to, feedbackEmail(v, req.user.id)).catch((e) => console.error('feedback: email failed', e.message));
    res.json({ ok: true });
  });
  return router;
}

const defaultFeedbackRouter = () => createFeedbackRouter({
  pool: require('../db'),
  auth: require('../middleware/auth'),
  mailer: require('../lib/mailer'),
});

module.exports = { createFeedbackRouter, defaultFeedbackRouter };
