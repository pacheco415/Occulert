-- Atomic cancellation guards for delayed native session uploads. Fleet
-- visibility requires a server-issued token captured before the drive, not
-- an unverified client wall-clock timestamp.

alter table public.drivers
  add column if not exists fleet_sync_token uuid default gen_random_uuid(),
  add column if not exists session_cleanup_token uuid default gen_random_uuid();
update public.drivers set fleet_sync_token = gen_random_uuid()
where fleet_sync_token is null;
update public.drivers set session_cleanup_token = gen_random_uuid()
where session_cleanup_token is null;
alter table public.drivers
  alter column fleet_sync_token set default gen_random_uuid(),
  alter column fleet_sync_token set not null,
  alter column session_cleanup_token set default gen_random_uuid(),
  alter column session_cleanup_token set not null;
create unique index if not exists drivers_session_cleanup_token_unique
  on public.drivers(session_cleanup_token);

-- A per-session random UUID works with the driver's stable cleanup UUID. They
-- let a signed-out client delete a pending session, including a late
-- finalization during revocation, without retaining a refresh token.
alter table public.sessions
  add column if not exists sync_cancel_token uuid;
revoke select on public.sessions from public, anon, authenticated;
grant select (id, driver_id, fleet_id, started_at, ended_at, average_fatigue,
  max_fatigue, safety_score, alert_count, head_nod_count, device, browser)
  on public.sessions to authenticated;

-- Both driver capabilities are returned only by the owner-authenticated
-- profile API. Direct reads retain their previous columns without exposing
-- either token.
revoke select on public.drivers from public, anon, authenticated;
grant select (id, fleet_id, user_id, name, email, vehicle_id, active, created_at)
  on public.drivers to authenticated;

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

drop trigger if exists drivers_rotate_fleet_sync_token on public.drivers;
create trigger drivers_rotate_fleet_sync_token
before update of fleet_id on public.drivers
for each row execute function public.rotate_driver_fleet_sync_token();

create table if not exists public.session_sync_cancellations (
  session_id uuid not null,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  primary key (session_id, driver_id)
);

create index if not exists session_sync_cancellations_expires_idx
  on public.session_sync_cancellations(expires_at);

-- Cleanup receipts are driver-bound and survive until that driver is deleted.
-- They settle both lost acknowledgements and creates that never reached the
-- database while preventing requests without the private driver capability.
create table if not exists public.session_sync_token_cancellations (
  session_id uuid not null,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  cancel_token uuid not null,
  cancelled_at timestamptz not null default now(),
  primary key (session_id, driver_id, cancel_token)
);
alter table public.session_sync_token_cancellations
  drop constraint if exists session_sync_token_cancellations_pkey;
alter table public.session_sync_token_cancellations
  add primary key (session_id, driver_id, cancel_token);

alter table public.session_sync_cancellations enable row level security;
alter table public.session_sync_token_cancellations enable row level security;
revoke all on public.session_sync_cancellations from public, anon, authenticated;
revoke all on public.session_sync_token_cancellations from public, anon, authenticated;
revoke all on function public.rotate_driver_fleet_sync_token() from public, anon, authenticated;

drop function if exists public.start_session_sync_v1(uuid, uuid, uuid, timestamptz, text, text);
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
  -- Hold a membership row lock until the insert commits. Token validation and
  -- fleet lookup therefore have one transaction boundary with session start.
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

  insert into public.sessions (
    id, driver_id, fleet_id, sync_cancel_token, started_at, device, browser
  ) values (
    p_session_id, p_driver_id, session_fleet_id, p_cancel_token, p_started_at,
    left(p_device, 120), left(p_browser, 240)
  ) on conflict (id) do nothing;

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

  return jsonb_build_object(
    'deleted', was_deleted,
    'cancellation_recorded', true
  );
end;
$$;

drop function if exists public.cancel_session_sync_token_v1(uuid, uuid);
drop function if exists public.cancel_session_sync_token_v1(uuid, uuid, uuid);
create function public.cancel_session_sync_token_v1(
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
    -- A valid capability disappears only when its driver is deleted, which
    -- also cascades every session and receipt owned by that driver.
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
  -- Consent may be revoked while a final PATCH is in flight. The per-session
  -- capability therefore removes the matching row whether or not that PATCH
  -- committed first.
  delete from public.sessions
  where id = p_session_id
    and driver_id = cleanup_driver_id
    and sync_cancel_token = p_cancel_token;
  was_deleted := found;
  if not was_deleted and exists (
    select 1 from public.sessions where id = p_session_id
  ) then
    -- The ID already belongs to a row outside this exact capability.
    return jsonb_build_object('settled', false, 'deleted', false, 'conflict', true);
  end if;
  insert into public.session_sync_token_cancellations(session_id, driver_id, cancel_token)
  values (p_session_id, cleanup_driver_id, p_cancel_token)
  on conflict (session_id, driver_id, cancel_token) do nothing;
  return jsonb_build_object('settled', true, 'deleted', was_deleted);
end;
$$;

revoke all on function public.start_session_sync_v1(uuid, uuid, uuid, uuid, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.start_session_sync_v1(uuid, uuid, uuid, uuid, timestamptz, text, text) to service_role;
revoke all on function public.cancel_session_sync_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_session_sync_v1(uuid, uuid) to service_role;
revoke all on function public.cancel_session_sync_token_v1(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_session_sync_token_v1(uuid, uuid, uuid) to service_role;
