# Fleet offboarding gate

Apply and verify `supabase/migrations/20261003192500_fleet_offboarding.sql` before enabling server-only `OCCULERT_FLEET_OFFBOARDING_ENABLED=true`. It defaults off; controls stay hidden when the capability check fails. Production database authentication is unavailable, so deployment activation and migration application are not claimed.

A verified fleet owner can confirm removal of one driver through DELETE `/api/fleet-drivers`. A driver can confirm leaving through POST `/api/fleet-membership`; the confirmed fleet ID is a precondition, not authority, so a stale request cannot remove a newly joined membership. GET returns only the caller's own membership. Identity always comes from the verified token. All routes share the existing dispatcher and preserve the twelve-function deployment budget.

Service-role-only functions lock the driver row, clear its fleet association, preserve its active/display fields and record removal time, actor and reason in an RLS-protected audit table. Removed drivers can accept invitations to another fleet. Existing session fleet IDs remain fixed; sessions are not deleted or automatically restarted, and an existing drive keeps its historical fleet association. New sessions use the current membership. Audit records cascade with their fleet or driver; no new scheduled retention policy is selected.

Browser controls require confirmation, preserve uncertainty instead of claiming success, use current account contexts, refresh the roster after a confirmed removal and suppress late responses after account changes. Local demo rows never expose protected removal controls. This feature does not delete accounts or session history.
