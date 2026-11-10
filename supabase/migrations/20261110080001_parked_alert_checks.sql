-- Apply and verify before deploying /api/parked-alert-checks and its clients.
-- Keep only the latest self-reported output check per driver and fleet. This
-- is setup progress, never proof of alert delivery, alertness or fitness.
set local lock_timeout = '3s';

create table public.parked_alert_checks (
  driver_id uuid not null references public.drivers(id) on delete cascade,
  fleet_id uuid not null references public.fleets(id) on delete cascade,
  completed_at timestamptz not null check (isfinite(completed_at)),
  platform text not null check (platform in ('web', 'ios', 'android')),
  confirmed boolean not null,
  received_at timestamptz not null default clock_timestamp() check (isfinite(received_at)),
  primary key (driver_id, fleet_id)
);
alter table public.parked_alert_checks enable row level security;
revoke all on public.parked_alert_checks from public, anon, authenticated;
grant select, insert, update, delete on public.parked_alert_checks to service_role;
create index parked_alert_checks_fleet_idx on public.parked_alert_checks(fleet_id, driver_id);

-- The API supplies only its verified actor. Neither a browser nor this RPC's
-- caller can choose a driver/fleet ID. Invoker privileges retain the existing
-- service-role boundary without granting access to the managed auth schema.
create function public.record_parked_alert_check(
  p_actor_id uuid, p_completed_at timestamptz, p_platform text, p_confirmed boolean
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  expected_fleet uuid;
  target_driver public.drivers%rowtype;
  saved public.parked_alert_checks%rowtype;
  checked_at timestamptz := clock_timestamp();
begin
  if p_actor_id is null or p_completed_at is null or not isfinite(p_completed_at)
    or p_completed_at < checked_at - interval '24 hours'
    or p_completed_at > checked_at + interval '5 minutes'
    or p_platform is null or p_platform not in ('web', 'ios', 'android')
    or p_confirmed is null then
    return jsonb_build_object('error', 'invalid_parked_alert_check');
  end if;

  select d.fleet_id into expected_fleet from public.drivers d
    where d.user_id = p_actor_id and d.active;
  if not found or expected_fleet is null then
    return jsonb_build_object('error', 'driver_not_in_active_fleet');
  end if;

  -- Lock the fleet before its driver, matching parent deletion and the
  -- session-start path. Recheck membership under the driver lock so a
  -- concurrent invitation/removal cannot stamp the wrong fleet. On churn,
  -- report conflict; never retry a mutation or silently follow a new fleet.
  perform 1 from public.fleets where id = expected_fleet for key share;
  if not found then return jsonb_build_object('error', 'membership_changed'); end if;
  select d.* into target_driver from public.drivers d
    where d.user_id = p_actor_id for update;
  if not found or not target_driver.active then
    return jsonb_build_object('error', 'driver_not_in_active_fleet');
  end if;
  if target_driver.fleet_id is distinct from expected_fleet then
    return jsonb_build_object('error', 'membership_changed');
  end if;

  -- Completion time orders checks, not arrival time. A delayed older "yes"
  -- must not overwrite a newer "no". Identical repeats are read-only.
  select c.* into saved from public.parked_alert_checks c
    where c.driver_id = target_driver.id and c.fleet_id = expected_fleet;
  if found and saved.completed_at >= p_completed_at then
    if saved.completed_at = p_completed_at and saved.platform = p_platform
      and saved.confirmed = p_confirmed then
      return jsonb_build_object('check', jsonb_build_object(
        'completed_at', saved.completed_at, 'platform', saved.platform, 'confirmed', saved.confirmed));
    end if;
    return jsonb_build_object('error', 'stale_parked_alert_check');
  end if;

  insert into public.parked_alert_checks(driver_id, fleet_id, completed_at, platform, confirmed, received_at)
    values(target_driver.id, expected_fleet, p_completed_at, p_platform, p_confirmed, clock_timestamp())
    on conflict (driver_id, fleet_id) do update
      set completed_at = excluded.completed_at, platform = excluded.platform,
          confirmed = excluded.confirmed, received_at = excluded.received_at
    returning * into saved;
  return jsonb_build_object('check', jsonb_build_object(
    'completed_at', saved.completed_at, 'platform', saved.platform, 'confirmed', saved.confirmed));
end;
$$;
revoke all on function public.record_parked_alert_check(uuid, timestamptz, text, boolean)
  from public, anon, authenticated;
grant execute on function public.record_parked_alert_check(uuid, timestamptz, text, boolean) to service_role;

-- A single snapshot checks current ownership and aggregates the entire active
-- roster. A driver's old fleet check cannot count for their new fleet. No
-- participant identifiers, timestamps or individual answers leave this RPC.
-- The server-selected fleet ID lets clients correlate separate fleet reads.
create function public.fleet_parked_alert_check_counts(p_actor_id uuid)
returns jsonb language sql stable security invoker
set search_path = pg_catalog, pg_temp
as $$
  select jsonb_build_object(
    'fleet_id', f.id,
    'active_driver_count', count(d.id),
    'confirmed_driver_count', count(c.driver_id) filter (where c.confirmed)
  )
  from public.fleets f
  left join public.drivers d on d.fleet_id = f.id and d.active
  left join public.parked_alert_checks c on c.driver_id = d.id and c.fleet_id = f.id
  where f.owner_user_id = p_actor_id
  group by f.id
$$;
revoke all on function public.fleet_parked_alert_check_counts(uuid) from public, anon, authenticated;
grant execute on function public.fleet_parked_alert_check_counts(uuid) to service_role;
