-- Occulert backend schema (Supabase / Postgres)
-- Run this in the Supabase SQL editor for a NEW project you create yourself.
-- Matches the tables described in BACKEND_ROADMAP.md.
-- This file is scaffolding only: review before running against real data.

create extension if not exists "pgcrypto";

create table if not exists fleets (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null default 'trial',
  created_at timestamptz not null default now()
  );

create unique index if not exists fleets_owner_user_id_unique
on fleets(owner_user_id);

create table if not exists drivers (
  id uuid primary key default gen_random_uuid(),
  fleet_id uuid references fleets(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  email text,
  vehicle_id text,
  active boolean not null default true,
  fleet_sync_token uuid not null default gen_random_uuid(),
  session_cleanup_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
  );

create unique index if not exists drivers_user_id_unique
on drivers(user_id) where user_id is not null;

create unique index if not exists drivers_session_cleanup_token_unique
on drivers(session_cleanup_token);

revoke select on drivers from public, anon, authenticated;
grant select (id, fleet_id, user_id, name, email, vehicle_id, active, created_at)
on drivers to authenticated;

create or replace function public.rotate_driver_fleet_sync_token()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.fleet_id is distinct from old.fleet_id then
    new.fleet_sync_token := gen_random_uuid();
  end if;
  return new;
end;
$$;

create trigger drivers_rotate_fleet_sync_token
before update of fleet_id on public.drivers
for each row execute function public.rotate_driver_fleet_sync_token();

create table if not exists fleet_invitations (
  id uuid primary key default gen_random_uuid(),
  fleet_id uuid not null references fleets(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete cascade,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
  );

create index if not exists fleet_invitations_fleet_created_idx
on fleet_invitations(fleet_id, created_at desc);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers(id) on delete cascade,
  fleet_id uuid references fleets(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  average_fatigue numeric,
  max_fatigue numeric,
  safety_score numeric,
  alert_count integer default 0,
  head_nod_count integer default 0,
  device text,
  browser text,
  sync_cancel_token uuid
  );

create index if not exists sessions_fleet_started_cursor_idx
on sessions(fleet_id, started_at desc, id desc);

create or replace function public.fleet_session_report_v1(
  p_fleet_id uuid,
  p_from timestamptz,
  p_through timestamptz
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with bounded as materialized (
    select
      id, driver_id, started_at, ended_at, average_fatigue, max_fatigue,
      safety_score, alert_count, head_nod_count
    from public.sessions
    where fleet_id = p_fleet_id
      and ended_at is not null
      and started_at >= p_from
      and started_at <= p_through
    order by started_at desc, id desc
    limit 2001
  )
  select jsonb_build_object(
    'sessions', coalesce((
      select jsonb_agg(to_jsonb(report_row) order by report_row.started_at desc, report_row.id desc)
      from (
        select * from bounded
        order by started_at desc, id desc
        limit 2000
      ) as report_row
    ), '[]'::jsonb),
    'complete', (select count(*) <= 2000 from bounded)
  );
$$;

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  type text not null,
  fatigue_score numeric,
  confidence numeric,
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now()
  );

create table if not exists session_sync_cancellations (
  session_id uuid not null,
  driver_id uuid not null references drivers(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  primary key (session_id, driver_id)
  );

create index if not exists session_sync_cancellations_expires_idx
on session_sync_cancellations(expires_at);

create table if not exists session_sync_token_cancellations (
  session_id uuid not null,
  driver_id uuid not null references drivers(id) on delete cascade,
  cancel_token uuid not null,
  cancelled_at timestamptz not null default now(),
  primary key (session_id, driver_id, cancel_token)
  );

create or replace function public.start_session_sync_v1(
  p_session_id uuid,
  p_driver_id uuid,
  p_fleet_sync_token uuid,
  p_cancel_token uuid,
  p_started_at timestamptz,
  p_device text,
  p_browser text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  session_json jsonb;
  session_fleet_id uuid;
  current_fleet_sync_token uuid;
begin
  if p_session_id is null or p_driver_id is null or p_cancel_token is null or p_started_at is null then
    raise exception using errcode = 'P0001', message = 'invalid_session_start';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));
  select fleet_id, fleet_sync_token
    into session_fleet_id, current_fleet_sync_token
  from public.drivers
  where id = p_driver_id
  for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_driver';
  end if;
  if p_fleet_sync_token is null
     or p_fleet_sync_token is distinct from current_fleet_sync_token then
    session_fleet_id := null;
  end if;
  delete from public.session_sync_cancellations where expires_at <= now();
  if exists (
    select 1 from public.session_sync_cancellations
    where session_id = p_session_id and driver_id = p_driver_id and expires_at > now()
  ) then
    return jsonb_build_object('cancelled', true);
  end if;
  if exists (
    select 1 from public.session_sync_token_cancellations
    where session_id = p_session_id
      and driver_id = p_driver_id
      and cancel_token = p_cancel_token
  ) then
    return jsonb_build_object('cancelled', true);
  end if;
  insert into public.sessions (id, driver_id, fleet_id, sync_cancel_token, started_at, device, browser)
  values (p_session_id, p_driver_id, session_fleet_id, p_cancel_token, p_started_at, left(p_device, 120), left(p_browser, 240))
  on conflict (id) do nothing;
  select to_jsonb(session) - 'sync_cancel_token' into session_json
  from public.sessions as session
  where session.id = p_session_id
    and session.driver_id = p_driver_id
    and session.sync_cancel_token = p_cancel_token;
  if session_json is null then
    return jsonb_build_object('cancelled', false, 'conflict', true);
  end if;
  return jsonb_build_object('cancelled', false, 'conflict', false, 'session', session_json);
end;
$$;

create or replace function public.cancel_session_sync_token_v1(
  p_session_id uuid,
  p_cancel_token uuid,
  p_cleanup_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cleanup_driver_id uuid;
  was_deleted boolean := false;
begin
  if p_session_id is null or p_cancel_token is null or p_cleanup_token is null then
    raise exception using errcode = 'P0001', message = 'invalid_session_cancel';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));
  select id into cleanup_driver_id
  from public.drivers
  where session_cleanup_token = p_cleanup_token
  for key share;
  if not found then
    return jsonb_build_object('settled', false, 'deleted', false, 'invalid_capability', true);
  end if;
  if exists (
    select 1 from public.session_sync_token_cancellations
    where session_id = p_session_id
      and driver_id = cleanup_driver_id
      and cancel_token = p_cancel_token
  ) then
    return jsonb_build_object('settled', true, 'deleted', false);
  end if;
  delete from public.sessions
  where id = p_session_id
    and driver_id = cleanup_driver_id
    and sync_cancel_token = p_cancel_token;
  was_deleted := found;
  if not was_deleted and exists (
    select 1 from public.sessions where id = p_session_id
  ) then
    return jsonb_build_object('settled', false, 'deleted', false, 'conflict', true);
  end if;
  insert into public.session_sync_token_cancellations(session_id, driver_id, cancel_token)
  values (p_session_id, cleanup_driver_id, p_cancel_token)
  on conflict (session_id, driver_id, cancel_token) do nothing;
  return jsonb_build_object('settled', true, 'deleted', was_deleted);
end;
$$;

create or replace function public.cancel_session_sync_v1(
  p_session_id uuid,
  p_driver_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  was_deleted boolean;
begin
  if p_session_id is null or p_driver_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_session_cancel';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));
  perform 1 from public.drivers where id = p_driver_id for key share;
  if not found then
    return jsonb_build_object('deleted', false, 'cancellation_recorded', true);
  end if;
  delete from public.session_sync_cancellations where expires_at <= now();
  delete from public.sessions
  where id = p_session_id and driver_id = p_driver_id and ended_at is null;
  was_deleted := found;
  insert into public.session_sync_cancellations(session_id, driver_id, expires_at)
  values (p_session_id, p_driver_id, now() + interval '7 days')
  on conflict (session_id, driver_id)
  do update set expires_at = excluded.expires_at;
  return jsonb_build_object('deleted', was_deleted, 'cancellation_recorded', true);
end;
$$;

create table if not exists pilot_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text,
  company text not null,
  email text not null,
  phone text,
  fleet text,
  use_case text,
  message text,
  source text not null default 'pilot-signup-page',
  received_at timestamptz not null default now()
  );

-- Row Level Security: drivers can only read their own rows; fleet managers
-- (fleet owners) can read rows scoped to their fleet. Writes go through the
-- serverless API using the service_role key, which bypasses RLS by design.
-- Review and extend these policies before allowing any direct client writes.

alter table fleets enable row level security;
alter table drivers enable row level security;
alter table fleet_invitations enable row level security;
alter table sessions enable row level security;
alter table events enable row level security;
alter table session_sync_cancellations enable row level security;
alter table session_sync_token_cancellations enable row level security;
alter table pilot_leads enable row level security;

revoke all on session_sync_cancellations from public, anon, authenticated;
revoke all on session_sync_token_cancellations from public, anon, authenticated;
revoke select on sessions from public, anon, authenticated;
grant select (id, driver_id, fleet_id, started_at, ended_at, average_fatigue,
  max_fatigue, safety_score, alert_count, head_nod_count, device, browser)
  on sessions to authenticated;
revoke all on function public.rotate_driver_fleet_sync_token() from public, anon, authenticated;
revoke all on function public.fleet_session_report_v1(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.fleet_session_report_v1(uuid, timestamptz, timestamptz) to service_role;
revoke all on function public.start_session_sync_v1(uuid, uuid, uuid, uuid, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.start_session_sync_v1(uuid, uuid, uuid, uuid, timestamptz, text, text) to service_role;
revoke all on function public.cancel_session_sync_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_session_sync_v1(uuid, uuid) to service_role;
revoke all on function public.cancel_session_sync_token_v1(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_session_sync_token_v1(uuid, uuid, uuid) to service_role;

-- Pilot leads are inserted only by the serverless API with the service-role
-- key. No browser-facing policy is intentionally defined.
-- Fleet invitations are also read and written only through authenticated
-- serverless APIs. No browser-facing policy is intentionally defined so
-- token hashes and invitation metadata cannot be queried directly.

create policy "fleet owner can read own fleet" on fleets
for select using (owner_user_id = auth.uid());

create policy "driver can read own profile" on drivers
for select using (user_id = auth.uid());

create policy "fleet owner can read fleet drivers" on drivers
for select using (fleet_id in (select id from fleets where owner_user_id = auth.uid()));

create policy "driver can read own sessions" on sessions
for select using (driver_id in (select id from drivers where user_id = auth.uid()));

create policy "fleet owner can read fleet sessions" on sessions
for select using (fleet_id in (select id from fleets where owner_user_id = auth.uid()));

create policy "driver can read own events" on events
for select using (session_id in (
  select s.id from sessions s join drivers d on d.id = s.driver_id where d.user_id = auth.uid()
  ));

-- The server calls this service-role-only function after verifying the user's
-- access token. Row locks keep invitation acceptance and fleet assignment
-- atomic, including when the same link is submitted twice concurrently.
create or replace function public.accept_fleet_invitation(
  p_token_hash text,
  p_user_id uuid,
  p_user_email text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invitation public.fleet_invitations%rowtype;
  driver_record public.drivers%rowtype;
  fleet_name text;
begin
  if p_token_hash is null or p_user_id is null or nullif(trim(p_user_email), '') is null then
    raise exception using errcode = 'P0001', message = 'invalid_invitation';
  end if;

  select * into invitation
  from public.fleet_invitations
  where token_hash = p_token_hash
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_invitation';
  end if;
  if invitation.accepted_at is not null then
    raise exception using errcode = 'P0001', message = 'invitation_already_used';
  end if;
  if invitation.revoked_at is not null then
    raise exception using errcode = 'P0001', message = 'invitation_revoked';
  end if;
  if invitation.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'invitation_expired';
  end if;
  if lower(trim(invitation.email)) <> lower(trim(p_user_email)) then
    raise exception using errcode = 'P0001', message = 'invitation_email_mismatch';
  end if;

  select * into driver_record
  from public.drivers
  where user_id = p_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'driver_profile_required';
  end if;
  if driver_record.fleet_id is not null and driver_record.fleet_id <> invitation.fleet_id then
    raise exception using errcode = 'P0001', message = 'driver_already_assigned';
  end if;

  update public.drivers
  set fleet_id = invitation.fleet_id
  where id = driver_record.id;

  update public.fleet_invitations
  set accepted_at = now(), accepted_by = p_user_id
  where id = invitation.id;

  select company_name into fleet_name
  from public.fleets
  where id = invitation.fleet_id;

  return jsonb_build_object(
    'fleet_id', invitation.fleet_id,
    'company_name', fleet_name,
    'driver_id', driver_record.id
  );
end;
$$;

revoke all on function public.accept_fleet_invitation(text, uuid, text) from public;
revoke all on function public.accept_fleet_invitation(text, uuid, text) from anon;
revoke all on function public.accept_fleet_invitation(text, uuid, text) from authenticated;
grant execute on function public.accept_fleet_invitation(text, uuid, text) to service_role;
