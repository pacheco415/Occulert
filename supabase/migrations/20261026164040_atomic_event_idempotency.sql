-- Local reconciliation of PR #192's atomic quota design with idempotency.
-- Do not also apply its unmerged 20261003192000_atomic_event_quotas.sql.
-- Keep OCCULERT_EVENT_IDEMPOTENCY_ENABLED off until this migration is verified.
set local lock_timeout = '3s';

create table public.event_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  event_count integer not null check (event_count between 0 and 60)
);
alter table public.event_rate_limits enable row level security;
revoke all on public.event_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.event_rate_limits to service_role;

-- Store only a typed canonical fingerprint, not another copy of location or
-- telemetry. Deleting the original event/account also deletes the receipt.
create table public.event_idempotency (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_event_id uuid not null,
  event_id uuid not null unique references public.events(id) on delete cascade,
  payload_sha256 bytea not null check (octet_length(payload_sha256) = 32),
  primary key (user_id, client_event_id)
);
alter table public.event_idempotency enable row level security;
revoke all on public.event_idempotency from public, anon, authenticated;
grant select, insert, delete on public.event_idempotency to service_role;

create function public.record_idempotent_event(
  p_user_id uuid, p_session_id uuid, p_client_event_id uuid, p_type text,
  p_fatigue_score numeric, p_confidence numeric,
  p_latitude double precision, p_longitude double precision,
  p_occurred_at timestamptz default null
) returns jsonb language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  session_row public.sessions%rowtype;
  bucket public.event_rate_limits%rowtype;
  receipt public.event_idempotency%rowtype;
  saved public.events%rowtype;
  checked_at timestamptz;
  occurred_at timestamptz;
  fingerprint bytea;
begin
  -- Only the authenticated API may call this service-role-only RPC; identity
  -- comes from its verified bearer token, never a client owner/fleet claim.
  if p_user_id is null or p_session_id is null or p_type is null
    or p_type not in ('drowsy','distracted','head_nod','yawn','phone_use','ok_check_in','emergency')
    or p_fatigue_score not between 0 and 100 or p_confidence not between 0 and 100
    or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    return jsonb_build_object('error','invalid_event');
  end if;
  if p_occurred_at is not null and not isfinite(p_occurred_at) then
    return jsonb_build_object('error','invalid_occurred_at');
  end if;
  if not exists (select 1 from public.sessions s join public.drivers d on d.id=s.driver_id
      where s.id=p_session_id and d.user_id=p_user_id) then
    return jsonb_build_object('error','session_not_found');
  end if;

  -- Serialize all this owner's sessions before locking a session, as in #192.
  -- Concurrent first inserts wait on the PK, then SELECT sees the committed row.
  insert into public.event_rate_limits values (p_user_id,clock_timestamp(),0)
    on conflict (user_id) do nothing;
  select * into strict bucket from public.event_rate_limits
    where user_id=p_user_id for update;
  select s.* into session_row from public.sessions s
    where s.id=p_session_id and s.driver_id in
      (select id from public.drivers where user_id=p_user_id)
    for update of s;
  if not found then return jsonb_build_object('error','session_not_found'); end if;

  -- SQL types normalize UUID case, numeric scales, +/-0 and equivalent timezone
  -- representations. Float bits avoid extra_float_digits-dependent text.
  -- Epoch retains microseconds; null is the omitted-time intent.
  fingerprint := sha256(convert_to(jsonb_build_array(
    p_session_id, p_type, trim_scale(p_fatigue_score), trim_scale(p_confidence),
    encode(float8send(case when p_latitude = 0 then 0::double precision else p_latitude end), 'hex'),
    encode(float8send(case when p_longitude = 0 then 0::double precision else p_longitude end), 'hex'),
    case when p_occurred_at is null then null else trim_scale(extract(epoch from p_occurred_at)) end
  )::text, 'UTF8'));
  if p_client_event_id is not null then
    select * into receipt from public.event_idempotency
      where user_id=p_user_id and client_event_id=p_client_event_id;
    if found then
      if receipt.payload_sha256 <> fingerprint then
        return jsonb_build_object('error','event_id_conflict');
      end if;
      select * into strict saved from public.events where id=receipt.event_id;
      -- Already-durable acceptance is acknowledged even after session grace or
      -- quota exhaustion. No event/counter/timestamp is changed by this replay.
      return jsonb_build_object('event',to_jsonb(saved),'client_event_id',p_client_event_id,'replayed',true);
    end if;
  end if;

  checked_at := clock_timestamp();
  if not isfinite(session_row.started_at)
    or (session_row.ended_at is not null and not isfinite(session_row.ended_at))
    or session_row.started_at > least(coalesce(session_row.ended_at,checked_at),checked_at) then
    raise exception 'invalid_session_time';
  end if;
  if session_row.ended_at is not null and session_row.ended_at < checked_at - interval '2 minutes' then
    return jsonb_build_object('error','session_ended');
  end if;
  occurred_at := coalesce(p_occurred_at,least(coalesce(session_row.ended_at,checked_at),checked_at));
  if occurred_at < session_row.started_at
    or occurred_at > least(coalesce(session_row.ended_at,checked_at),checked_at) then
    return jsonb_build_object('error','invalid_occurred_at');
  end if;
  if bucket.window_started_at <= checked_at - interval '60 seconds' then
    bucket.window_started_at := checked_at; bucket.event_count := 0;
  end if;
  if bucket.event_count >= 60 then
    return jsonb_build_object('error','event_rate_limited','retry_after',
      greatest(1,ceil(extract(epoch from bucket.window_started_at + interval '60 seconds' - checked_at))::integer));
  end if;
  if (select count(*) from public.events where session_id=p_session_id) >= 500 then
    return jsonb_build_object('error','session_event_limit');
  end if;
  insert into public.events(session_id,type,fatigue_score,confidence,latitude,longitude,created_at)
    values(p_session_id,p_type,p_fatigue_score,p_confidence,p_latitude,p_longitude,occurred_at)
    returning * into saved;
  if p_client_event_id is not null then
    insert into public.event_idempotency values (p_user_id,p_client_event_id,saved.id,fingerprint);
  end if;
  update public.event_rate_limits set window_started_at=bucket.window_started_at,
    event_count=bucket.event_count+1 where user_id=p_user_id;
  return jsonb_build_object('event',to_jsonb(saved),'client_event_id',p_client_event_id,'replayed',false);
end;
$$;
revoke all on function public.record_idempotent_event(uuid,uuid,uuid,text,numeric,numeric,double precision,double precision,timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_idempotent_event(uuid,uuid,uuid,text,numeric,numeric,double precision,double precision,timestamptz)
  to service_role;
