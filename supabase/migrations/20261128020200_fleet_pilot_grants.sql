set local lock_timeout = '3s';

create table public.fleet_pilot_grants (
  fleet_id uuid primary key references public.fleets(id) on delete cascade,
  granted_by uuid not null,
  expires_at timestamptz not null,
  monthly_question_cap integer not null default 50 check (monthly_question_cap between 1 and 50),
  note text not null default '' check (length(note) <= 500)
);
alter table public.fleet_pilot_grants enable row level security;
revoke all on public.fleet_pilot_grants from public, anon, authenticated, service_role;
grant select on public.fleet_pilot_grants to service_role;

create function public.fleet_active_pilot(p_actor_id uuid, p_fleet_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('expires_at', g.expires_at, 'monthly_question_cap', g.monthly_question_cap)
  from public.fleet_pilot_grants g join public.fleets f on f.id = g.fleet_id
  where g.fleet_id = p_fleet_id and f.owner_user_id = p_actor_id and g.expires_at > now();
$$;
revoke all on function public.fleet_active_pilot(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fleet_active_pilot(uuid, uuid) to service_role;

create function public.admit_fleet_question(p_actor_id uuid, p_fleet_id uuid, p_pilot boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  checked_at timestamptz;
  current_month date;
  next_month timestamptz;
  used integer;
  question_cap integer := 50;
  hourly jsonb;
  identity_fields jsonb := jsonb_build_object('user_id', p_actor_id, 'fleet_id', p_fleet_id);
begin
  -- Match deletion's parent-first lock order, then serialize admissions for this fleet.
  perform 1 from auth.users where id = p_actor_id for key share;
  if not found then
    return identity_fields || jsonb_build_object('allowed', false, 'error', 'unauthorized');
  end if;
  perform 1 from public.fleets where id = p_fleet_id and owner_user_id = p_actor_id for no key update;
  if not found then
    return identity_fields || jsonb_build_object('allowed', false, 'error', 'fleet_not_found');
  end if;
  checked_at := clock_timestamp();
  if p_pilot then
    select monthly_question_cap into question_cap from public.fleet_pilot_grants
      where fleet_id = p_fleet_id and expires_at > checked_at for share;
    if not found then
      return identity_fields || jsonb_build_object('allowed', false, 'error', 'paid_plan_required');
    end if;
  end if;
  current_month := date_trunc('month', checked_at at time zone 'UTC')::date;
  select attempts into used from public.fleet_question_monthly_usage
    where fleet_id = p_fleet_id and month_start = current_month;
  if used >= question_cap then
    next_month := (current_month + interval '1 month') at time zone 'UTC';
    return identity_fields || jsonb_build_object('allowed', false, 'error', 'fleet_question_monthly_limit',
      'retry_after', greatest(1, ceil(extract(epoch from next_month - checked_at))::integer));
  end if;

  hourly := public.reserve_account_write(p_actor_id, 'fleet_ask');
  if hourly->'allowed' = 'false'::jsonb and hourly->>'error' = 'account_write_rate_limited' then
    return identity_fields || jsonb_build_object('allowed', false, 'error', 'account_write_rate_limited',
      'retry_after', hourly->'retry_after');
  end if;
  if hourly is distinct from jsonb_build_object('allowed', true, 'user_id', p_actor_id, 'operation', 'fleet_ask') then
    raise exception 'unexpected hourly reservation';
  end if;

  used := coalesce(used, 0) + 1;
  insert into public.fleet_question_monthly_usage (fleet_id, month_start, attempts)
    values (p_fleet_id, current_month, used)
    on conflict (fleet_id) do update set month_start = excluded.month_start, attempts = excluded.attempts;
  return identity_fields || jsonb_build_object('allowed', true, 'monthly_remaining', question_cap - used, 'month_start', current_month);
end;
$$;

revoke all on function public.admit_fleet_question(uuid, uuid, boolean) from public, anon, authenticated, service_role;

create or replace function public.reserve_fleet_question(p_actor_id uuid, p_fleet_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select public.admit_fleet_question(p_actor_id, p_fleet_id, false);
$$;
create function public.reserve_fleet_pilot_question(p_actor_id uuid, p_fleet_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select public.admit_fleet_question(p_actor_id, p_fleet_id, true);
$$;
revoke all on function public.reserve_fleet_question(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reserve_fleet_pilot_question(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_fleet_question(uuid, uuid) to service_role;
grant execute on function public.reserve_fleet_pilot_question(uuid, uuid) to service_role;
