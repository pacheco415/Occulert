# Failed-event delivery foundation (not enabled)

This change supplies a transport-free prototype in `lib/event-outbox.ts` and
regressions. Nothing imports it from the running web/native applications. Both
`enabled` and `idempotencyVerified` default to false; disabled instances neither
persist nor send events. **This is not server deduplication, offline alert
upload, a deployment, or a native release.** Local safety alerts must never wait
for cloud persistence or delivery.

## Scope and privacy

The adapter must supply the authenticated owner and a consent generation which
changes on logout/account switch/revocation. `isCurrent` must fail immediately
when that scope becomes invalid. Do not use a reset-to-zero generation that can
collide with persisted consent from an earlier process. Call `clear()` on those
transitions and before enabling a new consent period; report deletion failures
and keep delivery disabled until cleanup succeeds. This module does not revoke
an already received server request and cannot cancel an already dispatched send.

Only one scope and at most 50 records are stored (64,000 ASCII characters maximum;
the schema accepts ASCII identifiers and fixed fields only). Additional rows are
rejected, never silently substituted for pending rows. Storage is adapter-owned,
not encrypted by this module: privacy review must approve its storage/retention.
No coordinates, media, tokens, raw motion, arbitrary metadata or fleet identifiers
are accepted. Minimal payload: stable event ID, session ID, original detection
ISO timestamp, expiry, type, fatigue/confidence (0–100 or null). These are a
prototype model, not the existing API wire schema. No logs/analytics are emitted.

All mutation storage operations are ordered; network waits do not hold that
queue. Scope/epoch are rechecked after asynchronous storage and network waits.
A failed write prevents sending; failed acknowledgement retains the same identity.
Corrupt storage fails closed rather than overwriting or sending its contents;
explicit cleanup remains available. One live instance must own the storage key;
this is not a multi-tab/process lock. Integration must provide cross-tab ownership
or a transactional store before web adoption. Pending snapshots are copies.

## Identity and delivery contract required before integration

1. Generate one unpredictable event UUID at detection and preserve it across
   enqueue, restart and retry. Never regenerate IDs on retry or reuse them for a
   new event, even after expiry/acknowledgement. Same queued ID with changed data
   is rejected. Client-side identity does **not** prevent duplicate server writes.
2. Reconcile the existing atomic event/rate-limit work in PR #192 and timestamp
   work in PR #315; do not fork or bypass those contracts. Implement an atomic
   server uniqueness constraint scoped to verified owner + event ID, with a
   canonical immutable payload fingerprint. Same ID/same data must acknowledge
   the original result without recounting metrics or consuming duplicate quota;
   same ID/different data must reject (409). Simultaneous inserts, lost responses,
   and unauthorized replay require database/API regression tests. Never trust
   client owner/fleet identity. Do not apply migrations as part of this prototype.
3. Define authoritative duplicate acknowledgement: API 2xx must mean durable
   acceptance (including duplicates), not merely a queued promise. Only then set
   `idempotencyVerified`; that option itself performs no capability verification.
4. Preserve the original detection timestamp and metrics. Do not send retry time
   as detection time or silently rewrite failed timestamps. Integration must use
   the #315 clock-skew policy and account for server limits, not bypass them.
5. `expires_at` is immutable and at most 15 minutes after detection. The current
   API accepts new writes only within two minutes after session end. Therefore
   this prototype cannot be wired while a session can end after enqueue: the
   adapter/server contract must invalidate or shorten every queued event's
   deadline on session end, or implement a reviewed late-event policy. The core
   currently has no session-end notification API. No promise of long-offline
   delivery is made. Expiry and attempt exhaustion discard on the next flush or
   enqueue, not by a background timer; shutdown retention needs adapter cleanup.

## Failure policy

- Explicit flush only: no timers, background jobs, connectivity listeners or
  retry loops are registered by the application.
- At most one flush at a time per instance, including account changes. A hung
  sender blocks later flushes until it settles; the future transport must impose
  a bounded timeout and support cancellation without treating timeout as proof
  that the server did not commit.
- Before each send, persist attempt count and next-attempt time. Up to five
  attempts, with 1/2/4/8/16-second delays capped at 60 seconds. The adapter must
  additionally respect Retry-After and rate budgets; the core has no header parser.
- 2xx removes an acknowledged event. 4xx other than 401/408/429 permanently
  rejects/removes it (including conflicts and expired sessions). 401 must wait
  for a valid auth context, never retry with another owner's token.
- Network rejection, unknown status, 408/429 and 5xx retain the same ID and stop
  this flush. Retry is safe only under the atomic server contract above. Backoff,
  attempts and expiry survive restart; after the fifth uncertain result the event
  is no longer eligible and will be pruned, so eventual delivery is not guaranteed.
- Add UI/counters for capacity rejection, permanent rejection and expiry before
  rollout. Do not label queued or discarded events as cloud-synced.

## Verification and remaining gates

`npm run test:event-outbox` covers default-off gates, identity/snapshots/restarts,
scope isolation, revocation and late responses, single-flight flushing, bounds,
expiry, error classifications, malformed data and storage failures. Root `verify`
includes it. This is model-level verification, not browser, phone, API or production
acceptance. Before wiring: server/database dedup tests; reviewed privacy/retention
and session-end policy; web/native lifecycle adapters; token refresh/account
switch tests; Retry-After handling; offline/online, timeout-after-commit, reload,
sign-out and device acceptance. No deployment or build is authorized by these tests.

## Server prerequisite implementation (still gated)

See [EVENT_IDEMPOTENCY.md](EVENT_IDEMPOTENCY.md) for the new local SQL/API
implementation and its deployment gates. No web/native outbox adapter is enabled
by it. Server consent generations, storage/lifecycle and device acceptance remain
separate prerequisites.
