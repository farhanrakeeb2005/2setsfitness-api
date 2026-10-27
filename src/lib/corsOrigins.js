// Which web pages may call the API from a browser (app.js cors). Pure, tested.
const ALLOWED = [
  'https://fitness-app-5c48a.web.app',          // the web app (Firebase Hosting)
  'https://fitness-app-5c48a.firebaseapp.com',  // the same site's other domain
  'https://farhanrakeeb2005.github.io',         // the website (contact form)
];
// local testing (expo web, the build served locally)
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function allowed(origin, env = process.env) {
  if (!origin) return true;   // not a browser page: the phone app, curl
  const extra = String(env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return ALLOWED.includes(origin) || extra.includes(origin) || LOCAL.test(origin);
}
// cors() origin option: true echoes the origin back, false sends no CORS headers
function corsOrigin(origin, cb) { cb(null, allowed(origin)); }

module.exports = { ALLOWED, allowed, corsOrigin };
