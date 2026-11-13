-- Owner-approved definition (2026-11-07): one driver with at least one
-- completed monitoring session in a calendar month. Use Pacific calendar months
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
  v_local_month timestamp := date_trunc('month', v_now at time zone 'America/Los_Angeles');
  v_start timestamptz := v_local_month at time zone 'America/Los_Angeles';
  v_end timestamptz;
  v_count bigint;
begin
  if not exists (select 1 from public.fleets
      where id = p_fleet_id and owner_user_id = p_actor_id) then
    return null;
  end if;
  v_end := (v_local_month + interval '1 month') at time zone 'America/Los_Angeles';
  select count(distinct driver_id) into v_count from public.sessions
    where fleet_id = p_fleet_id and ended_at >= v_start and ended_at < v_end
      and ended_at <= v_now and ended_at >= started_at;
  return jsonb_build_object('version', 1, 'definition', 'completed_session_v1',
    'timezone', 'America/Los_Angeles', 'month', to_char(v_local_month, 'YYYY-MM'),
    'as_of', v_now, 'active_drivers', v_count);
end;
$$;

revoke all on function public.fleet_monthly_activity(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fleet_monthly_activity(uuid, uuid) to service_role;
