const router   = require('express').Router();
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const pool     = require('../db');

// In-memory OTP store: phone → { code, expires, userId }
const otpStore = new Map();

async function sendSms(phone, code) {
  if (process.env.TWILIO_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE) {
    const creds = Buffer.from(`${process.env.TWILIO_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        From: process.env.TWILIO_PHONE,
        To:   phone,
        Body: `Your 2SetsFitness verification code is: ${code}. Valid for 10 minutes.`,
      }).toString(),
    });
    return { sent: true };
  } else {
    console.log('\n==================================');
    console.log(`[OTP] Phone : ${phone}`);
    console.log(`[OTP] Code  : ${code}`);
    console.log('==================================\n');
    return { sent: false, devCode: code };
  }
}

async function sendWelcomeEmail(email, name) {
  if (!process.env.RESEND_API_KEY) return;

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#050505;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td>
<table width="560" cellpadding="0" cellspacing="0" style="margin:0 auto;padding:40px 24px;">
  <tr><td>
    <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="width:56px;height:56px;background:#E31E24;border-radius:28px;text-align:center;vertical-align:middle;">
          <span style="font-size:22px;font-weight:900;color:#ffffff;">2S</span>
        </td>
        <td style="padding-left:14px;vertical-align:middle;">
          <span style="font-size:15px;font-weight:900;color:#ffffff;letter-spacing:4px;">2SETSFITNESS</span>
        </td>
      </tr>
    </table>
    <h1 style="font-size:26px;font-weight:900;color:#ffffff;margin:0 0 10px;letter-spacing:-0.5px;">
      Welcome, ${name}! 💪
    </h1>
    <p style="font-size:14px;color:#7a7e8a;margin:0 0 24px;line-height:1.7;">
      Your account is set up and ready. Here's what's waiting for you inside the app:
    </p>
    <table width="100%" cellpadding="0" cellspacing="8" style="margin-bottom:28px;">
      <tr>
        <td style="background:#111318;border:1px solid #2a2d36;border-left:2px solid #E31E24;border-radius:10px;padding:14px 16px;">
          <p style="margin:0;font-size:13px;font-weight:700;color:#ffffff;">🤖 AI Form Coach</p>
          <p style="margin:4px 0 0;font-size:12px;color:#7a7e8a;">Live rep counting and real-time coaching feedback</p>
        </td>
      </tr>
      <tr><td style="height:8px;"></td></tr>
      <tr>
        <td style="background:#111318;border:1px solid #2a2d36;border-left:2px solid #E31E24;border-radius:10px;padding:14px 16px;">
          <p style="margin:0;font-size:13px;font-weight:700;color:#ffffff;">📈 Progress Tracking</p>
          <p style="margin:4px 0 0;font-size:12px;color:#7a7e8a;">Personal records, plateau detection and volume trends</p>
        </td>
      </tr>
      <tr><td style="height:8px;"></td></tr>
      <tr>
        <td style="background:#111318;border:1px solid #2a2d36;border-left:2px solid #E31E24;border-radius:10px;padding:14px 16px;">
          <p style="margin:0;font-size:13px;font-weight:700;color:#ffffff;">🏆 Weekly Leaderboard</p>
          <p style="margin:4px 0 0;font-size:12px;color:#7a7e8a;">Compete with others and track your weekly ranking</p>
        </td>
      </tr>
    </table>
    <p style="font-size:14px;color:#7a7e8a;margin:0 0 8px;line-height:1.7;">
      Open the app to complete your setup and log your first session.
    </p>
    <p style="font-size:11px;color:#4a4d58;border-top:1px solid #2a2d36;padding-top:20px;margin-top:32px;line-height:1.7;">
      Train smarter. Track everything.<br>
      You're receiving this because you created an account at 2SetsFitness.
    </p>
  </td></tr>
</table>
</td></tr></table>
</body>
</html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'onboarding@resend.dev',
      to:      email,
      subject: `Welcome to 2SetsFitness, ${name}! 💪`,
      html,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
}

// ── POST /auth/register ────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email.toLowerCase(), hash, name || 'Athlete']
    );
    const user = rows[0];
    await pool.query('INSERT INTO profiles (user_id) VALUES ($1)', [user.id]);
    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '30d' });

    // Send welcome email — fire and forget, never block the response
    sendWelcomeEmail(user.email, user.name).catch(err =>
      console.warn('Welcome email failed:', err.message)
    );

    res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('Register error:', err);
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: 'Server error', detail: err.message || String(err) });
  }
});

// ── POST /auth/login ───────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /auth/google ──────────────────────────────────────────────────────────
router.post('/google', async (req, res) => {
  const { accessToken } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'Access token required' });

  try {
    // Verify token with Google and get user info
    const googleRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!googleRes.ok) return res.status(401).json({ error: 'Invalid Google token' });

    const gUser = await googleRes.json();
    if (!gUser.email) return res.status(401).json({ error: 'Could not get email from Google' });

    const email = gUser.email.toLowerCase();
    const name  = gUser.name || gUser.given_name || 'Athlete';

    // Find existing user
    let { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    let user = rows[0];
    let isNew = false;

    if (!user) {
      // Create new user — use a non-loginable password marker
      const { rows: newRows } = await pool.query(
        'INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id, email, name',
        [email, `google:${gUser.id}`, name]
      );
      user = newRows[0];
      await pool.query('INSERT INTO profiles (user_id) VALUES ($1)', [user.id]);
      isNew = true;

      sendWelcomeEmail(email, name).catch(err =>
        console.warn('Welcome email (Google) failed:', err.message)
      );
    }

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, isNew, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(500).json({ error: 'Google sign-in failed', detail: err.message });
  }
});

// ── POST /auth/google-code ─────────────────────────────────────────────────────
// Exchange authorization code for user info (PKCE code flow — no client secret exposed in app)
router.post('/google-code', async (req, res) => {
  const { code, codeVerifier, redirectUri } = req.body;
  if (!code) return res.status(400).json({ error: 'Authorization code required' });

  try {
    const params = new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    });
    if (codeVerifier) params.set('code_verifier', codeVerifier);

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) {
      console.error('Google token exchange error:', tokens);
      return res.status(401).json({ error: `Google sign-in failed: ${tokens.error_description || tokens.error}` });
    }

    const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!infoRes.ok) return res.status(401).json({ error: 'Could not fetch Google user info' });

    const gUser = await infoRes.json();
    if (!gUser.email) return res.status(401).json({ error: 'Could not get email from Google' });

    const email = gUser.email.toLowerCase();
    const name  = gUser.name || gUser.given_name || 'Athlete';

    let { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    let user = rows[0];
    let isNew = false;

    if (!user) {
      const { rows: newRows } = await pool.query(
        'INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id, email, name',
        [email, `google:${gUser.id}`, name]
      );
      user = newRows[0];
      await pool.query('INSERT INTO profiles (user_id) VALUES ($1)', [user.id]);
      isNew = true;
      sendWelcomeEmail(email, name).catch(err => console.warn('Welcome email (Google) failed:', err.message));
    }

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, isNew, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('Google code exchange error:', err);
    res.status(500).json({ error: 'Google sign-in failed', detail: err.message });
  }
});

// ── POST /auth/send-otp ────────────────────────────────────────────────────────
router.post('/send-otp', async (req, res) => {
  const { phone, userId } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });

  const code    = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = Date.now() + 10 * 60 * 1000; // 10 minutes
  otpStore.set(phone, { code, expires, userId });

  try {
    const smsResult = await sendSms(phone, code);
    res.json({ success: true, ...(smsResult.devCode ? { devCode: smsResult.devCode } : {}) });
  } catch (err) {
    console.error('SMS error:', err.message);
    res.status(500).json({ error: 'Failed to send SMS. Check the phone number and try again.' });
  }
});

// ── POST /auth/verify-otp ──────────────────────────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  const { phone, code, userId } = req.body;
  const record = otpStore.get(phone);

  if (!record)                   return res.status(400).json({ error: 'No code was sent to this number. Request a new one.' });
  if (Date.now() > record.expires) return res.status(400).json({ error: 'Code expired. Request a new one.' });
  if (record.code !== code)       return res.status(400).json({ error: 'Incorrect code. Please try again.' });

  otpStore.delete(phone);

  try {
    await pool.query(
      'UPDATE users SET phone = $1, phone_verified = true WHERE id = $2',
      [phone, userId || record.userId]
    );
  } catch (_) {
    // Column may not exist yet — non-fatal, verification still succeeds
  }

  res.json({ success: true });
});

module.exports = router;
