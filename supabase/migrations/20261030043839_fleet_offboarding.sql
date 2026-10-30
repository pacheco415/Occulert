-- Unshipped draft: apply and verify before enabling OCCULERT_FLEET_OFFBOARDING_ENABLED.
create table public.fleet_membership_removals (
  id uuid primary key default gen_random_uuid(),
  fleet_id uuid not null references public.fleets(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  removed_at timestamptz not null default now(),
  removed_by uuid references auth.users(id) on delete set null,
  reason text not null check (reason in ('owner_removed','driver_left'))
);
alter table public.fleet_membership_removals enable row level security;
revoke all on public.fleet_membership_removals from public, anon, authenticated;
grant select, insert, update, delete on public.fleet_membership_removals to service_role;

create or replace function public.remove_fleet_driver(p_owner_user_id uuid, p_driver_id uuid, p_expected_fleet_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare target_fleet uuid; target_driver public.drivers%rowtype;
begin
  perform 1 from auth.users where id = p_owner_user_id for key share;
  if not found then return jsonb_build_object('error', 'fleet_not_found'); end if;
  select id into target_fleet from public.fleets where owner_user_id = p_owner_user_id for key share;
  if not found then return jsonb_build_object('error', 'fleet_not_found'); end if;
  if p_expected_fleet_id is null or target_fleet <> p_expected_fleet_id then
    return jsonb_build_object('error', 'membership_changed');
  end if;
  select * into target_driver from public.drivers where id = p_driver_id and fleet_id = target_fleet for update;
  if not found then return jsonb_build_object('error', 'driver_not_found'); end if;
  update public.drivers set fleet_id = null where id = target_driver.id;
  insert into public.fleet_membership_removals(fleet_id, driver_id, removed_by, reason)
    values(target_fleet, target_driver.id, p_owner_user_id, 'owner_removed');
  return jsonb_build_object('removed', true, 'driver_id', target_driver.id);
end; $$;

create or replace function public.leave_fleet(p_user_id uuid, p_expected_fleet_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare target_driver public.drivers%rowtype;
begin
  perform 1 from auth.users where id = p_user_id for key share;
  if not found then return jsonb_build_object('error', 'driver_profile_not_found'); end if;
  -- Lock the displayed parent before its driver, matching deletion cascades.
  perform 1 from public.fleets where id = p_expected_fleet_id for key share;
  select * into target_driver from public.drivers where user_id = p_user_id for update;
  if not found then return jsonb_build_object('error', 'driver_profile_not_found'); end if;
  if target_driver.fleet_id is null then return jsonb_build_object('left', false); end if;
  if p_expected_fleet_id is null or target_driver.fleet_id <> p_expected_fleet_id then
    return jsonb_build_object('error', 'membership_changed');
  end if;
  update public.drivers set fleet_id = null where id = target_driver.id;
  insert into public.fleet_membership_removals(fleet_id, driver_id, removed_by, reason)
    values(target_driver.fleet_id, target_driver.id, p_user_id, 'driver_left');
  return jsonb_build_object('left', true, 'driver_id', target_driver.id);
end; $$;

-- All three RPCs lock actor -> fleet -> driver, matching parent deletion
-- cascades. Taking the driver first would deadlock with account/fleet deletion
-- when the later audit/session foreign-key check waits on that parent.
-- A start before removal retains its fleet, including subsequent events.
create or replace function public.start_offboarding_aware_session(
  p_user_id uuid, p_session_id uuid, p_device text, p_browser text,
  p_detector_pipeline text, p_detector_version text, p_app_version text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare target_driver public.drivers%rowtype; stored public.sessions%rowtype;
  expected_fleet uuid; attempt integer;
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
  perform 1 from auth.users where id = p_user_id for key share;
  if not found then return jsonb_build_object('error', 'driver_profile_not_found'); end if;
  -- Replaying an existing owned UUID is read-only and never re-scopes it,
  -- even if the driver has moved to another fleet since this session began.
  if p_session_id is not null then
    select s.* into stored from public.sessions s join public.drivers d on d.id = s.driver_id
      where s.id = p_session_id and d.user_id = p_user_id;
    if found then return jsonb_build_object('session', to_jsonb(stored)); end if;
  end if;
  for attempt in 1..3 loop
    begin
      select fleet_id into expected_fleet from public.drivers where user_id = p_user_id;
      if not found then return jsonb_build_object('error', 'driver_profile_not_found'); end if;
      if expected_fleet is not null then
        perform 1 from public.fleets where id = expected_fleet for key share;
        if not found then raise exception using errcode = 'PFO01', message = 'membership_changed_during_start'; end if;
      end if;
      select * into target_driver from public.drivers where user_id = p_user_id for update;
      if not found then return jsonb_build_object('error', 'driver_profile_not_found'); end if;
      if target_driver.fleet_id is distinct from expected_fleet then
        raise exception using errcode = 'PFO01', message = 'membership_changed_during_start';
      end if;
      if p_session_id is not null then
        select * into stored from public.sessions where id = p_session_id and driver_id = target_driver.id;
        if found then return jsonb_build_object('session', to_jsonb(stored)); end if;
      end if;
      begin
        insert into public.sessions(id, driver_id, fleet_id, started_at, device, browser,
          detector_pipeline, detector_version, app_version)
        values(coalesce(p_session_id, gen_random_uuid()), target_driver.id, target_driver.fleet_id,
          clock_timestamp(), p_device, p_browser, p_detector_pipeline, p_detector_version, p_app_version)
        returning * into stored;
      exception when unique_violation then
        if p_session_id is null then raise; end if;
        select * into stored from public.sessions where id = p_session_id and driver_id = target_driver.id;
        if not found then return jsonb_build_object('error', 'session_id_conflict'); end if;
      end;
      return jsonb_build_object('session', to_jsonb(stored));
    exception when sqlstate 'PFO01' then
      -- Only pre-insert read/lock work is retried. The subtransaction releases
      -- stale fleet/driver locks before rereading; a mutation is never retried.
      null;
    end;
  end loop;
  return jsonb_build_object('error', 'membership_changed');
end; $$;

revoke all on function public.remove_fleet_driver(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.leave_fleet(uuid, uuid) from public, anon, authenticated;
revoke all on function public.start_offboarding_aware_session(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.remove_fleet_driver(uuid, uuid, uuid) to service_role;
grant execute on function public.leave_fleet(uuid, uuid) to service_role;
grant execute on function public.start_offboarding_aware_session(uuid, uuid, text, text, text, text, text) to service_role;
