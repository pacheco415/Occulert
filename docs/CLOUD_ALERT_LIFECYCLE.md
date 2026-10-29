# Web cloud-alert lifecycle

Cloud alerts belong to the account/auth lifecycle and sharing-consent revision
captured when their cloud session starts. Revocation cannot be undone for that
session by turning sharing back on or signing back in as the same owner.
Queued events check this scope after session/previous-event waits, after token
refresh, and in the final fetch microtask. A normal stop can drain valid events;
a detached older queue cannot change a newer session's status.

Same-tab token refresh preserves the lifecycle. Auth storage changes from other
tabs deliberately invalidate it, including another tab's routine token refresh:
the existing stored fields cannot distinguish that from same-owner reauthentication.
All further cloud alerts for that session remain blocked. During active monitoring,
the status shows LOCAL and a single non-interactive notice explains that local
monitoring continues. A newly started, authorized session restores cloud alerts
and the ON status. No restart or other interaction is requested while driving.

## Measured asset-budget adjustment

This change adds bounded consent/auth guards and the local-mode notice; it does
not introduce a retry outbox or cache authenticated backend clients offline.
The generated driver has no duplicated lifecycle helper to remove. Backend
formatting is kept readable rather than selectively minified to evade accounting.

| Asset | Measured raw bytes | Previous limit | New limit |
| --- | ---: | ---: | ---: |
| driver-app.v96.js | 94,065 | 94,000 | 95,000 |
| occulert-backend.v89.js | 40,714 | 40,000 | 41,000 |
| Service-worker install assets | 341,275 | 341,000 | 342,000 |

Both backend v88 and v89 remain network-only. Tests in
`test-web-summary-outbox.mjs` and `test-single-flight-refresh.mjs` exercise stale
consent/account queues, refresh and final-microtask races, normal stop, same-tab
refresh, visible once-only failure state, and recovery with a new session.
