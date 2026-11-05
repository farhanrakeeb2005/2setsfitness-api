// The app's "Enjoying 2SetsFitness?" prompt (src/routes/feedback.js): checking
// what was sent, and the email it becomes. Pure, so it's tested without SMTP
// or a database.
const { esc, shell } = require('./mailer');

const KINDS = ['like', 'improve'];
const LIMITS = { textMin: 3, text: 500, name: 40, appVersion: 20, lang: 10 };

// 1-5 whole stars, or null (none sent, or anything else)
const starsOf = (v) => (Number.isInteger(v) && v >= 1 && v <= 5 ? v : null);
const starLine = (n) => '\u2605'.repeat(n) + '\u2606'.repeat(5 - n);

const oneLine = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);

/** { ok: true, value } or { ok: false, error } */
function cleanFeedback(body = {}) {
  const kind = KINDS.includes(body.kind) ? body.kind : null;
  if (!kind) return { ok: false, error: 'Unknown feedback kind.' };
  const text = String(body.text ?? '').replace(/\r\n?/g, '\n').trim();
  if (text.length < LIMITS.textMin) return { ok: false, error: 'Write a few words first.' };
  if (text.length > LIMITS.text) return { ok: false, error: `Keep it under ${LIMITS.text} characters.` };
  const rawName = String(body.name ?? '').trim().replace(/\s+/g, ' ');
  if (rawName.length > LIMITS.name) return { ok: false, error: 'That name is too long.' };
  // an "improve" note is private: never quotable, and no name is kept with it
  const like = kind === 'like';
  const name = like ? oneLine(rawName, LIMITS.name) || null : null;
  const canQuote = like && body.canQuote === true && !!name;
  return {
    ok: true,
    value: {
      kind, text, name, canQuote, rating: starsOf(body.rating),
      appVersion: oneLine(body.appVersion, LIMITS.appVersion) || null,
      lang: oneLine(body.lang, LIMITS.lang) || null,
    },
  };
}

// the team's copy, in the same frame as the app's other emails
function feedbackEmail({ kind, text, name, canQuote, appVersion, lang, rating }, uid) {
  const like = kind === 'like';
  const paras = text.split(/\n\s*\n/)
    .map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.65;color:#2a2c35">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const row = (k, v) => `<tr><td style="padding:3px 12px 3px 0;font-size:13px;color:#6b6e7b;white-space:nowrap">${k}</td><td style="padding:3px 0;font-size:13px;color:#2a2c35">${esc(v)}</td></tr>`;
  const consent = like
    ? (canQuote ? 'Yes: may be shown on the website with this name' : 'No: keep private')
    : 'Private (improvement note, never public)';
  const html = shell(`
<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#E31E24">${like ? 'They like it' : 'What to improve'}</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:#141416">App feedback ${like ? '&#128077;' : '&#128078;'}</h1>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#f6f6f9;border-left:4px solid #E31E24;border-radius:8px;padding:16px 18px 4px">${paras}</td></tr></table>
<table cellpadding="0" cellspacing="0" style="margin-top:18px">
${rating ? row('Rating', `${starLine(rating)} ${rating}/5`) : ''}
${like ? row('Name', name || '(none)') : ''}
${row('Can quote', consent)}
${row('User id', uid)}
${row('App version', appVersion || '?')}
${row('Language', lang || '?')}
</table>`,
  'Sent from the feedback prompt in the 2SetsFitness app.');
  return {
    subject: `App feedback: ${rating ? `${starLine(rating)} ` : ''}${like ? '\u{1F44D}' : '\u{1F44E}'}${like && canQuote ? ' (can quote)' : ''}`,
    html,
  };
}

module.exports = { KINDS, LIMITS, cleanFeedback, feedbackEmail, starLine };
