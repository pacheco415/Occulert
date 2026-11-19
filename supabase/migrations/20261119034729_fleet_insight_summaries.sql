-- A reserved row consumes the day's provider attempt even if the worker exits.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table public.fleet_insight_summaries (
  fleet_id uuid not null references public.fleets(id) on delete cascade,
  days integer not null check (days in (7, 30)),
  report_day date not null,
  model text not null check (btrim(model) <> ''),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  summary text check (char_length(btrim(summary)) > 0 and char_length(summary) <= 1200),
  window_start timestamptz,
  window_end timestamptz,
  primary key (fleet_id, days, report_day),
  check ((summary is null and window_start is null and window_end is null)
      or (summary is not null and finished_at is not null and window_start is not null
          and window_end is not null and window_start < window_end
          and (window_end at time zone 'UTC')::date = report_day))
);
alter table public.fleet_insight_summaries enable row level security;
revoke all on public.fleet_insight_summaries from public, anon, authenticated;
grant select, insert, update on public.fleet_insight_summaries to service_role;

create function public.claim_fleet_insight_summary(p_actor_id uuid, p_fleet_id uuid, p_days integer, p_model text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  today date := (now() at time zone 'UTC')::date;
  cached public.fleet_insight_summaries%rowtype;
begin
  perform 1 from public.fleets where id = p_fleet_id and owner_user_id = p_actor_id for share;
  if not found then return null; end if;

  insert into public.fleet_insight_summaries(fleet_id, days, report_day, model)
    values (p_fleet_id, p_days, today, p_model)
    on conflict (fleet_id, days, report_day) do nothing;
  if found then
    -- The report uses the same transaction timestamp as the UTC cache key.
    return jsonb_build_object('claimed', true, 'report_day', today,
      'report', public.fleet_period_report(p_actor_id, p_fleet_id, p_days));
  end if;
  select * into strict cached from public.fleet_insight_summaries
    where fleet_id = p_fleet_id and days = p_days and report_day = today;
  return jsonb_build_object('claimed', false, 'entry', to_jsonb(cached));
end;
$$;

create function public.finish_fleet_insight_summary(p_actor_id uuid, p_fleet_id uuid, p_days integer,
  p_report_day date, p_summary text, p_window_start timestamptz, p_window_end timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  stored public.fleet_insight_summaries%rowtype;
begin
  perform 1 from public.fleets where id = p_fleet_id and owner_user_id = p_actor_id for share;
  if not found then return null; end if;
  update public.fleet_insight_summaries
    set summary = p_summary, window_start = p_window_start, window_end = p_window_end, finished_at = now()
    where fleet_id = p_fleet_id and days = p_days and report_day = p_report_day and finished_at is null
    returning * into stored;
  if not found then return null; end if;
  return to_jsonb(stored);
end;
$$;
revoke all on function public.claim_fleet_insight_summary(uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.claim_fleet_insight_summary(uuid, uuid, integer, text) to service_role;
revoke all on function public.finish_fleet_insight_summary(uuid, uuid, integer, date, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.finish_fleet_insight_summary(uuid, uuid, integer, date, text, timestamptz, timestamptz) to service_role;
