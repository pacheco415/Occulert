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
alter table sessions enable row level security;
alter table events enable row level security;
alter table pilot_leads enable row level security;

-- Pilot leads are inserted only by the serverless API with the service-role
-- key. No browser-facing policy is intentionally defined.

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
