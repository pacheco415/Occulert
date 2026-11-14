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
keys for ten minutes measured by a monotonic clock, independently of the wall
clock used for JWT claims. Cold/expired refreshes are coalesced; a missing key can
trigger at most one additional refresh per 30 seconds. Discovery failures use
a five-second retry backoff. After a failed missing-key refresh, missing-key
requests retain fresh Auth fallback through the cooldown until discovery
succeeds; known unexpired keys remain usable. There is no cache of users, tokens, accepted claims
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

## November 14 configured-lifetime review

**The production access-token lifetime remains unverified.** On November 14,
2026, the connected project was confirmed as `wbsynfcjpwlgdzioqpoa`, matching
the web and native project pins. The available project metadata does not expose
Auth configuration, and the project's JWT settings page required a new dashboard
sign-in. No production JWT-expiry setting was read or changed. A documented
Supabase default, a test token's lifetime or a public API key's expiration is
not evidence of this project's configured access-token lifetime.

To finish this review, an authenticated owner must record the **JWT expiry
limit** in the project's **JWT Keys > Legacy JWT Secret** settings, together
with the observation date. Supabase's [session documentation](https://supabase.com/docs/guides/auth/sessions)
describes that setting separately from refresh-token reuse and maximum-session
or inactivity timeouts. Do not record any signing secret, API key, access token
or refresh token in the repository or review evidence.

The practical boundaries differ:

- **Sign-out:** a copied, unexpired access token can still pass local signature
  verification while its owned database rows remain. These callers do not
  query `auth.sessions`, so sign-out is not an immediate server-side denial
  guarantee. Acceptance is bounded by that token's `exp` claim plus the existing
  30-second skew allowance, independently of the ten-minute JWKS cache.
- **Account deletion:** the canonical account-deletion cascade removes the
  owner's fleet. A request that observes the removed fleet cannot read its
  protected reports even if its signature and expiry remain valid. The three
  fleet reporting handlers return `403 fleet_not_found`. This does not promise
  to cancel a response already authorized before the deletion commits.
- **Sensitive operations:** the fresh-Auth policy above remains in force. This
  review neither enables cached verification for another route nor changes
  token, key-cache or recent-sign-in timing.

If the observed JWT expiry limit exceeds **3,600 seconds**, propose reducing it
to **3,600 seconds** for owner review; do not enable the change as part of this
task. Supabase discourages values over one hour and advises against going below
five minutes. Validate web/native refresh, loss of connectivity and recovery
before approving a different limit. Changing a configured lifetime must not be
presented as retroactively shortening the `exp` claim of already issued tokens.
Until the live value is recorded, W7's configured-lifetime acceptance criterion
is open and the review stays draft.

## Validation

`npm run test:cached-jwks` exercises actual RSA/EC signatures, strict claims and
key guards, rotation, bounded misses, concurrency, cache expiry/outages, streamed
body limits, abort-ignoring deadline failures and actual sensitive/id-only API
handlers. The existing transport, provider-budget and recent-auth regressions
remain in root verification. Fixtures isolate the HTTP boundary; they do not
claim a production signing-key or physical-network experiment.

The deleted-owner regression replays the canonical schema and migrations into
local PGlite, successfully reads an owned fleet with a real signed token, then
deletes only the local `auth.users` fixture. It confirms the fleet cascade,
preserves an unrelated owner's fleet, and verifies the same token still passes
cryptographic validation. The actual fleet-summary, fleet-session-history and
fleet-period-report handlers must then return `403 fleet_not_found` after only
the current ownership lookup, without reading protected roster/session/event
data or invoking the report RPC. No production account is deleted and no
production migration or authentication setting is changed by these tests.
