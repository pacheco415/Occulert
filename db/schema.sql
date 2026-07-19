-- Occulert backend schema (Supabase / Postgres)
-- Run this in the Supabase SQL editor for a NEW project you create yourself.
-- Matches the tables described in BACKEND_ROADMAP.md.
-- This file is scaffolding only: review before running against real data.

create extension if not exists "pgcrypto";

create table if not exists fleets (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  owner_user_id uuid not null references auth.users(id),
  plan text not null default 'trial',
  created_at timestamptz not null default now()
  );

create unique index if not exists fleets_owner_user_id_unique
on fleets(owner_user_id);

create table if not exists drivers (
  id uuid primary key default gen_random_uuid(),
  fleet_id uuid references fleets(id) on delete cascade,
  user_id uuid references auth.users(id),
  name text not null,
  email text,
  vehicle_id text,
  active boolean not null default true,
  created_at timestamptz not null default now()
  );

create unique index if not exists drivers_user_id_unique
on drivers(user_id) where user_id is not null;

create table if not exists fleet_invitations (
  id uuid primary key default gen_random_uuid(),
  fleet_id uuid not null references fleets(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
  );

create index if not exists fleet_invitations_fleet_created_idx
on fleet_invitations(fleet_id, created_at desc);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers(id) on delete cascade,
  fleet_id uuid references fleets(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  average_fatigue numeric,
  max_fatigue numeric,
  safety_score numeric,
  alert_count integer default 0,
  head_nod_count integer default 0,
  device text,
  browser text
  );

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
alter table pilot_leads enable row level security;

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
