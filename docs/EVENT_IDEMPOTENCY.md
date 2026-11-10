# Atomic event identity and quota prerequisite

This is the server-side prerequisite for the gated outbox in
[EVENT_OUTBOX_CONTRACT.md](EVENT_OUTBOX_CONTRACT.md), not an offline-upload rollout.
`OCCULERT_EVENT_IDEMPOTENCY_ENABLED` is **off by default**. The web adapter imports
the shared engine only through its reviewed bundle and requires explicit client
opt-in, current sharing consent, Web Locks and the exact advertised server protocol.
The native adapter imports the same engine and separately requires the exact
`EXPO_PUBLIC_EVENT_OUTBOX=1` client gate, current native sharing and advertised
server protocol. No build profile enables it. Ordinary clients continue unkeyed
best-effort sends. Server flag changes remain a separate gate; this document
records no production state.

## Wire and atomic behavior

`POST /api/events` optionally accepts `client_event_id` (UUID). A supplied key
while the flag is off returns `503 event_idempotency_not_enabled` rather than
silently writing without deduplication. Invalid keys return 400. Unkeyed callers
use `record_idempotent_event` with a null key even while the flag is off, keeping
their legacy response shape. The [default API quota integration](LEGACY_API_QUOTAS.md)
therefore shares this function's 60 accepted events per user per 60-second
window and 500 per session limits across both paths. Turning the identity flag
on is no longer required to limit unkeyed events. The original gated identity
implementation introduced these quotas only on its flag-enabled path; the SQL
and keyed path remain unchanged by the default-path integration.

Legacy quota responses are 429 with a bounded `Retry-After`; the permanent
500-event session cap does not reset when that backoff expires. Unkeyed callers
still create a new event for each call and must not infer retry safety.

The transaction uses one per-user bucket row lock before the owned session lock,
serializing that owner's writes across sessions. A `(verified user UUID, client
UUID)` primary key plus unique event reference enforces receipt identity. SQL
rechecks session ownership; the API derives user identity only from the verified
bearer token. No client owner/fleet claim is used. The service-role-only function
is SECURITY INVOKER, with explicit grants, closed RLS on new tables, and no client
EXECUTE/table access. API transport still makes one mutation attempt, never an
automatic retry after timeout.

- First accepted key inserts one event, a receipt and one quota unit atomically.
- Same key and canonical payload returns the original durable event with
  `replayed: true`, without recounting or changing its timestamp/metrics.
- Same owner/key with different accepted immutable data returns 409
  `event_id_conflict`, without insertion or quota use.
- A different owner may use the same UUID for their own session, but cannot
  replay another owner's session. Current ownership is checked on every replay.
- Replays already accepted are acknowledged after session grace/quota exhaustion;
  new keys still obey the two-minute post-session-end grace, detection-time
  interval, burst limit and 500-event cap. This does **not** extend offline
  delivery eligibility for new events.
- Rejected invalid timestamps do not reserve keys or spend quota. PR #315's
  explicit `400 invalid_occurred_at` fallback may omit the timestamp once with
  the same key. A timeout is not that rejection; do not alter uncertain requests.

## Canonical identity and privacy

Fingerprint is SHA-256 over a fixed typed JSONB array: session, type, fatigue,
confidence, latitude, longitude and detection-time intent. SQL normalizes UUID
case, numeric scale, signed zero, and equivalent timestamp timezone spellings.
Coordinate fingerprints use normalized float8 binary bytes, independent of
connection float-text settings. Timestamp epoch preserves microseconds. Omitted time has a stable null intent;
the first stored server timestamp is returned on replay rather than recalculated.
Omitted and explicit time are intentionally different intents, even if their
first stored timestamps happen to match. API metric clamping and invalid GPS to
null behavior are unchanged; equality is based on accepted typed values, not raw
JSON order or ignored fields.

Receipt rows store only owner/key/event IDs and the fingerprint, not another
copy of location, telemetry, auth tokens, or a separate response body. Receipts
last as long as their original events, with cascade cleanup on event/session/
account deletion. They are not durable tombstones after deletion. Clients must
never reuse keys or resend after account/session cleanup; direct individual-event
purges during a live session need a reviewed retention policy before rollout.
No indexes, event IDs, counts or original payloads are returned to an unauthorized
owner. No hashing of user credentials is involved.

There is **no authoritative server consent-generation field in the current
schema**. This change does not invent one or claim to verify consent revocation
that has not reached the server. Both adapters fail closed on local logout,
account switch and consent changes, and cannot recall an already dispatched
request. Authoritative server revocation semantics require separate design.

## Reconciliation and deployment gates

Migration `20261026164040_atomic_event_idempotency.sql` was generated with the
Supabase CLI and reconciles the atomic storage/quota design from open PR #192
(head `0ac0ab7`). It is self-contained on current main; it does not require that
unmerged function. It upgrades the proposed definer function to service-only
invoker and makes grants explicit. It preserves current main's strict GPS and
microsecond timestamp handling rather than copying #192's older route.

Do **not** blindly merge/apply #192's `20261003192000_atomic_event_quotas.sql`
after this migration: both create `event_rate_limits`. Reconcile or supersede the
old proposal first. No old PR was changed/closed here. If its SQL was already
applied out of band, stop and inspect the ledger/definitions rather than replaying
this migration; it deliberately fails on existing objects, not silently adopts
them. Existing migrations that grant service_role access to drivers/sessions/
events are required. The baseline/migration-grants regressions cover a clean
install.

Required order, with explicit production approval:
1. Reconcile existing schema/ledger and #192 overlap; review migration and rollback.
2. Apply the new migration and verify grants, closed RLS and RPC behavior on the
   intended database. Do not drop receipts while keyed delivery could still occur.
3. Verify the additional session-start migration and deployment gates in
   [the quota contract](LEGACY_API_QUOTAS.md) before deploying the default quota
   routes. Keep the identity flag off; unkeyed events still have quotas. Enable
   the identity flag only after its separate acceptance is complete.
4. Complete consent/retention, expiry/session-end, Retry-After, cross-tab and
   native lifecycle integration. Then test lost-response-after-commit, offline/
   online, reload and sign-out flows before enabling any retry-capable client.

If the flag is accidentally on before the RPC exists, API fails closed with a
provider error; there is no fallback to unsafe direct insertion. Turning the flag
off stops keyed writes with 503; the unkeyed route retains the shared event
quotas. Future retry clients must never remove their key to get around that response.

## Verification

`npm run test:event-idempotency` exercises the actual SQL in PGlite and the actual
handler with a mocked authenticated transport: permission/RLS, typed canonical
identity, quota/cap, cross-owner replay, post-end acknowledgement, rollback,
cascade deletion, strict GPS, missing-RPC/default-off and no-mutation-retry tests.
The Promise.all fixture uses one serialized PGlite connection; it is not proof
of multi-connection PostgreSQL races. Real PostgreSQL lock-wait/first-insert
collision testing and production acceptance are separate evidence, not assumed.

References checked for implementation: [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html),
[INSERT conflict semantics](https://www.postgresql.org/docs/current/sql-insert.html),
and [Supabase function security](https://supabase.com/docs/guides/database/functions).
The Supabase changelog's PostgreSQL minor security update does not alter this
row-lock/unique-key contract; this implementation needs no pgcrypto extension.

### Reproducible multi-connection local gate

`scripts/test-event-idempotency-concurrency.mjs` starts a fresh PostgreSQL 17
cluster with synthetic fixtures, a private temporary Unix socket directory and
TCP disabled. It accepts **no database URL**, cannot target production, and removes
its cluster after confirmed shutdown; uncertain server state preserves the directory. Install the isolated test runtime outside the
checkout (Linux x64), then run:

```sh
mkdir -p /tmp/occulert-postgres-runtime
npm install --prefix /tmp/occulert-postgres-runtime --no-save --package-lock=false \
  @embedded-postgres/linux-x64@17.10.0-beta.17 pg@8.16.3
OCCULERT_PG_TEST_RUNTIME=/tmp/occulert-postgres-runtime \
  node scripts/test-event-idempotency-concurrency.mjs
```

It tests simultaneous first-key insert with observable lock contention,
cross-session 60/min boundary, 500/session boundary, mixed replay/conflict,
concurrent session end and deletion. It is deliberately not part of the portable
PGlite aggregate because it requires a local PostgreSQL process/socket runtime.

In the current restricted cloud workspace, the pinned binary reports PostgreSQL
17.10 and initdb succeeds, but server startup fails creating its private Unix
socket with `Operation not permitted`. Therefore these multi-connection cases
did **not run in that restricted workspace**. No alternative networking or
permission bypass was attempted there. The separately approved isolated hosted
run below subsequently provided real PostgreSQL concurrency evidence.

### Isolated hosted concurrency job and recorded acceptance

`.github/workflows/event-concurrency.yml` prepares a separate ephemeral GitHub
runner for the six real-connection scenarios. It builds official PostgreSQL
17.11 from its checksum-pinned source archive under `RUNNER_TEMP`, as the
unprivileged runner user. It does not install system packages, start a system
service, request production secrets, accept a database URL, or access Supabase.
The Node client has its own committed manifest/lockfile under
`scripts/event-concurrency-runtime`; root/runtime app dependencies are unchanged.

The harness accepts `OCCULERT_PG_BIN` only as an absolute local executable
directory. It still starts its own fresh synthetic cluster with a private Unix
socket and TCP disabled. External database configuration is rejected. First-key,
session-close and deletion races use bounded observed lock waits rather than
assuming that an arbitrary sleep creates concurrency. Statement/connection
and workflow timeouts bound failures. The temporary cluster is stopped before
removal; uncertain shutdown does not delete its data directory.

After all six scenarios and cleanup succeed, the workflow uploads
`event-concurrency.json` with exact commit, migration SHA-256, PostgreSQL/Node
versions, scenario names and completion time. A failed run cannot emit a success
receipt. A successful source build or policy test is **not** real concurrency
acceptance; require that successful hosted receipt for the exact migration under
review. The separately approved [hosted run 40384554158](https://github.com/pacheco415/Occulert/actions/runs/40384554158)
passed all six scenarios on October 26, 2026 at 19:14:29 UTC with PostgreSQL
17.11 and Node 24.21.0. Its [receipt artifact](https://github.com/pacheco415/Occulert/actions/runs/40384554158/artifacts/12679888028)
records tested synthetic merge commit `d30968a71de3a11f0c036a6419c20a5fc15bb59e`.
Its tree `073910947e65763128da4fe7a95995251f813e5e` exactly matches PR head
`3497af5b9c19a00d50dcfe67e80abac9f598a9ea`; migration SHA-256 is
`e693e6ee46ccb8380defe4f249fd587cd89cee3777d47eb8d7ac4974190b53ab`.
This closes the six-scenario SQL concurrency evidence gap for that exact
migration, not every possible production load or lifecycle condition. A passing
hosted run does not approve production migration, establish server-side consent
revocation, or enable retries. Re-run for subsequent migration/harness changes.

Sources verified: [PostgreSQL 17.11 release files](https://ftp.postgresql.org/pub/source/v17.11/),
[non-root private-prefix source build](https://www.postgresql.org/docs/17/install-make.html),
and [local socket/TCP configuration](https://www.postgresql.org/docs/17/runtime-config-connection.html).
