const { createCipheriv, createDecipheriv, createPrivateKey, randomBytes, sign } = require('node:crypto');
const db = require('./supabase');
const { isUuid } = require('./validation');

function signingKey() {
  const pem = process.env.APPLE_PRIVATE_KEY;
  if (!pem) return null;
  try {
    const key = createPrivateKey(pem.replace(/\\n/g, '\n'));
    return key.asymmetricKeyDetails?.namedCurve === 'prime256v1' ? key : null;
  } catch { return null; }
}

function clientSecret() {
  const key = signingKey();
  if (!key) throw new Error('apple_signing_unavailable');
  const iat = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = { alg: 'ES256', kid: process.env.APPLE_KEY_ID };
  const claims = { iss: process.env.APPLE_TEAM_ID, iat, exp: iat + 300,
    aud: 'https://appleid.apple.com', sub: process.env.APPLE_WEB_CLIENT_ID };
  const payload = encode(header) + '.' + encode(claims);
  return payload + '.' + sign('sha256', Buffer.from(payload), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
}

function configured() {
  return Boolean(db.serverStorageConfigured() && process.env.SUPABASE_ANON_KEY &&
    process.env.APPLE_WEB_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && signingKey() &&
    /^[0-9a-f]{64}$/i.test(process.env.APPLE_GRANT_KEY || ''));
}

function seal(token, owner) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(process.env.APPLE_GRANT_KEY, 'hex'), iv);
  cipher.setAAD(Buffer.from(owner));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

function unseal(value, owner) {
  const bytes = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(process.env.APPLE_GRANT_KEY, 'hex'), bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from(owner));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
}

async function appleRequest(path, fields) {
  const body = new URLSearchParams({ client_id: process.env.APPLE_WEB_CLIENT_ID,
    client_secret: clientSecret(), ...fields });
  return db.fetchTextWithDeadline('https://appleid.apple.com/auth/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  }, 65536);
}

function appleIdentity(user, subject) {
  return user.identities?.some(identity => identity.provider === 'apple' && identity.identity_data?.sub === subject);
}

async function exchange(code, verifier) {
  const { response, text } = await db.fetchTextWithDeadline(
    process.env.SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1/token?grant_type=pkce', {
      method: 'POST', headers: { apikey: process.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    }, 65536);
  if (!response.ok) return null;
  const { user, access_token, refresh_token, expires_at, expires_in, provider_refresh_token } = JSON.parse(text);
  if (!isUuid(user?.id) || !user.email || !user.email_confirmed_at || user.is_anonymous ||
      !access_token || !refresh_token || typeof provider_refresh_token !== 'string' ||
      !provider_refresh_token.length || provider_refresh_token.length > 8000) return null;
  // The token endpoint is pinned to Apple's TLS origin. Its fresh ID token binds
  // the grant to this Apple identity before replacing an existing revocation token.
  const refreshed = await appleRequest('token', { grant_type: 'refresh_token', refresh_token: provider_refresh_token });
  if (!refreshed.response.ok) throw new Error('apple_refresh_failed');
  const fresh = JSON.parse(refreshed.text);
  const claims = JSON.parse(Buffer.from(fresh.id_token.split('.')[1], 'base64url').toString('utf8'));
  if (claims.iss !== 'https://appleid.apple.com' || claims.aud !== process.env.APPLE_WEB_CLIENT_ID ||
      typeof claims.sub !== 'string' || !claims.sub || !appleIdentity(user, claims.sub)) return null;
  const sealed_token = seal(fresh.refresh_token || provider_refresh_token, user.id);
  try {
    await db.pgFetch('apple_account_grants', { method: 'POST', body: { user_id: user.id, sealed_token } });
  } catch (e) {
    if (e.details?.code !== '23505') throw e;
    const updated = await db.pgFetch('apple_account_grants', { method: 'PATCH',
      params: { user_id: 'eq.' + user.id }, body: { sealed_token } });
    if (updated?.length !== 1) throw new Error('apple_grant_changed');
  }
  return { access_token, refresh_token, expires_at, expires_in, user: { id: user.id, email: user.email } };
}

async function revokeForDeletion(user) {
  if (!user.identities?.some(identity => identity.provider === 'apple')) return;
  const rows = await db.pgFetch('apple_account_grants', { params: {
    user_id: 'eq.' + user.id, select: 'sealed_token', limit: '1',
  } });
  // Apple may have already revoked the user's grant or a previous client may
  // never have received one. The user's right to delete their account remains.
  if (!Array.isArray(rows)) throw new Error('apple_grant_lookup_failed');
  if (!rows.length) return;
  if (!configured()) throw new Error('apple_revocation_unavailable');
  const result = await appleRequest('revoke', { token: unseal(rows[0].sealed_token, user.id), token_type_hint: 'refresh_token' });
  if (!result.response.ok) throw new Error('apple_revocation_failed');
}
module.exports = { configured, exchange, revokeForDeletion };
