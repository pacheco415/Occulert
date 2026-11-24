set local lock_timeout = '3s';

alter table public.fleet_insight_summaries
  add column attempt_count integer not null default 1 check (attempt_count between 1 and 3),
  add column next_allowed_at timestamptz;
update public.fleet_insight_summaries set next_allowed_at = created_at + interval '2 minutes';
alter table public.fleet_insight_summaries
  alter column next_allowed_at set default (now() + interval '2 minutes'),
  alter column next_allowed_at set not null;

-- The unique index serializes insert and retry claims. A competing claimant
-- rechecks the predicate after the winner advances the retry time.
create function public.claim_fleet_insight_attempt(p_actor_id uuid, p_fleet_id uuid, p_days integer, p_model text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  today date := (now() at time zone 'UTC')::date;
  cached public.fleet_insight_summaries%rowtype;
begin
  perform 1 from public.fleets where id = p_fleet_id and owner_user_id = p_actor_id for share;
  if not found then return null; end if;
  insert into public.fleet_insight_summaries as s (fleet_id, days, report_day, model)
    values (p_fleet_id, p_days, today, p_model)
    on conflict (fleet_id, days, report_day) do update set
      attempt_count = s.attempt_count + 1, next_allowed_at = excluded.next_allowed_at,
      created_at = excluded.created_at, finished_at = null, model = excluded.model
    where s.summary is null and s.attempt_count < 3 and s.next_allowed_at <= now()
    returning * into cached;
  if found then
    return jsonb_build_object('claimed', true, 'report_day', today, 'attempt_count', cached.attempt_count,
      'next_allowed_at', cached.next_allowed_at, 'report', public.fleet_period_report(p_actor_id, p_fleet_id, p_days));
  end if;
  select * into strict cached from public.fleet_insight_summaries
    where fleet_id = p_fleet_id and days = p_days and report_day = today;
  return jsonb_build_object('claimed', false, 'entry', to_jsonb(cached));
end;
$$;

-- A completion from an abandoned worker must never overwrite a later claim.
create function public.finish_fleet_insight_attempt(p_actor_id uuid, p_fleet_id uuid, p_days integer,
  p_report_day date, p_attempt_count integer, p_summary text, p_window_start timestamptz, p_window_end timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  stored public.fleet_insight_summaries%rowtype;
begin
  perform 1 from public.fleets where id = p_fleet_id and owner_user_id = p_actor_id for share;
  if not found then return null; end if;
  update public.fleet_insight_summaries
    set summary = p_summary, window_start = p_window_start, window_end = p_window_end, finished_at = now()
    where fleet_id = p_fleet_id and days = p_days and report_day = p_report_day and attempt_count = p_attempt_count and finished_at is null
    returning * into stored;
  if not found then return null; end if;
  return to_jsonb(stored);
end;
$$;

-- A worker on the previous deployment can finish its original claim only.
create or replace function public.finish_fleet_insight_summary(p_actor_id uuid, p_fleet_id uuid, p_days integer,
  p_report_day date, p_summary text, p_window_start timestamptz, p_window_end timestamptz)
returns jsonb language sql security invoker set search_path = '' as $$
  select public.finish_fleet_insight_attempt(p_actor_id, p_fleet_id, p_days, p_report_day, 1,
    p_summary, p_window_start, p_window_end);
$$;
revoke all on function public.claim_fleet_insight_attempt(uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.claim_fleet_insight_attempt(uuid, uuid, integer, text) to service_role;
revoke all on function public.finish_fleet_insight_attempt(uuid,uuid,integer,date,integer,text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.finish_fleet_insight_attempt(uuid,uuid,integer,date,integer,text,timestamptz,timestamptz) to service_role;
