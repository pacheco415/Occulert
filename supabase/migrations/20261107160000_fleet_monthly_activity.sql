-- Owner-approved definition (2026-11-07): one driver with at least one
-- completed monitoring session in a calendar month. Use UTC completion time
-- and the session's stored fleet attribution, not the current roster flag.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create index if not exists sessions_fleet_completed_at_idx
  on public.sessions (fleet_id, ended_at, driver_id)
  where ended_at is not null;

create or replace function public.fleet_monthly_activity(p_actor_id uuid, p_fleet_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_start timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  v_end timestamptz;
  v_count bigint;
begin
  if not exists (select 1 from public.fleets
      where id = p_fleet_id and owner_user_id = p_actor_id) then
    return null;
  end if;
  v_end := (v_start at time zone 'UTC' + interval '1 month') at time zone 'UTC';
  select count(distinct driver_id) into v_count from public.sessions
    where fleet_id = p_fleet_id and ended_at >= v_start and ended_at < v_end
      and ended_at <= v_now and ended_at >= started_at;
  return jsonb_build_object('version', 1, 'definition', 'completed_session_v1',
    'timezone', 'UTC', 'month', to_char(v_start at time zone 'UTC', 'YYYY-MM'),
    'as_of', v_now, 'active_drivers', v_count);
end;
$$;

revoke all on function public.fleet_monthly_activity(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fleet_monthly_activity(uuid, uuid) to service_role;
