# Alert timing: stored-time semantics and regression safeguards

Originally reviewed against main `fdc2d0b0cfc294e017d96d75b3e5ac3a89a9d369`
on 2026-10-29 with tests and documentation only. The October 31 quota integration
routes unkeyed events through the existing SQL acceptance function as well and
assigns new session start time in its atomic SQL operation. It preserves the
timestamp bounds, mixed-time meaning, client retry policies and rollout flags.
Source inspection does not establish which flags are enabled in production or
which native build is installed.

## Current source, not the earlier proposal

Main has advanced since the 2026-10-27 timing review at `86ea67c`:

- #335 (`9ecd9c2`, merged by `08d0742`) added detection-time capture before queue
  waits and a one-shot untimed fallback after `400 invalid_occurred_at`.
- #338, #342 and #345 added gated transport and web/native event-outbox adapters.
  See [the outbox contract](EVENT_OUTBOX_CONTRACT.md) for their existing gates,
  bounded retries, persistence, owner/consent boundaries and acceptance evidence.
- #349 extracted native monitoring into hooks; native detection capture now
  belongs to `native-app/hooks/useMonitorCloudAlerts.ts`.

The earlier review's general statement that current clients omit timestamps and
never resend is **no longer true**. These safeguards neither revert nor newly
enable the merged behavior. PR #315 is not the implementation basis here.

## What the server stores

`api/sessions.js` obtains `started_at` from the server-side atomic start function
after asynchronous identity/profile work and database locking. An alert detected
while that work is pending can precede server session start even when client and
server clocks agree.

`api/events.js` and the shared `record_idempotent_event` RPC enforce:

```
started_at <= explicit occurred_at <= min(server now, ended_at when present)
```

Pre-start detections and ahead-clock values return `400 invalid_occurred_at`
without writing an event. The existing two-minute session-end delivery grace
limits new arrivals even when their explicit occurrence timestamp is valid.
Accepted timezone/microsecond precision is preserved for storage.

When occurrence time is omitted, the server assigns processing time for an active
session, or the earlier stored session end within grace. That is **server-assigned
event time**, not necessarily HTTP receipt time and not evidence of detection time.
The RPC's idempotent replay acknowledges the original event without changing its
timestamp, including after grace; it does not accept a new event after grace.

`events.created_at` therefore contains either an accepted client-reported instant
or a server-assigned instant. There is no separate persisted timing-provenance
field exposed with the fleet event row. These values cannot all be described as
exact detection times, and old rows cannot reliably be backfilled with provenance.
An accepted client clock is still an unverified report, not an attested clock.

## Existing client paths

- Web snapshots metrics and client wall-clock time before session/queue waits.
  Its legacy path first sends `occurred_at`. Only the explicit timestamp rejection
  permits one untimed fallback, under the original account/consent scope.
- Native monitoring captures time before queue waits. `logCloudAlert` accepts an
  optional timestamp and has the same explicit-rejection fallback, preserving the
  captured session/owner/consent context. Its untimed fallback disables transport
  auth retry. Calls that omit time remain untimed and do not trigger this fallback.
- Gated adapters use the shared `lib/event-outbox.ts` engine. On explicit timestamp
  rejection, it persists a change from detected to server-assigned wire intent
  before the next attempt. The original event ID and detection snapshot remain;
  subsequent uncertain outcomes replay the same intent rather than changing time
  again. The fallback consumes the existing five-send budget; a second timestamp
  rejection is permanent. This is not the same policy as the legacy one-shot path.

No settings or flags are inspected or changed by these regressions. In source,
web outbox selection depends on its query gate and transport capabilities; native
selection depends on `EXPO_PUBLIC_EVENT_OUTBOX === '1'` outside simulator mode and
transport capabilities. Do not infer deployed activation from a source merge.

## Reliability and truthfulness boundary

The explicit rejection is important: a timeout or uncertain response does not
prove a timed event failed to store, so it must not authorize changing the request
into a different untimed event. Existing tests cover immutable keyed replay,
intent persistence before fallback, consent revocation and account replacement.
This review found no new demonstrated data-loss or consent bypass in those scoped
source paths; tests are not production or device acceptance evidence.

The fallback can preserve an upload that would otherwise be rejected for session
start delay or clock skew, but it **loses detection-time meaning in the server row**.
It also cannot guarantee delivery: legacy failures are not durably retried, while
the outbox is bounded by capacity, expiry, session lifetime, retry budget and
permanent rejection. Discard/expiry counters are not evidence of successful upload.
No change here claims these limitations are solved.

## Future choices (not implemented)

1. **Keep the current mixed-time contract.** No schema or new collection required;
   treat stored time as event time of unknown source rather than exact detection
   time. The fallback and gated retry policies remain as already implemented.
2. **Separate client-reported detection time from server-assigned time with explicit
   provenance.** This needs a versioned API/schema and product/privacy decisions
   about validation, malformed/skewed/pre-start values, retention and reader labels.
   Preserve existing bounds for `occurred_at`; do not repurpose it for out-of-range
   reports. Client clock accuracy and historical provenance remain unknown.
3. **Relative monotonic detection offsets from a defined monitoring anchor.** This
   could represent within-run order/delay without claiming UTC precision, but needs
   a separate versioned contract and policies for suspension, restart, clock reset,
   consent changes and unknown anchors. It cannot recover old absolute times.

Do not clamp a purported detection time into session bounds, subtract guessed
clock skew, weaken server bounds, or label a fallback as detection time. Waiting
for cloud creation before local monitoring would change monitoring behavior and
would not fix clock skew; it is not a safe shortcut.

## Executable coverage

The existing verification entrypoints include these additions:

- `scripts/test-api-security.mjs`: real session handler suspended at profile lookup
  under a controlled clock; pre-start and ahead-clock rejection without writes;
  omission accepted once; session-end grace uses end time rather than receipt time.
  Existing checks retain strict timestamp precision and exact grace boundaries.
- `scripts/test-event-idempotency.mjs`: PGlite RPC proves active-session omission
  falls within server processing bounds and grace omission equals stored end time.
- `scripts/test-native-async-reliability.mjs`: untimed legacy calls stay untimed
  and send once on 200/400/409/503. This deliberately does not claim timed calls or
  the gated outbox never resend.

Existing `test:native-cloud`, `test:web-outbox`, `test:event-outbox`,
`test:native-event-outbox` and `test:event-outbox-transport` cover timed capture,
fallback eligibility, stale-scope rejection, gated delivery and replay. Reuse
these rather than duplicate the fallback implementation in a new test harness.

The current fleet dashboard renders the stored value through `dateLabel`, without
an explicit "detected at" label in `eventHistoryHtml`. No UI wording or immutable
assets are changed here; this is not an exhaustive audit of historical consumers.
