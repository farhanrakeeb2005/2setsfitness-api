// Which signed-in accounts the API accepts (middleware/auth.js). Pure, tested.
// Google (and phone) sign-ins come verified; an email/password account counts
// once its address is confirmed (the app asks first, AuthScreen); else anyone
// could sign up with someone else's address, get a welcome email sent to
// them and a leaderboard row.
function emailOk(decoded) {
  return decoded?.firebase?.sign_in_provider !== 'password' || decoded.email_verified === true;
}
module.exports = { emailOk };
