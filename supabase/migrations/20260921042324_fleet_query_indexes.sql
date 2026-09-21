-- Bound lock waits so a busy database fails the migration instead of blocking
-- application writes indefinitely. Retry during a quieter window if necessary.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create index drivers_fleet_id_idx on public.drivers (fleet_id);
create index sessions_fleet_started_id_idx on public.sessions (fleet_id, started_at desc, id desc);
create index sessions_driver_id_idx on public.sessions (driver_id);
create index events_session_created_idx on public.events (session_id, created_at desc);
create index fleet_invitations_invited_by_idx on public.fleet_invitations (invited_by);
create index fleet_invitations_accepted_by_idx on public.fleet_invitations (accepted_by);
