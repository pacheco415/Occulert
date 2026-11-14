-- Apply and verify before deploying the profile/fleet write-quota API path.
-- Reservations are admitted attempts, not successful writes: the API's later
-- mutation is a separate transaction and never refunds or retries a reservation.
set local lock_timeout = '3s';

create table public.account_write_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null check (operation in ('profile', 'fleet')),
  window_started_at timestamptz not null,
  write_count integer not null check (
    write_count between 0 and case operation when 'profile' then 60 else 10 end
  ),
  primary key (user_id, operation)
);
alter table public.account_write_rate_limits enable row level security;
revoke all on public.account_write_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.account_write_rate_limits to service_role;

-- Only the API can supply a verified account and one of these fixed operations.
-- Definer privileges permit a narrow parent lock without granting service_role
-- direct access to auth.users. No profile or fleet has to exist yet.
create function public.reserve_account_write(p_user_id uuid, p_operation text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  bucket public.account_write_rate_limits%rowtype;
  checked_at timestamptz;
  write_limit integer;
begin
  if p_user_id is null or p_operation is null or p_operation not in ('profile', 'fleet') then
    return jsonb_build_object('allowed', false, 'error', 'invalid_account_write');
  end if;
  write_limit := case p_operation when 'profile' then 60 else 10 end;

  -- Account deletion locks its parent before cascading to quota children.
  -- Follow that order, including on the first request before a driver exists.
  perform 1 from auth.users where id = p_user_id for key share;
  if not found then
    return jsonb_build_object('allowed', false, 'user_id', p_user_id,
      'operation', p_operation, 'error', 'account_not_found');
  end if;

  -- Unique insertion serializes first-row races; the row lock serializes every
  -- later check/increment. Read the clock after contention, not at request start.
  insert into public.account_write_rate_limits(user_id, operation, window_started_at, write_count)
    values(p_user_id, p_operation, clock_timestamp(), 0)
    on conflict (user_id, operation) do nothing;
  select * into strict bucket from public.account_write_rate_limits
    where user_id = p_user_id and operation = p_operation for update;
  checked_at := clock_timestamp();
  if bucket.write_count = 0
    or bucket.window_started_at <= checked_at - interval '1 hour' then
    bucket.window_started_at := checked_at;
    bucket.write_count := 0;
  end if;
  if bucket.write_count >= write_limit then
    return jsonb_build_object('allowed', false, 'user_id', p_user_id,
      'operation', p_operation, 'error', 'account_write_rate_limited', 'retry_after',
      greatest(1, least(3600, ceil(extract(epoch from
        bucket.window_started_at + interval '1 hour' - checked_at))::integer)));
  end if;

  update public.account_write_rate_limits
    set window_started_at = bucket.window_started_at, write_count = bucket.write_count + 1
    where user_id = p_user_id and operation = p_operation;
  return jsonb_build_object('allowed', true, 'user_id', p_user_id, 'operation', p_operation);
end;
$$;

revoke all on function public.reserve_account_write(uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_account_write(uuid, text) to service_role;
