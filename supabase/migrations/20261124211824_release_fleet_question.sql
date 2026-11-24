set local lock_timeout = '3s';

-- The reservation returns its database month so a late failure cannot credit a new month.
create or replace function public.reserve_fleet_question(p_actor_id uuid, p_fleet_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  checked_at timestamptz;
  current_month date;
  next_month timestamptz;
  used integer;
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
  current_month := date_trunc('month', checked_at at time zone 'UTC')::date;
  select attempts into used from public.fleet_question_monthly_usage
    where fleet_id = p_fleet_id and month_start = current_month;
  if used >= 50 then
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
  return identity_fields || jsonb_build_object('allowed', true, 'monthly_remaining', 50 - used, 'month_start', current_month);
end;
$$;

create function public.release_fleet_question(p_actor_id uuid, p_fleet_id uuid,
  p_month_start date default date_trunc('month', now() at time zone 'UTC')::date)
returns integer language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  used integer;
begin
  perform 1 from public.fleets where id = p_fleet_id and owner_user_id = p_actor_id for no key update;
  if not found then return null; end if;
  select attempts into used from public.fleet_question_monthly_usage
    where fleet_id = p_fleet_id and month_start = p_month_start for update;
  if not found then return null; end if;
  if used = 1 then
    delete from public.fleet_question_monthly_usage where fleet_id = p_fleet_id;
  else
    update public.fleet_question_monthly_usage set attempts = used - 1 where fleet_id = p_fleet_id;
  end if;
  return 51 - used;
end;
$$;
revoke all on function public.release_fleet_question(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.release_fleet_question(uuid, uuid, date) to service_role;
