// Read only after the exact bearer token has passed Supabase verification.
// Global user.last_sign_in_at and token iat are not session authentication proof.
const METHODS = new Set(['password', 'passkey', 'otp', 'oauth', 'sso/saml', 'magiclink', 'totp', 'mfa/phone', 'mfa/webauthn']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hasRecentAuthentication(verifiedToken, verifiedUser, nowSeconds = Math.floor(Date.now() / 1000)) {
  try {
    if (typeof verifiedToken !== 'string' || verifiedToken.length > 16384) return false;
    const parts = verifiedToken.split('.');
    if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return false;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!claims || typeof claims !== 'object' || Array.isArray(claims) || claims.sub !== verifiedUser.id
      || claims.role !== 'authenticated' || claims.is_anonymous === true
      || typeof claims.session_id !== 'string' || !UUID.test(claims.session_id) || !Array.isArray(claims.amr)) return false;
    return claims.amr.some(entry => entry && METHODS.has(entry.method) && Number.isSafeInteger(entry.timestamp)
      && entry.timestamp > 0 && nowSeconds - entry.timestamp >= 0 && nowSeconds - entry.timestamp <= 600);
  } catch { return false; }
}
module.exports = { hasRecentAuthentication };
