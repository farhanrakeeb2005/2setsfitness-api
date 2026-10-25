// The website's contact form (src/routes/contact.js): checking what was sent,
// and the email it becomes. Pure, so it's tested without SMTP or a database.
const { esc, realEmail } = require('./mailer');

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

function contactEmail({ name, email, topic, message }) {
  const paras = message.split(/\n\s*\n/).map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  return {
    subject: `2SetsFitness contact: ${topic}`,
    replyTo: `"${name.replace(/["\\\r\n]/g, '')}" <${email}>`,
    html: `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#141416;max-width:600px">
<p style="margin:0 0 4px;font-size:13px;color:#6b6e7b">From the website contact form · reply to answer</p>
<h2 style="margin:0 0 4px;font-size:20px">${esc(topic)}</h2>
<p style="margin:0 0 16px;font-size:14px"><b>${esc(name)}</b> · ${esc(email)}</p>${paras}</body></html>`,
  };
}

module.exports = { TOPICS, LIMITS, cleanContact, looksLikeBot, contactEmail };
