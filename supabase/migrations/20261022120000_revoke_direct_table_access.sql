-- Close the Supabase Data API path to the original six tables. The web and
-- native clients never query them directly: every read and write goes through
-- /api with the server-only service-role key. Supabase's default grants still
-- gave the browser roles table privileges, so a signed-in user holding the
-- public anon key could read rows that row-level security allowed (fleet
-- owners: their drivers' names and emails; drivers: their sessions and
-- location events) without any of the API's checks or rate limits.
--
-- Row-level security and the existing select policies stay in place as a
-- second layer if a grant is ever restored by mistake. Every other public
-- table already revokes these roles in the migration that creates it.
set local lock_timeout = '3s';

revoke all on table
  public.fleets,
  public.drivers,
  public.fleet_invitations,
  public.sessions,
  public.events,
  public.pilot_leads
from public, anon, authenticated;

-- These tables relied on Supabase default privileges for the service role.
-- State the API's access explicitly so it does not depend on project defaults.
grant select, insert, update, delete on table
  public.fleets,
  public.drivers,
  public.fleet_invitations,
  public.sessions,
  public.events,
  public.pilot_leads
to service_role;
