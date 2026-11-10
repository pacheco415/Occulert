# Failed-event delivery contract

`lib/event-outbox.ts` is the sole transport-free delivery engine. The web bundle
imports that actual TypeScript file through a bounded compiler input; it does not
maintain a second implementation. The native adapter imports that same file.
Local alerts never
wait for storage, configuration, a session response or event delivery.

## Gates and unchanged default

Web retries require all of the following:

- One exact `event-outbox=1` query parameter; detection experiments remain excluded.
- The current document's explicit cloud-sharing consent and signed-in session.
- Web Locks and an unpredictable `crypto.randomUUID()` implementation.
- Successful public configuration advertising exactly
  `capabilities.event_idempotency_protocol: "client_event_uuid_v1"`.
- The dedicated `eventOutboxCapability` and `logQueuedEvent` backend methods.

The flag defaults off. Before its gate, no adapter is constructed, queue storage is
read, provider call is added, or listener is registered. The default keeps the
existing best-effort event request and its one guarded timestamp fallback. Missing
capability or ownership support falls back only before the new event can have been
persisted or attempted. Later uncertainty never switches that event to an unkeyed
request. The server capability is an explicit protocol declaration; a generic
successful configuration response is insufficient. Neither this client flag nor
these tests authorize enabling a server flag or releasing a native build.

## Consent, login identity and tabs

Consent remains document-local and unchecked after an actual page reload. There is
no unattended replay after reload. A new explicit consent period removes old queued
events before adopting a fresh, monotonically increasing persisted generation.
Restarting only the controller within the same live consent period may restore
its queue; this is distinct from a new page or a new consent grant.

One consenting tab holds an exclusive `occulert.event-outbox.live-tab.v1` Web Lock
for its live controller. All queue and lifecycle storage operations additionally
use the exclusive mutation lock `occulert.event-outbox.owner.v1`. A contending tab
keeps best-effort sending and cannot read, clear, adopt or overwrite the owner's
queue. Merely opening an unchecked tab has no effect on the owner's work. Browsers
without Web Locks do not persist or retry events. This deliberately conservative
single-tab ownership is not background or multi-device delivery.

Local lifecycle metadata is stored at `occulert.event-outbox.lifecycle.v1`: owner
ID, the login's non-secret Supabase JWT `session_id`, monotonic consent generation,
and bounded stopped-session tombstones. `session_id` distinguishes a routine token
refresh from another login by the same person. It is read locally from the current
auth context, never sent as event authority or included in an event payload. Missing
or malformed identity disables retry adoption. The server continues to derive
identity from verified bearer tokens. No tokens, token hashes or credentials are
stored in this metadata.

Logout, account switch and consent revocation invalidate in-memory scope and abort
active send guards immediately, then clear pending rows under the mutation lock.
The backend's no-payload auth-lifecycle notification covers same-tab changes;
native storage events cover other tabs. Routine refresh within the same login
does not clear consent. A late cleanup never removes another login's newer queue.
Deletion failure leaves delivery disabled and the live ownership lock held until
successful cleanup. A removed server request cannot be recalled, and abort is not
evidence that the server did not commit.

Stopping monitoring immediately marks that session ended, aborts active work,
persists its stop tombstone, and discards its pending alerts. Other active sessions
remain eligible. A session response arriving after Stop cannot re-enqueue work.
This conservative policy fits the API's session-end write window without claiming
long-offline delivery after monitoring ends.

## Storage and immutable intent

The queue key is `occulert.event-outbox.v1`. It holds one owner/consent scope and at
most 50 records, with a 64,000-character serialized bound. Overflow rejects the
new event rather than evicting pending work. Every detection gets one unpredictable
UUID, immutable session ID, canonical detection timestamp, expiry, exact alert type,
fatigue and confidence (0–100 or null). Current web types `drowsy`, `distracted`,
`yawn` and `head_nod` remain distinct; the core's older prototype `drowsiness` maps
explicitly to the API's `drowsy` only. No coordinates, media, raw motion, fleet ID,
arbitrary metadata, tokens or credentials enter this queue or its request payload.

Expiry is at most 15 minutes after original detection and is never extended on
retry. Payload and scope are copied before asynchronous work. The schema rejects
unknown fields, corrupt rows, duplicate IDs and altered payloads for a pending ID.
Write failure prevents sending. Corruption fails closed until explicit cleanup.
Counters record capacity rejection, expiry, permanent rejection, exhausted sends
and stopped-session discard; the UI reports pending/discarded alerts without
claiming cloud synchronization.

Storage is local browser storage, not encryption. Expiry removes eligibility
immediately and removes stored bytes on the next active operation; closed pages
cannot execute deletion. A new consent grant or successful logout/revocation
removes old queued payloads. Revocation retains only a null-owner monotonic
generation so an old generation cannot be reused. Active owner/login metadata and
stop tombstones last until successful cleanup or a new consent period; stop
tombstones expire after 15 minutes and are pruned when another stop is recorded.
An abandoned document may therefore leave ineligible bytes until a later cleanup.
There is no logging or analytics from this engine.

## Delivery and failure policy

The adapter flushes only while foreground and online, after enqueue, on a bounded
timer, and when connectivity/visibility returns. One flush runs at a time, guarded
by Web Locks. Each transport call has an eight-second total adapter bound covering
configuration/auth waits and dispatch, supports cancellation, and performs at most
one POST. Each flush is also bounded to eight seconds; a timeout remains uncertain.

Attempt count and next-attempt time are persisted before every send. A detection
gets at most five sends total, including a timestamp fallback, with exponential
1/2/4/8/16-second backoff capped at 60 seconds. A 429 also respects parsed
`Retry-After` (seconds or HTTP date, bounded to 15 minutes), without extending the
immutable expiry. Backoff, attempts and wire timestamp mode survive controller
restart. Unknown outcomes, 401, 408, 429 and 5xx retain the same UUID and stop the
flush. A later send must still pass the original owner, login, consent, session,
deadline and capability checks. Auth refresh never permits another owner to send.

The live engine keeps an unresolved attempt visible in pending status, including
the fifth send. Concurrent reads or enqueues cannot classify that row as exhausted
before its response settles. This is a scope/generation-bound, memory-only guard,
not another retry: persisted attempt five is exhausted after restart or an
uncertain final outcome. Expiry, Stop and consent/account cleanup still remove
pending rows immediately when processed, and late responses cannot restore them.

A 2xx acknowledgement must contain `ok: true`, the matching `client_event_id` and
matching `event.session_id`; durable duplicate acknowledgements (`replayed: true`)
are accepted identically. Other malformed successes remain uncertain. Permanent
4xx responses remove the row, including conflicts and closed sessions, except for
401/408/429 and the one explicit timestamp case below.

Only `400 invalid_occurred_at` on a timed attempt switches to server-stamped wire
intent. That switch is persisted *before* the untimed fallback. The immutable local
detection time remains unchanged, but `occurred_at` is omitted from every subsequent
request for that UUID. A lost untimed response or controller restart therefore
replays the same untimed fingerprint rather than restoring the rejected timestamp.
A second timestamp rejection is permanent. Neither a timeout nor another status
authorizes changing wire intent, UUID, metrics or type. Atomic server deduplication
is required to prevent duplicate counting; see [EVENT_IDEMPOTENCY.md](EVENT_IDEMPOTENCY.md).

## Verification and remaining acceptance

`npm run test:event-outbox` typechecks the shared core and exercises storage,
identity, attempt policy, ownership, consent, auth changes, Stop, cleanup failure,
timeouts and persisted fallback intent. The browser suite exercises the actual
compiled source/backend together: default-off isolation, missing capability/locks,
real offline/online behavior, 429, replayed acknowledgement, two tabs, reload,
revocation, Stop, immutable types/metrics/time and lost untimed response restoration.
Compiler tests prove the actual shared input, exact import boundary, source bindings,
effect order and staged release equivalence; development TypeScript stays out of
deployment/offline assets. These are automated local checks, not phone or operational
rollout acceptance. Device evidence and any rollout require separate reviewed gates.

## Native adapter and process boundaries

Native adoption requires `EXPO_PUBLIC_EVENT_OUTBOX` to be exactly `1`, current
native sharing consent, a valid owner/login identity and the same exact server
protocol above. No EAS profile enables this flag. With the client flag off, the
monitor uses its existing best-effort request and no event queue, UUID, capability
request or AppState listener is added. The current native detector emits `drowsy`;
the shared engine and minimal native sender preserve the other supported types
without relabeling them.

`native-app/lib/nativeEventOutbox.ts` imports the canonical repository engine;
`cloudSync.ts` owns one lazy service for the current Expo JavaScript runtime. It
uses AsyncStorage and the existing `expo-modules-core` UUID implementation. No
background task or second delivery runtime is registered. Foreground AppState
resumption may flush eligible work; backgrounding aborts active attempts and
pauses retry timers. Local detector transitions allocate the UUID and snapshot
metrics/time immediately, without awaiting session creation or an earlier event.

The existing persisted sharing preference is preserved. On the first flagged
adoption in a new process, the service removes unknown previous-process session
rows and advances its persisted generation before accepting new events. It does
**not** replay a killed process's unknown session. Recreating a screen/controller
within the same live service retains queued IDs, attempts, backoff and persisted
server-stamp intent. This conservative process policy limits delivery continuity
deliberately; it does not claim a durable background uploader.

Native lifecycle metadata at `occulert.native-event-outbox.lifecycle.v1` contains
only owner ID, the locally decoded non-secret login `session_id`, monotonic retry
generation and bounded stopped-session tombstones. Credentials remain in the
existing protected auth store. The login identifier is never sent as event
authority or added to event payloads. Routine same-login refresh preserves retries;
explicit sign-in, logout, account/login change or any consent change invalidates
guards immediately, aborts active attempts and clears pending rows before a new
epoch can adopt. Stop immediately invalidates its original session promise and
discards that session's pending rows, including a late session response.

Each native event POST uses the dedicated one-attempt sender, never the legacy
401 replay path. The same five-send/15-minute/50-record limits, durable matching
acknowledgement, Retry-After rules and persisted timed-to-server-stamped fallback
apply. Cancellation, interrupted responses and malformed acknowledgements remain
uncertain under the same UUID. An adopted event never becomes an unkeyed request.

Native storage calls have an eight-second caller deadline. An interrupted or
timed-out write can still complete in the native bridge, so an actual-promise
barrier keeps cleanup ordered after that write; a new epoch cannot overtake it.
Unconfirmed cleanup disables retry adoption until explicit cleanup succeeds.
Opt-out is persisted independently of queue deletion failure. Eligibility expires
at detection plus 15 minutes; stored bytes are removed lazily by an active operation
or successful cleanup. A terminated/inactive process cannot execute deletion.
Revocation retains the null-owner generation only; cold adoption and successful
scope cleanup remove older alert payloads. Settings show a local status snapshot
on the existing account refresh, including capacity, expiry, rejection, exhaustion
and Stop counts, without claiming cloud synchronization.

`npm run test:native-event-outbox` executes the actual native cloud module and
monitor transition against substituted native bridges, plus the real shared engine:
delayed session startup, immutable intent, one-attempt 401, retry/fallback/replayed
acknowledgements, refresh/login/consent boundaries, Stop, foreground lifecycle,
capacity/expiry and failed/late native writes. Native `npm run test:event-outbox`
also renders the actual settings TSX diagnostics. See
[NATIVE_SHARED_ENGINE_PACKAGING.md](NATIVE_SHARED_ENGINE_PACKAGING.md) for the
bounded Metro input and archive-to-iOS-export proof. Export does not enable the
flag or replace device, signing, native build, submission or rollout acceptance.

## Browser transport contract

`/api/public-config` advertises
`capabilities.event_idempotency_protocol: "client_event_uuid_v1"` only when public
Auth configuration and server storage are configured and the existing
`OCCULERT_EVENT_IDEMPOTENCY_ENABLED` flag is exactly `true`. With that flag off,
the public response is unchanged. This is a route capability, not evidence of
production migration coverage or consent authority.

`OcculertBackend.eventOutboxCapability()` checks that exact protocol in the
cached successful configuration response. Unknown protocols, failed responses
and configuration attempts superseded by an explicit refresh fail closed. The
existing Auth configuration object and legacy `logEvent` method stay unchanged.

`logQueuedEvent(sessionId, type, details, isCurrent, { signal })` supplies one
keyed attempt. `details` requires a UUID `client_event_id` and accepts only optional
canonical ISO `occurred_at`, `fatigue_score` and `confidence`. Metrics are finite
numbers from 0 through 100 or null. It snapshots those primitive fields, requires a
synchronous `isCurrent() === true` predicate, captures the Auth lifecycle before
awaiting configuration or refresh, and rechecks both at dispatch and completion.
The method itself requires the exact capability. It never removes the key,
normalizes the payload, falls back to legacy sending, replays a 401, or retries an
event POST. Routine pre-dispatch token refresh may occur within the captured login.

Results retain `{ status, ok, body }`. A 429 may additionally expose
`retryAfterMs`, parsed from [Retry-After delta-seconds or a canonical HTTP-date](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after)
and bounded to 0–900,000 milliseconds. Malformed or oversized values are omitted;
raw response headers are not exposed. The transport schedules no timer or retry;
the shared engine persists backoff and clamps it to immutable expiry.

The actual POST has an eight-second header/body deadline and accepts an AbortSignal.
Abort or timeout is uncertain, represented as 503. Shared configuration and Auth/Web
Lock waits are not cancelled globally: the adapter races the entire attempt against
its own eight-second deadline, aborts its signal, and bounds the mutation lock held
for a flush. Late shared work cannot dispatch after cancellation or expiry. The
separate live-tab lease remains held throughout the active consent period, as
specified above, until successful revocation cleanup or controller disposal.

The local `occulert:auth-lifecycle` Event has no detail payload. It signals an
explicit Auth attempt, new-login adoption or local sign-out/clearing; consumer
errors cannot stop Auth cleanup. Routine same-login refresh does not emit it.
The adapter additionally compares the local login identity on native storage
events to preserve refresh while revoking real account/login changes.

`npm run test:event-outbox-transport` separately covers the public gate, unchanged
legacy behavior, one-attempt identity, Retry-After bounds, revocation, cancellation
and response deadlines. These transport tests complement the shared-engine and
actual browser lifecycle suites; none enables a production flag or native build.
