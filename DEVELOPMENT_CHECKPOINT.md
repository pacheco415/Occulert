# Development checkpoint — 2026-09-13

## This development package

Based on main `504aa735` (website account deletion, PR #117).

- Native session starts, alert events, and completed summaries use a serialized local upload queue. Stable UUIDs and owner-scoped server retries prevent duplicate records after a lost acknowledgement.
- Recorded start/end/event timestamps survive delayed upload. Telemetry remains client-reported, not independently verified.
- Uploads retry while the app is foregrounded, with bounded failure backoff and a manual retry control. History distinguishes waiting uploads from local-only records.
- Signing out, replacing the signed-in account, or disabling sharing revokes runtime consent before any storage or network wait. Queued telemetry is removed locally, while per-session cleanup data remains as a small durable tombstone only when a create request was actually dispatched. Cleanup continues without retaining account credentials and never expires without server confirmation. Starts that were durably never dispatched need no server cleanup.
- Token cleanup removes the matching server session even if a final PATCH committed during revocation. A stable, private driver cleanup capability lets the database record a driver-bound receipt when a dispatched create never inserted; the same receipt blocks a delayed create. Lost cleanup responses are idempotent, unrelated drivers cannot suppress each other's receipts, and receipts cascade with account deletion. Previously completed and fully acknowledged summaries are retained because they are no longer in the pending queue.
- Completed summaries survive relaunch. Interrupted drives are not replayed as active drives or marked complete. Bounded cleanup runs before normal uploads, cannot delay a replacement account through the normal upload backoff, and does not appear as summaries waiting to sync. A mismatched create response schedules cleanup for both possible server IDs.
- Permanent request rejections cannot block the queue. The rejected item is isolated, later summaries continue, and local History distinguishes a complete cloud sync from one that needs review.
- The outbox accepts at most 100 pending sessions and 10,000 queued events per session. Storage/capacity failures keep monitoring local; it never evicts another queued summary to make room.
- The backend exposes versioned session/event upload routes and a per-session cleanup route. Its public capability marker remains off unless `OCCULERT_SESSION_SYNC_V1_ENABLED=true`, so new clients wait rather than sending stable-ID requests to an older or partially deployed backend.
- A server-issued fleet sync token is captured when a drive starts and rotates whenever fleet membership changes. Session creation validates and locks that membership inside the same database transaction, so a delayed upload with a stale token remains owner-only instead of appearing in a fleet report. Foreground and awaited pre-drive profile refreshes reduce that fail-closed delay without changing an active drive's captured grant.
- Protected 7/30-day fleet reporting reads up to 2,000 completed sessions through one database function and one PostgreSQL snapshot. Reports over the limit are visibly partial. A separate recent-session query retains active-drive status for the live dashboard. A staged legacy fallback returns at most 50 completed rows and always remains partial. Complete-report exports are blocked unless the selected window and snapshot are both confirmed.
- Browser CI includes Chromium and WebKit service-worker registration/cache checks plus a Chromium offline-fetch check. Mocked API tests block service workers so fixtures cannot accidentally hit the static server. This is not physical Safari camera or offline-PWA validation.
- Expo dependencies are aligned with the current SDK 57 compatibility check; no major framework upgrade is included.

## Validation and dependency review

Local verification includes the full repository suite, native dependency/type checks, 80 Chromium/WebKit cases, and 53 sync/reporting tests. The latter include isolated Postgres checks for token rotation and transaction-bound membership validation, driver-bound absent-create cancellation, restricted cancellation/report functions, idempotent capability receipts, account-deletion cascades, primary-key concurrency, and cascading cleanup, plus restart, acknowledgement-loss, in-flight create/finalization revocation, cleanup ordering, consent, account replacement, ownership, deployment rollback, permanent-conflict isolation, and queue-recovery cases.

Compatible dependency fixes reduced the native npm audit report from 20 to 18 advisories (17 moderate, one high). The remaining high advisory is the transitive XML parser under the Apple project-generation tooling. Remaining dependency changes need a separate compatibility review; the suggested forced router downgrade was not applied. This report does not establish runtime exploitability.

## Apple package reconciliation

The previously recorded Apple package ends at `a77e425` and includes widgets, App Intents, and device/health readiness work. It was recovered onto a separate local branch before iCloud offloaded Git objects and source files. Attempts to copy the complete package timed out; the incomplete copy was removed from this development branch. No existing Apple work was deleted or superseded.

Do not build from the old `release/testflight` branch without reconciling it against current main. Bring the complete Apple package into a separate reviewed change, then integrate it with this package before a combined native build. Prior Build 44 archive evidence does not validate this new source.

## Remaining gates

1. Apply `20260913_native_sync_guards.sql` and `20260913_session_report_snapshot.sql` before deploying this source.
2. Deploy the API and website with the session-sync capability flag off. Verify profile reads, both versioned upload routes, `/api/session-cancel-v1`, active-session status, and a populated owner-scoped 7/30-day report with `snapshot: true`.
3. Enable `OCCULERT_SESSION_SYNC_V1_ENABLED=true`, redeploy, and confirm the public configuration advertises version 1 before releasing a native client that depends on it.
4. Review and merge through separate pull-request gates, then verify the production website behavior.
5. Reconcile the Apple package and run native build preflight before one coordinated native build.
6. Confirm TestFlight processing and run parked iPhone/Watch/audio-route, offline/relaunch, thermal, and battery checks on the exact build.
7. Continue issue #65 for authorized ground-truth evaluation. No detection thresholds or accuracy claims changed here.

Managed fleet follow-up outcomes, billing, a real product demo, and Android remain later work packages.
