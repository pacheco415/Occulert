-- Owner-only 7/30-day totals by Pacific wall-clock block.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create or replace function public.fleet_time_of_day_report(
  p_actor_id uuid, p_fleet_id uuid, p_days integer
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_zone constant text := 'America/Los_Angeles';
  v_end timestamptz := now();
  v_start timestamptz;
  v_blocks jsonb;
begin
  if p_days is null or p_days not in (7, 30) then
    raise exception 'Invalid reporting period' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.fleets where id = p_fleet_id and owner_user_id = p_actor_id
  ) then
    return null;
  end if;
  v_start := v_end - make_interval(days => p_days);

  with completed as (
    select id, started_at, ended_at from public.sessions
    where fleet_id = p_fleet_id and started_at between v_start and v_end
      and ended_at between started_at and v_end
  ), bins as (
    -- Convert each wall-clock boundary separately. Midnight to 4 am can
    -- span three or five elapsed hours on a daylight-saving transition.
    select extract(hour from wall_start)::integer as start_hour,
      wall_start at time zone v_zone as begins,
      (wall_start + interval '4 hours') at time zone v_zone as ends
    from generate_series(date_trunc('day', v_start at time zone v_zone),
      v_end at time zone v_zone, interval '4 hours') as b(wall_start)
  ), exposure as (
    select b.start_hour, sum(extract(epoch from
      least(s.ended_at, b.ends) - greatest(s.started_at, b.begins))) as seconds
    from bins b join completed s on s.started_at < b.ends and s.ended_at > b.begins
    group by b.start_hour
  ), alerts as (
    -- Count events separately so additional events never multiply session time.
    select (extract(hour from e.created_at at time zone v_zone)::integer / 4) * 4 as start_hour,
      count(*) filter (where e.type = 'drowsy') as drowsy,
      count(*) filter (where e.type = 'distracted') as distracted
    from completed s join public.events e on e.session_id = s.id
      and e.created_at between s.started_at and s.ended_at
    where e.type in ('drowsy', 'distracted')
    group by 1
  ), totals as (
    select h.start_hour, coalesce(x.seconds, 0) as seconds,
      coalesce(a.drowsy, 0) as drowsy, coalesce(a.distracted, 0) as distracted
    from generate_series(0, 20, 4) as h(start_hour)
    left join exposure x using (start_hour)
    left join alerts a using (start_hour)
  )
  select jsonb_agg(jsonb_build_object(
    'start_hour', start_hour, 'monitored_minutes', seconds / 60,
    'drowsy_alerts', drowsy, 'distracted_alerts', distracted,
    'rate_available', seconds >= 7200,
    'drowsy_alerts_per_hour', case when seconds >= 7200 then round(drowsy * 3600.0 / seconds, 4) end
  ) order by start_hour) into v_blocks from totals;

  return jsonb_build_object('version', 1, 'days', p_days, 'window_start', v_start,
    'window_end', v_end, 'timezone', v_zone, 'blocks', v_blocks);
end;
$$;

revoke all on function public.fleet_time_of_day_report(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.fleet_time_of_day_report(uuid, uuid, integer) to service_role;
