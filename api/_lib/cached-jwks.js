// Verify only project-issued asymmetric access tokens. A local identity is not
// a current Auth user/profile, email-confirmation or session-revocation check.
const { createPublicKey, verify, constants } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { isUuid, isJsonObject } = require('./validation');
const { remainingProviderMs } = require('./provider-budget');
const TTL_MS = 600000, MISS_REFRESH_MS = 30000, OUTAGE_BACKOFF_MS = 5000;
const MAX_KEYS = 32, MAX_JWKS_BYTES = 65536;

function decoded(value, maxBytes) {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(maxBytes * 4 / 3)
      || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length <= maxBytes && bytes.toString('base64url') === value ? bytes : null;
}
function jsonPart(value, maxBytes) {
  const bytes = decoded(value, maxBytes);
  if (!bytes) return null;
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) return null;
  try { const object = JSON.parse(text); return isJsonObject(object) ? object : null; }
  catch { return null; }
}
function validClaims(claims, issuer, now) {
  const seconds = now / 1000;
  return claims.iss === issuer && claims.aud === 'authenticated' && claims.role === 'authenticated'
    && isUuid(claims.sub) && Number.isSafeInteger(claims.exp) && claims.exp > 0 && seconds < claims.exp + 30
    && (!Object.hasOwn(claims, 'nbf') || (Number.isSafeInteger(claims.nbf) && claims.nbf >= 0
      && claims.nbf <= claims.exp && seconds + 30 >= claims.nbf));
}
function tokenParts(token, issuer, now) {
  if (typeof token !== 'string' || token.length > 16384) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const header = jsonPart(parts[0], 512), claims = jsonPart(parts[1], 8192), signature = decoded(parts[2], 512);
  if (!header || !claims || !signature || !['ES256', 'RS256', 'HS256'].includes(header.alg)
      || (Object.hasOwn(header, 'typ') && header.typ !== 'JWT')
      || ['crit', 'b64', 'jku', 'jwk', 'x5u', 'x5c'].some(key => Object.hasOwn(header, key))
      || !validClaims(claims, issuer, now)) return null;
  if (header.alg !== 'HS256' && (typeof header.kid !== 'string' || !header.kid || header.kid.length > 128)) return null;
  if (header.alg === 'ES256' && signature.length !== 64) return null;
  if (header.alg === 'RS256' && (signature.length < 256 || signature.length > 512)) return null;
  if (header.alg === 'HS256' && signature.length !== 32) return null;
  return { header, claims, signature, input: Buffer.from(parts[0] + '.' + parts[1], 'ascii') };
}
function importedKey(jwk) {
  if (!['ES256', 'RS256'].includes(jwk.alg) || (jwk.use !== undefined && jwk.use !== 'sig')
      || (jwk.key_ops !== undefined && (!Array.isArray(jwk.key_ops) || jwk.key_ops.length !== 1 || jwk.key_ops[0] !== 'verify'))
      || ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some(field => Object.hasOwn(jwk, field))) return null;
  let publicJwk;
  if (jwk.alg === 'ES256') {
    const x = decoded(jwk.x, 32), y = decoded(jwk.y, 32);
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !x || !y || x.length !== 32 || y.length !== 32) return null;
    publicJwk = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  } else {
    const n = decoded(jwk.n, 512), e = decoded(jwk.e, 4);
    if (jwk.kty !== 'RSA' || !n || n.length < 256 || n[0] === 0 || !e || e[0] === 0) return null;
    const bits = (n.length - 1) * 8 + Math.floor(Math.log2(n[0])) + 1;
    const exponent = BigInt('0x' + e.toString('hex'));
    if (bits < 2048 || bits > 4096 || exponent < 3n || exponent > 0xffffffffn || exponent % 2n !== 1n) return null;
    publicJwk = { kty: 'RSA', n: jwk.n, e: jwk.e };
  }
  try {
    const key = createPublicKey({ key: publicJwk, format: 'jwk' });
    if (key.type !== 'public' || (jwk.alg === 'ES256'
      ? key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails.namedCurve !== 'prime256v1'
      : key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048 || key.asymmetricKeyDetails.modulusLength > 4096)) return null;
    return { key, alg: jwk.alg };
  } catch { return null; }
}
function keySet(value) {
  if (!isJsonObject(value) || !Array.isArray(value.keys) || value.keys.length > MAX_KEYS) throw new Error('jwks_unavailable');
  const keys = new Map();
  for (const jwk of value.keys) {
    if (!isJsonObject(jwk) || typeof jwk.kid !== 'string' || !jwk.kid || jwk.kid.length > 128) throw new Error('jwks_unavailable');
    // Duplicate/unsupported entries cannot become a usable matching key.
    keys.set(jwk.kid, keys.has(jwk.kid) ? null : importedKey(jwk));
  }
  return keys;
}
function waitWithinBudget(promise) {
  // A coalesced fetch belongs to its original request; every joining request
  // still gets its own deadline and must not abort another request's refresh.
  return new Promise((resolve, reject) => {
    const timeout = remainingProviderMs(12000);
    const timer = setTimeout(() => { const error = new Error('provider_request_budget_exhausted'); error.status = 504; reject(error); }, timeout);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
function createCachedJwtVerifier(now = () => Date.now(), cacheNow = () => performance.now()) {
  // Only one trusted configured issuer and at most 32 keys. Never retain
  // attacker-controlled missing-kid lists or user/token/claim results.
  let state;
  function refresh(current, load) {
    if (current.inflight) return current.inflight;
    const operation = Promise.resolve().then(load).then(value => {
      const keys = keySet(value);
      current.keys = keys; current.expires = cacheNow() + TTL_MS; current.retryAfter = 0; current.discoveryFailed = false;
      return true;
    }, () => false).catch(() => false).then(ok => {
      if (!ok) { current.retryAfter = cacheNow() + OUTAGE_BACKOFF_MS; current.discoveryFailed = true; }
      return ok;
    }).finally(() => { if (current.inflight === operation) current.inflight = null; });
    current.inflight = operation;
    return operation;
  }
  return async function verifyCachedJwt(token, issuer, load) {
    const parsed = tokenParts(token, issuer, now());
    if (!parsed) return null;
    // Never handle shared secrets locally. The Auth server verifies HS256.
    if (parsed.header.alg === 'HS256') return undefined;
    if (!state || state.issuer !== issuer) state = { issuer, keys: new Map(), expires: 0, missAfter: 0, retryAfter: 0, discoveryFailed: false, inflight: null };
    const current = state, cold = current.expires <= cacheNow();
    let available = true;
    if (cold) {
      available = current.inflight ? await waitWithinBudget(current.inflight)
        : current.retryAfter > cacheNow() ? false : await waitWithinBudget(refresh(current, load));
    } else if (!current.keys.has(parsed.header.kid)) {
      // A failed miss refresh has not established that the new key is absent.
      // Keep the Auth fallback through the cooldown until healthy discovery.
      available = !current.discoveryFailed;
      if (current.inflight) available = await waitWithinBudget(current.inflight);
      else if (current.retryAfter > cacheNow()) available = false;
      else if (current.missAfter <= cacheNow()) {
        current.missAfter = cacheNow() + MISS_REFRESH_MS;
        available = await waitWithinBudget(refresh(current, load));
      }
    }
    // Recheck time after a slow refresh, including before a network fallback.
    if (!validClaims(parsed.claims, issuer, now())) return null;
    if (!available) return undefined;
    const binding = current.keys.get(parsed.header.kid);
    if (!binding || binding.alg !== parsed.header.alg) return null;
    if (binding.alg === 'RS256' && parsed.signature.length !== Math.ceil(binding.key.asymmetricKeyDetails.modulusLength / 8)) return null;
    try {
      const options = binding.alg === 'ES256' ? { key: binding.key, dsaEncoding: 'ieee-p1363' }
        : { key: binding.key, padding: constants.RSA_PKCS1_PADDING };
      return verify('sha256', parsed.input, options, parsed.signature) ? { id: parsed.claims.sub } : null;
    } catch { return null; }
  };
}
module.exports = { createCachedJwtVerifier, MAX_JWKS_BYTES };
