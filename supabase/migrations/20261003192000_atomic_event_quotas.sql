-- Enable OCCULERT_EVENT_LIMITS_ENABLED only after this migration is verified.
create table public.event_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  event_count integer not null check (event_count between 0 and 60)
);
alter table public.event_rate_limits enable row level security;
revoke all on public.event_rate_limits from public, anon, authenticated;

create or replace function public.record_limited_event(
  p_user_id uuid, p_session_id uuid, p_type text,
  p_fatigue_score numeric, p_confidence numeric,
  p_latitude double precision, p_longitude double precision,
  p_occurred_at timestamptz default null
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  session_row public.sessions%rowtype;
  bucket public.event_rate_limits%rowtype;
  checked_at timestamptz;
  occurred_at timestamptz;
  saved public.events%rowtype;
begin
  if p_user_id is null or p_session_id is null or p_type is null
    or p_type not in ('drowsy','distracted','head_nod','yawn','phone_use','ok_check_in','emergency') then
    return jsonb_build_object('error','invalid_event');
  end if;
  if p_fatigue_score not between 0 and 100 or p_confidence not between 0 and 100
    or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    return jsonb_build_object('error','invalid_event');
  end if;
  if not exists (select 1 from public.sessions s join public.drivers d on d.id=s.driver_id where s.id=p_session_id and d.user_id=p_user_id) then
    return jsonb_build_object('error','session_not_found');
  end if;
  -- Lock users before sessions consistently: different sessions share one burst budget.
  insert into public.event_rate_limits values (p_user_id,clock_timestamp(),0) on conflict (user_id) do nothing;
  select * into bucket from public.event_rate_limits where user_id=p_user_id for update;
  select s.* into session_row from public.sessions s
    where s.id=p_session_id and s.driver_id in (select id from public.drivers where user_id=p_user_id)
    for update of s;
  if not found then return jsonb_build_object('error','session_not_found'); end if;
  checked_at := clock_timestamp();
  if session_row.ended_at is not null and session_row.ended_at < checked_at - interval '2 minutes' then
    return jsonb_build_object('error','session_ended');
  end if;
  occurred_at := coalesce(p_occurred_at,least(coalesce(session_row.ended_at,checked_at),checked_at));
  if occurred_at < session_row.started_at or occurred_at > least(coalesce(session_row.ended_at,checked_at),checked_at) then
    return jsonb_build_object('error','invalid_occurred_at');
  end if;
  if bucket.window_started_at <= checked_at - interval '60 seconds' then
    bucket.window_started_at := checked_at; bucket.event_count := 0;
  end if;
  if bucket.event_count >= 60 then
    return jsonb_build_object('error','event_rate_limited','retry_after',greatest(1,ceil(extract(epoch from bucket.window_started_at + interval '60 seconds' - checked_at))::integer));
  end if;
  if (select count(*) from public.events where session_id=p_session_id) >= 500 then
    return jsonb_build_object('error','session_event_limit');
  end if;
  insert into public.events(session_id,type,fatigue_score,confidence,latitude,longitude,created_at)
    values(p_session_id,p_type,p_fatigue_score,p_confidence,p_latitude,p_longitude,occurred_at) returning * into saved;
  update public.event_rate_limits set window_started_at=bucket.window_started_at,event_count=bucket.event_count+1 where user_id=p_user_id;
  return jsonb_build_object('event',to_jsonb(saved));
end;
$$;
revoke all on function public.record_limited_event(uuid,uuid,text,numeric,numeric,double precision,double precision,timestamptz) from public, anon, authenticated;
grant execute on function public.record_limited_event(uuid,uuid,text,numeric,numeric,double precision,double precision,timestamptz) to service_role;
