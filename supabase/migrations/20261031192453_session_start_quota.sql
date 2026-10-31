-- Apply and verify before deploying the default session-start quota path.
-- The existing atomic-event migration remains unchanged and must not be replayed.
set local lock_timeout = '3s';

create table public.session_start_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  start_count integer not null check (start_count between 0 and 30)
);
alter table public.session_start_rate_limits enable row level security;
revoke all on public.session_start_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.session_start_rate_limits to service_role;

-- Only the authenticated API may supply the verified actor. No driver, fleet,
-- timestamp or quota policy is accepted from a client. Definer privileges allow
-- the parent lock without expanding direct access to Supabase's auth schema.
create function public.start_rate_limited_session(
  p_user_id uuid, p_session_id uuid, p_device text, p_browser text,
  p_detector_pipeline text, p_detector_version text, p_app_version text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  target_driver public.drivers%rowtype;
  saved public.sessions%rowtype;
  bucket public.session_start_rate_limits%rowtype;
  expected_fleet uuid;
  checked_at timestamptz;
  attempt integer;
  membership_locked boolean := false;
  conflict_schema text;
  conflict_table text;
  conflict_constraint text;
begin
  if p_user_id is null or length(p_device) > 120 or length(p_browser) > 240
    or (p_detector_pipeline is not null and p_detector_pipeline not in
      ('web_mediapipe_ear', 'ios_mlkit_eye_probability', 'android_mlkit_eye_probability'))
    or (p_detector_version is not null and (length(p_detector_version) > 80
      or p_detector_version !~ '^[a-zA-Z0-9._() -]+$'))
    or (p_app_version is not null and (length(p_app_version) > 80
      or p_app_version !~ '^[a-zA-Z0-9._() -]+$')) then
    return jsonb_build_object('error', 'invalid_session');
  end if;

  -- Match account/fleet deletion's parent-before-child lock order. Locking a
  -- driver first can deadlock with the later session foreign-key parent check.
  perform 1 from auth.users where id = p_user_id for key share;
  if not found then return jsonb_build_object('error', 'driver_profile_not_found'); end if;

  -- A replay is read-only even at the quota limit or after fleet membership
  -- changes. Return the entire original row, including completed summaries.
  if p_session_id is not null then
    select s.* into saved from public.sessions s
      join public.drivers d on d.id = s.driver_id
      where s.id = p_session_id and d.user_id = p_user_id;
    if found then return jsonb_build_object('session', to_jsonb(saved), 'replayed', true); end if;
    if exists (select 1 from public.sessions where id = p_session_id) then
      return jsonb_build_object('error', 'session_id_conflict');
    end if;
  end if;

  for attempt in 1..3 loop
    begin
      select fleet_id into expected_fleet from public.drivers where user_id = p_user_id;
      if not found then return jsonb_build_object('error', 'driver_profile_not_found'); end if;
      if expected_fleet is not null then
        perform 1 from public.fleets where id = expected_fleet for key share;
        if not found then
          raise exception using errcode = 'PSQ01', message = 'membership_changed_during_start';
        end if;
      end if;
      select * into target_driver from public.drivers where user_id = p_user_id for update;
      if not found then return jsonb_build_object('error', 'driver_profile_not_found'); end if;
      if target_driver.fleet_id is distinct from expected_fleet then
        raise exception using errcode = 'PSQ01', message = 'membership_changed_during_start';
      end if;

      membership_locked := true;
      exit;
    exception when sqlstate 'PSQ01' then
      -- Retry only this iteration's pre-insert reads/locks, releasing stale
      -- fleet/driver locks at the subtransaction boundary. Never retry a write.
      null;
    end;
  end loop;
  if not membership_locked then return jsonb_build_object('error', 'membership_changed'); end if;

  -- The driver lock serializes same-owner starts, including the first
  -- counter insertion and simultaneous requests for the same client UUID.
  if p_session_id is not null then
    select * into saved from public.sessions
      where id = p_session_id and driver_id = target_driver.id;
    if found then return jsonb_build_object('session', to_jsonb(saved), 'replayed', true); end if;
    if exists (select 1 from public.sessions where id = p_session_id) then
      return jsonb_build_object('error', 'session_id_conflict');
    end if;
  end if;

  -- Writes are outside the read/lock retry block, even if a trigger raises
  -- its private retry SQLSTATE. A mutation is never attempted a second time.
  begin
    -- This subtransaction includes initialization: a losing UUID insert
    -- rolls back its newly created counter row as well as every mutation.
    insert into public.session_start_rate_limits values (p_user_id, clock_timestamp(), 0)
      on conflict (user_id) do nothing;
    select * into strict bucket from public.session_start_rate_limits
      where user_id = p_user_id for update;
    checked_at := clock_timestamp();
    if bucket.start_count = 0
      or bucket.window_started_at <= checked_at - interval '1 hour' then
      bucket.window_started_at := checked_at;
      bucket.start_count := 0;
    end if;
    if bucket.start_count >= 30 then
      return jsonb_build_object('error', 'session_start_rate_limited', 'retry_after',
        greatest(1, least(3600, ceil(extract(epoch from
          bucket.window_started_at + interval '1 hour' - checked_at))::integer)));
    end if;

    insert into public.sessions(id, driver_id, fleet_id, started_at, device, browser,
      detector_pipeline, detector_version, app_version)
    values(coalesce(p_session_id, gen_random_uuid()), target_driver.id, target_driver.fleet_id,
      checked_at, p_device, p_browser, p_detector_pipeline, p_detector_version, p_app_version)
    returning * into saved;
    update public.session_start_rate_limits
      set window_started_at = bucket.window_started_at, start_count = bucket.start_count + 1
      where user_id = p_user_id;
  exception when unique_violation then
    get stacked diagnostics conflict_schema = SCHEMA_NAME, conflict_table = TABLE_NAME,
      conflict_constraint = CONSTRAINT_NAME;
    if p_session_id is null or conflict_schema is distinct from 'public'
      or conflict_table is distinct from 'sessions' or conflict_constraint is distinct from 'sessions_pkey' then
      raise;
    end if;
    select * into saved from public.sessions
      where id = p_session_id and driver_id = target_driver.id;
    if found then return jsonb_build_object('session', to_jsonb(saved), 'replayed', true); end if;
    return jsonb_build_object('error', 'session_id_conflict');
  end;
  return jsonb_build_object('session', to_jsonb(saved), 'replayed', false);
end;
$$;

revoke all on function public.start_rate_limited_session(uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.start_rate_limited_session(uuid, uuid, text, text, text, text, text)
  to service_role;
