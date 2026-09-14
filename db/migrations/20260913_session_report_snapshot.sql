-- Return each bounded fleet report from one PostgreSQL statement. Every row
-- is therefore selected from one MVCC snapshot, including when an offline
-- session commits while the report is being read.

create index if not exists sessions_fleet_started_cursor_idx
  on public.sessions(fleet_id, started_at desc, id desc);

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

revoke all on function public.fleet_session_report_v1(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fleet_session_report_v1(uuid, timestamptz, timestamptz)
  to service_role;
