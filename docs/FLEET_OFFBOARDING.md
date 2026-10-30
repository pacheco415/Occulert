# Fleet offboarding draft

This refreshes draft [#206](https://github.com/pacheco415/Occulert/pull/206) against current source. Server-only `OCCULERT_FLEET_OFFBOARDING_ENABLED` defaults off. No production SQL application, deployment acceptance or activation is recorded here. Apply and independently verify the new forward migration `supabase/migrations/20261030043839_fleet_offboarding.sql` before enabling the gate. It supersedes the old, unshipped October 3 draft migration; do not replay that obsolete draft or any already-applied migration.

## Membership and ongoing sessions

A verified fleet owner confirms removal of one protected driver through DELETE `/api/fleet-drivers`. A driver confirms leaving the currently displayed fleet through POST `/api/fleet-membership`; both actions include the displayed fleet ID as a precondition, never authority. A stale leave or owner confirmation cannot remove a replacement fleet membership. GET returns only the verified caller's membership. Actors always come from verified bearer tokens. The routes share the existing dispatcher and twelve-function budget.

Removal clears current membership and preserves the driver's active/name/display fields. Removed drivers can accept a new invitation. It does not delete an account, end a drive or change existing session fleet IDs. **An already running session, including events recorded after removal, continues to belong to its original fleet and remains visible through that fleet's authorized history.** This preserves the existing draft's explicit semantics; activation still requires the owner's review of this consequence. No new consent cutover or automatic restart policy is selected.

With the offboarding gate enabled, new session creation and both membership mutations serialize on the same driver-row lock. A start which acquires the lock after a committed removal uses detached membership; one after an accepted replacement invitation uses the new fleet. A start which acquires it before removal keeps its original fleet. Its server start time is assigned while holding the lock. Replaying an existing owned client session UUID returns the unchanged session; a UUID belonging to another driver conflicts. Default-off session requests keep their existing provider calls and behavior.

All three RPCs lock the actor's Auth row, then the relevant fleet parent with key-share locks, then the driver. This matches parent deletion cascades and prevents the demonstrated driver-first/audit-foreign-key deadlock with account deletion. The start RPC rechecks membership after obtaining these locks. If membership changed while it waited, a subtransaction releases stale fleet/driver locks and retries only the pre-insert read/lock work, at most three times; continuing churn returns a conflict without creating a session. No mutation is retried. An existing owned session UUID remains a read-only replay. Invitation acceptance keeps its existing invitation-then-driver lock order; these RPCs never lock an invitation. Multi-connection tests observe blocking directly.

## Audit and privacy

The RLS-protected audit table stores fleet/driver IDs, removal time, actor and `owner_removed` or `driver_left`. Only service-role code can access the table or execute these RPCs. Explicit grants work without default table privileges. Audit rows cascade when their fleet or driver is deleted; actor deletion sets its reference to null. No scheduled retention duration, public audit viewer or new telemetry field is introduced.

## Source acceptance and later activation

Browser controls require confirmation, preserve uncertain outcomes, refresh confirmed roster changes and suppress stale responses across account changes. Local demo rows do not expose removal controls. The component is network-only. Current source fixtures cover database/API behavior, role denials, re-invitation, stale leave, replay/conflict semantics and default-off behavior. Chromium/WebKit cover confirmation/cancellation, uncertainty, disabled controls and account/lifecycle races. The disposable PostgreSQL 17 harness separately covers real contention between removal, start, rollback, invitation/fleet replacement, bounded membership churn and owner-account deletion.

Before rollout: independently inspect the deployed migration/ACL/RPC definitions, confirm the ongoing-session consequence with the owner, and test scoped accounts before broader activation. Keep operational database/deployment receipts private. Source tests do not establish those production prerequisites.
