// Email through a Gmail account (SMTP with an app password): the welcome email
// a new user gets on their first sign-in, and update emails sent on purpose
// with scripts/send-update.js. Nothing is sent unless GMAIL_USER and
// GMAIL_APP_PASSWORD are set (Secret Manager on Cloud Run).
const crypto = require('crypto');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const realEmail = (e) => typeof e === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !/@firebase\.local$/i.test(e);
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'Athlete';

// unsubscribe links: an HMAC of the user id, so no login is needed to opt out
function unsubToken(uid, secret = process.env.JWT_SECRET) {
  return crypto.createHmac('sha256', String(secret)).update(`unsub:${uid}`).digest('hex').slice(0, 32);
}
function unsubValid(uid, token, secret = process.env.JWT_SECRET) {
  const a = Buffer.from(unsubToken(uid, secret)), b = Buffer.from(String(token || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function unsubUrl(uid, base = process.env.PUBLIC_API_URL) {
  return `${base}/email/unsubscribe?u=${encodeURIComponent(uid)}&t=${unsubToken(uid)}`;
}

let transport = null;
function getTransport() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  if (!transport) {
    transport = require('nodemailer').createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
  }
  return transport;
}

const shell = (inner, footer) => `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f2f3f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#141416">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#050505;padding:22px 28px"><span style="font-size:15px;font-weight:900;letter-spacing:4px;color:#ffffff"><span style="color:#E31E24">2</span>SETSFITNESS</span></td></tr>
<tr><td style="padding:28px">${inner}</td></tr>
<tr><td style="padding:0 28px 26px;font-size:12px;color:#6b6e7b;line-height:1.6;border-top:1px solid #ececf1"><p style="margin:16px 0 0">${footer}</p></td></tr>
</table></td></tr></table></body></html>`;

function welcomeEmail(name, uid) {
  const n = esc(firstName(name));
  const html = shell(`
<h1 style="margin:0 0 10px;font-size:26px;line-height:1.15">Welcome, ${n}.</h1>
<p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#444756">Your account is ready. Here is where to start:</p>
<ul style="margin:0 0 20px;padding-left:20px;font-size:15px;line-height:1.8;color:#444756">
<li><b>Plan your week</b>: put gym days and sport sessions on the same calendar.</li>
<li><b>Try Form Coach</b>: prop your phone up and let the camera count and check your reps. Video never leaves your phone.</li>
<li><b>Tap where it hurts</b>: the pain guide gives warning signs and gentle exercises.</li>
<li><b>Climb the ranks</b>: every workout earns points toward Everest.</li>
</ul>
<p style="margin:0;font-size:15px;line-height:1.65;color:#444756">Questions or ideas? Just reply to this email.</p>`,
  `You're getting this because you created a 2SetsFitness account. We'll only email you about the app. <a href="${esc(unsubUrl(uid))}" style="color:#6b6e7b">Stop update emails</a>`);
  return { subject: `Welcome to 2SetsFitness, ${firstName(name)}`, html };
}

// body: plain text, blank line between paragraphs
function updateEmail(name, subject, body, uid) {
  const paras = String(body).split(/\n\s*\n/).map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#444756">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const html = shell(`<h1 style="margin:0 0 14px;font-size:24px;line-height:1.2">${esc(subject)}</h1><p style="margin:0 0 14px;font-size:15px;color:#444756">Hi ${esc(firstName(name))},</p>${paras}`,
    `You're getting this because you have a 2SetsFitness account. <a href="${esc(unsubUrl(uid))}" style="color:#6b6e7b">Stop update emails</a>`);
  return { subject, html };
}

async function send(to, { subject, html }, uid) {
  const t = getTransport();
  if (!t || !realEmail(to)) return { sent: false };
  await t.sendMail({
    from: `"2SetsFitness" <${process.env.GMAIL_USER}>`,
    to, subject, html,
    headers: uid ? { 'List-Unsubscribe': `<${unsubUrl(uid)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined,
  });
  return { sent: true };
}

module.exports = { esc, realEmail, firstName, unsubToken, unsubValid, unsubUrl, welcomeEmail, updateEmail, send };
