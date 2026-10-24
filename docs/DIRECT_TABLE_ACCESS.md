# Direct table access

The web and native apps reach Supabase only for Auth. Every table read and
write goes through `/api`, which verifies the bearer token, applies the
route's checks and rate limits, and then calls PostgREST with the server-only
service-role key.

Until `supabase/migrations/20261022120000_revoke_direct_table_access.sql`,
Supabase's default grants also gave the browser roles (`anon`,
`authenticated`) privileges on the six original tables: `fleets`, `drivers`,
`fleet_invitations`, `sessions`, `events` and `pilot_leads`. Row-level
security limited which rows they saw, but a signed-in user holding the public
anon key from `/api/public-config` could still query the Data API directly:

- a fleet owner could read every assigned driver's name and email;
- a driver could read their own sessions and location events.

That bypassed the API's field selection, limits and audit points. Writes were
already closed because no insert, update or delete policy exists.

## What the migration does

- Revokes all privileges on the six tables from `public`, `anon` and
  `authenticated`.
- Grants `select, insert, update, delete` on them to `service_role`, so the API
  no longer depends on project-level default privileges. Supabase stops
  adding those defaults to new tables on October 30, 2026; explicit grants
  keep a fresh project working.
- Keeps row-level security and the select policies as a second layer.

Every other public table already revokes the browser roles in the migration
that creates it, and every public function is executable only by
`service_role`. `npm run test:tenant-rls` replays the full chain under
Supabase's legacy default grants and fails if any browser-role table or
function privilege remains.

## Applying it

Apply it with the same process as the other migrations in
[BACKEND_SETUP.md](../BACKEND_SETUP.md), any time after the baseline. It takes
a brief lock on each table (`lock_timeout` is 3 seconds) and changes no data.
No deploy is needed before or after; no client code reads these tables.

Verify in the SQL editor afterwards:

```sql
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by 1, 2
order by 1, 2;
```

Expected result: no rows. A direct Data API request such as
`GET /rest/v1/drivers?select=email` with the anon key and a user's access token
now returns `permission denied for table drivers` (`42501`).

## Rolling back

Nothing in the product needs the old access, so rollback should not be
necessary. If it is, this restores the previous exposure exactly:

```sql
grant all on table public.fleets, public.drivers, public.fleet_invitations,
  public.sessions, public.events, public.pilot_leads to anon, authenticated;
```
