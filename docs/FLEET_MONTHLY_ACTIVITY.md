# Monthly fleet activity

Richard selected this definition on November 7, 2026: count each driver once
if they complete at least one monitoring session in the calendar month.

The candidate uses UTC calendar months, explicitly labeled on the dashboard.
Completion is a stored `ended_at` that is at or after `started_at` and no later
than the server's transaction time. The completion timestamp selects the month,
including a session started in a prior month. The interval includes the month's
first instant and excludes the next month's first instant. Repeated sessions
count once per distinct driver. Open sessions, reversed durations and future
ends do not count. There is no minimum duration in the selected definition.

The session's stored fleet attribution defines ownership. A later roster
deactivation or membership change does not rewrite that history. Deleted or
unrecorded sessions cannot be counted; this is stored, client-reported activity,
not verified driving or a billing ledger. Current roster size, the roster's
`active` flag, and the latest 50-session snapshot are separate metrics.

`fleet_monthly_activity` checks the server-supplied owner against the fleet and
returns only a versioned count, month, timezone and server observation time.
Only service_role may execute it; the API derives actor and fleet identity from
verified authentication and the owned fleet lookup. Extra provider fields are
removed. No driver identities, coordinates, personal media or raw motion are
added to this aggregate. The API never substitutes a partial snapshot or zero
for a missing migration, invalid aggregate or provider failure. Zero means a
successful query found no qualifying recorded driver.

The dashboard clears the count across sign-out/account changes, labels retained
counts when refresh fails and shows the month and observation time. Local/demo
mode has no monthly count. Billing, entitlements and driver access are unchanged.

Deployment requires the migration and independent owner-isolation/grant checks.
Source tests use synthetic data only; no production migration, activation or
native build is included.
