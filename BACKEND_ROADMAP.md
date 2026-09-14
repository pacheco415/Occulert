# Occulert Backend Roadmap

Updated 2026-09-13. Source status is separate from deployment verification.

## Implemented foundation

Occulert uses Supabase-backed APIs for authenticated profiles, fleets, invitations, consent-based session/event writes, owner-scoped reporting, pilot requests, and self-service account deletion. Browser local storage is an intentional local/demo fallback. Selecting a new backend or rebuilding accounts is unnecessary.

The current development package adds stable session/event IDs for owner-scoped retry deduplication and original client timestamps for offline uploads. It requires `20260913_native_sync_guards.sql`, which adds atomic interrupted-session cancellation, a stable private driver cleanup capability, per-session cleanup tokens, and a server-issued fleet sync token. Driver-bound cleanup remains retryable after sign-out without retaining account credentials, handles absent creates and late finalization, and records idempotent receipts that cascade with account deletion. The fleet token rotates when fleet membership changes, and session start validates it while holding the membership row through the insert; delayed uploads with an old token remain visible only to the authenticated driver account. The new native client waits for the backend's opt-in session-sync capability marker before uploading.

Fleet reports now request 7/30-day windows through the single-snapshot database function in `20260913_session_report_snapshot.sql`. The function returns at most 2,000 completed sessions from one PostgreSQL snapshot and states whether the window is complete. A separate bounded query retains current active-drive status for the live dashboard. A compatibility fallback returns at most 50 completed rows and never claims completeness. The UI keeps the selected window aligned with the server response and blocks complete, formula-safe report export unless the server confirms the requested snapshot. Detailed events remain a bounded recent sample; summary alert counts cover the returned sessions. All telemetry remains unverified client reports.

The earlier reporting workflow passed signed-in Preview review with an owner-scoped fleet containing two active drivers and no recorded sessions. Current authenticated timing and production verification remain pending for this expanded report path.

## Next work

1. Apply both 2026-09-13 migrations, deploy with the capability flag off, verify the versioned upload routes, cleanup route, live active status, and snapshot report, then enable the flag and recheck the public capability marker.
2. Verify delayed uploads, membership changes, and complete/partial report behavior on a populated owner-scoped fleet.
3. Persist manager follow-up outcomes with owner-scoped authorization and clear retention rules.
4. Measure report latency and load before adopting database aggregates or increasing reporting limits.
5. Define account data export and retention workflows.
6. Add billing and plan entitlements after pilot demand and commercial terms are validated.

Driver consent, server-verified ownership, and exclusion of camera media, audio, location, and raw motion from protected reports remain required.
