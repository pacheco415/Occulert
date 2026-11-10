# Fleet query indexes

The deployed database advisor identified six foreign keys without covering indexes. Fleet reads filtered trips, roster entries, and events using those columns. This migration adds:

| Index | Purpose |
| --- | --- |
| `drivers_fleet_id_idx` | Owner-scoped roster lookup and fleet references |
| `sessions_fleet_started_id_idx` | Latest trips within a fleet, including a stable ID tie-break for follow-ups |
| `sessions_driver_id_idx` | Driver references and account cleanup |
| `events_session_created_idx` | Session events ordered by timestamp |
| `fleet_invitations_invited_by_idx` | Inviter references and account cleanup |
| `fleet_invitations_accepted_by_idx` | Acceptor references and account cleanup |

No permissions, policies, telemetry fields, or returned data change. Existing primary keys and the owner/user uniqueness indexes remain intact.

`npm run test:fleet-indexes` executes the actual migration in PGlite against synthetic 20,000-row tables. Without disabling sequential scans, the planner selects all six new indexes; latest-trip reads no longer require a separate sort. Results before and after migration are identical. This verifies the access paths, not a promised production latency or battery improvement.

The migration uses a three-second lock timeout and 30-second statement timeout. It is appropriate for the current small tables. If a later deployment times out on a busy or much larger database, schedule a maintenance window or prepare a separately reviewed concurrent index build; do not increase the timeout blindly. These indexes add storage and some write overhead.

After applying the migration, inspect index validity and run the Supabase performance advisor. Newly created indexes can be reported as unused until real queries use them; retain them when they cover the verified query and foreign-key access paths. RLS policy optimization and reporting pagination remain separate work.

## Bounded summary snapshot

`/api/fleet-summary` selects at most 500 drivers from the verified owner's fleet,
ordered by ID ascending. The additive `roster_limit: 500` response field states
that bound; the returned roster is not a full-fleet total. Reaching the limit
does not establish that more drivers exist, so the route makes no completeness
or truncation claim and performs no extra count query. Pagination and adapting
the dashboard to larger rosters remain separate work.

Sessions retain their latest-50 ordering. Events retain their 200-row limit and
use `created_at.desc,id.desc` so equal timestamps have a deterministic selection
at that boundary. Existing owner/fleet/session scopes and privacy projections
remain unchanged. `test-api-security.mjs` runs these actual query selections in
PGlite with 501 owned drivers, foreign rows and tied event timestamps in both
insertion orders; response contracts retain no-store and timing/privacy fields.

References: [Supabase query optimization](https://supabase.com/docs/guides/database/query-optimization), [unindexed foreign key advisor](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).
