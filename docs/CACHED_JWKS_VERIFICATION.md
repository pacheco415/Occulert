# Cached access-token verification

`verifyAccessToken` uses Supabase's current `/auth/v1/user` response by default.
Callers must explicitly request `{ cachedIdentity: true }` to use asymmetric
signature verification. `{ freshUser: true }` always takes the Auth network path,
even if `cachedIdentity` is also supplied. An Auth rejection, outage or timeout
never falls back to a cached identity.

## Route policy

Only session reads/writes, event writes, fleet summary, fleet session history and
fleet period reports opt into cached identity. These routes use only the user ID
and still query current owned driver/fleet rows before accessing protected data.
The local result contains exactly `{ id }`; it supplies no email, profile,
confirmation, authentication time or session-status fields.

Account deletion, profile updates, fleet creation/reads, invitations and their
acceptance, followups, and billing owner checks retain fresh Auth. This preserves
verified email gates, profile email refresh and the account deletion gate based
on recent authentication in the same verified token. Editable user metadata is
never evidence of email confirmation.

## Verification and transport

The trusted project origin comes from server `SUPABASE_URL`, requires HTTPS, and
determines both the exact issuer (`<origin>/auth/v1`) and public discovery URL
(`<origin>/auth/v1/.well-known/jwks.json`). Token-supplied discovery URLs or keys
are rejected. Public discovery sends no service-role credential and disallows
redirects. Tokens require audience and role `authenticated`, a UUID subject in
the exact 36-character SQL UUID format, and integer expiration/not-before claims
with 30 seconds of clock skew.

Node's built-in crypto verifies ES256 only with public P-256 keys and 64-byte
IEEE P1363 signatures; RS256 only with public 2048–4096-bit RSA keys and PKCS#1
v1.5 signatures. Algorithm, key type, curve, size, signing use and verify-only
operations must agree. Private keys, duplicate key IDs, unsupported critical
headers and algorithm confusion cannot produce a local identity.

HS256 remains verified by the existing Auth network request. Unavailable,
malformed or oversized discovery also uses that request. Invalid token claims,
a bad signature, an unusable matching key, or a missing key after healthy
discovery fail closed without an Auth fallback. No signing-key migration or
rotation is performed by this change.

Discovery uses the existing eight-second Supabase transport deadline within
the enclosing twelve-second provider budget, including response-body reads and
fetch implementations that ignore abort. Auth fallback receives only the
remaining budget. Coalesced requests retain their own waiting deadlines and
cannot cancel another request's refresh. The JWKS body is capped at 64 KiB.

## Cache and revocation limits

Each warm server process retains at most one configured issuer and 32 public
keys for ten minutes. Cold/expired refreshes are coalesced; a missing key can
trigger at most one additional refresh per 30 seconds. Discovery failures use
a five-second retry backoff. There is no cache of users, tokens, accepted claims
or attacker-controlled missing key IDs. Expired keys are not used during an
outage; fresh Auth must accept the original token for fallback to succeed.

Cached signature verification proves the token was issued by an accepted key;
it does not attest that its session or user still exists. It provides no instant
sign-out, deletion or token-revocation guarantee. Current database ownership
checks still apply, including after offboarding or account deletion. The Auth
network path supplies current user details; its own session revocation behavior
must not be overstated either.

Supabase caches discovery at its edge for ten minutes and recommends allowing
at least twenty minutes when coordinating signing-key changes with additional
caches. This process cache can add up to ten minutes to a stale edge response;
do not assume key removal is immediately visible. Token expiration, including
the stated skew, bounds acceptance independently of key-cache lifetime.

Primary references: [Supabase JWT verification](https://supabase.com/docs/guides/auth/jwts),
[signing keys](https://supabase.com/docs/guides/auth/signing-keys),
[current user lookup](https://supabase.com/docs/reference/javascript/auth-getuser),
and [Node 24 crypto](https://nodejs.org/download/release/v24.19.0/docs/api/crypto.html).

## Validation

`npm run test:cached-jwks` exercises actual RSA/EC signatures, strict claims and
key guards, rotation, bounded misses, concurrency, cache expiry/outages, streamed
body limits, abort-ignoring deadline failures and actual sensitive/id-only API
handlers. The existing transport, provider-budget and recent-auth regressions
remain in root verification. Fixtures isolate the HTTP boundary; they do not
claim a production signing-key or physical-network experiment.
