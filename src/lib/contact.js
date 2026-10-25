// The website's contact form (src/routes/contact.js): checking what was sent,
// and the email it becomes. Pure, so it's tested without SMTP or a database.
const { esc, realEmail, shell } = require('./mailer');

const TOPICS = ['Feedback or an idea', 'Something is broken', 'A question about the app', 'Press or partnership'];
const LIMITS = { name: 80, email: 200, message: 4000 };

/** { ok: true, value } or { ok: false, error } (error is shown on the page) */
function cleanContact(body = {}) {
  const name = String(body.name ?? '').trim().replace(/\s+/g, ' ');
  const email = String(body.email ?? '').trim();
  const topic = TOPICS.includes(body.topic) ? body.topic : TOPICS[0];
  const message = String(body.message ?? '').trim();
  if (!name) return { ok: false, error: 'Add your name.' };
  if (name.length > LIMITS.name) return { ok: false, error: 'That name is too long.' };
  if (!realEmail(email) || email.length > LIMITS.email) return { ok: false, error: 'Add an email address we can reply to.' };
  if (message.length < 5) return { ok: false, error: 'Write a message first.' };
  if (message.length > LIMITS.message) return { ok: false, error: `Keep it under ${LIMITS.message} characters.` };
  return { ok: true, value: { name, email, topic, message } };
}

// a bot fills the hidden field, or submits faster than anyone can type
function looksLikeBot(body = {}) {
  return String(body.website ?? '') !== '' || !(Number(body.ms) >= 2500);
}

// the team's copy, in the same frame as the app's other emails
function contactEmail({ name, email, topic, message }) {
  const paras = message.split(/\n\s*\n/)
    .map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.65;color:#2a2c35">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const html = shell(`
<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#E31E24">${esc(topic)}</p>
<h1 style="margin:0 0 4px;font-size:22px;line-height:1.25;color:#141416">${esc(name)}</h1>
<p style="margin:0 0 20px;font-size:14px;color:#6b6e7b">${esc(email)}</p>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#f6f6f9;border-left:4px solid #E31E24;border-radius:8px;padding:16px 18px 4px">${paras}</td></tr></table>`,
  'Sent from the contact form on the 2SetsFitness website. Press Reply to answer.');
  return {
    subject: `${topic}: ${name.replace(/[\r\n]+/g, ' ')}`,
    replyTo: `"${name.replace(/["\\\r\n]/g, '')}" <${email}>`,
    html,
  };
}

module.exports = { TOPICS, LIMITS, cleanContact, looksLikeBot, contactEmail };
