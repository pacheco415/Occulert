-- Complete owner-scoped 7/30-day aggregates for pilot reporting. The service
-- role is the only caller; no row-level session or driver data is returned.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create or replace function public.fleet_period_report(
  p_actor_id uuid, p_fleet_id uuid, p_days integer
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_as_of timestamptz := now();
  v_start timestamptz;
  v_report jsonb;
begin
  if p_days is null or p_days not in (7, 30) then
    raise exception 'Invalid reporting period' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.fleets f
    where f.id = p_fleet_id and f.owner_user_id = p_actor_id
  ) then
    return null;
  end if;
  v_start := v_as_of - make_interval(days => p_days);

  with roster as (
    select count(*)::integer as total,
      count(*) filter (where active)::integer as active
    from public.drivers where fleet_id = p_fleet_id
  ), period_sessions as (
    select s.id, s.driver_id, s.started_at, s.ended_at, s.safety_score, s.detector_pipeline,
      s.alert_count, d.active as driver_active, f.status as followup_status,
      f.version as followup_version
    from public.sessions s
    left join public.drivers d on d.id = s.driver_id and d.fleet_id = p_fleet_id
    left join public.fleet_session_followups f on f.session_id = s.id
    where s.fleet_id = p_fleet_id
      and s.started_at >= v_start and s.started_at <= v_as_of
  ), metrics as (
    select count(*)::integer as sessions,
      count(distinct driver_id) filter (where driver_active)::integer as reporting_active_drivers,
      count(*) filter (where ended_at is not null and ended_at >= started_at and ended_at <= v_as_of)::integer as completed,
      count(*) filter (where ended_at is null)::integer as no_recorded_end,
      count(*) filter (where ended_at is not null and (ended_at < started_at or ended_at > v_as_of))::integer as invalid_recorded_end,
      count(*) filter (where safety_score between 0 and 100)::integer as scored,
      round(avg(safety_score) filter (where safety_score between 0 and 100))::integer as average_safety_score,
      count(*) filter (where alert_count is not null and alert_count >= 0)::integer as valid_alert_records,
      coalesce(sum(alert_count) filter (where alert_count is not null and alert_count >= 0), 0)::bigint as alerts,
      count(*) filter (where followup_status = 'reviewed' and followup_version > 0)::integer as reviewed,
      count(*) filter (where detector_pipeline = 'web_mediapipe_ear')::integer as web_sessions,
      count(*) filter (where detector_pipeline = 'ios_mlkit_eye_probability')::integer as ios_sessions,
      count(*) filter (where detector_pipeline = 'android_mlkit_eye_probability')::integer as android_sessions,
      count(*) filter (where detector_pipeline is null or detector_pipeline not in
          ('web_mediapipe_ear', 'ios_mlkit_eye_probability', 'android_mlkit_eye_probability'))::integer as unknown_sessions
    from period_sessions
  )
  select jsonb_build_object(
    'version', 1, 'days', p_days, 'window_start', v_start, 'window_end', v_as_of,
    'complete_period', true, 'roster_total', r.total, 'active_drivers', r.active,
    'reporting_active_drivers', m.reporting_active_drivers,
    'sessions', m.sessions, 'completed', m.completed,
    'no_recorded_end', m.no_recorded_end, 'invalid_recorded_end', m.invalid_recorded_end,
    'scored', m.scored, 'unscored', m.sessions - m.scored,
    'average_safety_score', m.average_safety_score,
    'valid_alert_records', m.valid_alert_records,
    'missing_alert_records', m.sessions - m.valid_alert_records,
    'alerts', m.alerts, 'reviewed', m.reviewed,
    'without_reviewed_followup', m.sessions - m.reviewed,
    'detector_pipelines', jsonb_build_object(
      'web_mediapipe_ear', m.web_sessions,
      'ios_mlkit_eye_probability', m.ios_sessions,
      'android_mlkit_eye_probability', m.android_sessions,
      'unknown', m.unknown_sessions
    ),
    'interruption_reasons_available', false,
    'unrecorded_sessions_detectable', false
  ) into v_report from roster r cross join metrics m;
  return v_report;
end;
$$;

revoke all on function public.fleet_period_report(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.fleet_period_report(uuid, uuid, integer) to service_role;
