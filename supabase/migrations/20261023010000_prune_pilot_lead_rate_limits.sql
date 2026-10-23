-- The pilot-form rate limiter kept one row per client hash forever. Each call
-- now first removes up to 100 rows that have been idle for longer than a day
-- (or the requested window, if that is longer), so the table stays bounded by
-- recent traffic. Signature, return shape, security definer, search_path and
-- grants are unchanged.
set local lock_timeout = '3s';

create index if not exists pilot_lead_rate_limits_updated_at_idx
  on public.pilot_lead_rate_limits(updated_at);

create or replace function public.check_pilot_lead_rate_limit(
  p_rate_key text,
  p_limit integer default 5,
  p_window_seconds integer default 900
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_count integer;
  current_window timestamptz;
  checked_at timestamptz := clock_timestamp();
begin
  if p_rate_key is null or length(p_rate_key) <> 64 or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid_rate_limit_input';
  end if;

  -- Rows idle past every window can no longer limit anyone. Skip rows another
  -- call holds so concurrent submissions never wait on cleanup.
  delete from public.pilot_lead_rate_limits
  where rate_key in (
    select stale.rate_key from public.pilot_lead_rate_limits as stale
    where stale.updated_at < checked_at - greatest(interval '1 day', make_interval(secs => p_window_seconds))
    order by stale.updated_at
    limit 100
    for update skip locked
  );

  insert into public.pilot_lead_rate_limits as bucket (
    rate_key, window_started_at, request_count, updated_at
  ) values (
    p_rate_key, checked_at, 1, checked_at
  )
  on conflict (rate_key) do update set
    window_started_at = case
      when bucket.window_started_at <= checked_at - make_interval(secs => p_window_seconds) then checked_at
      else bucket.window_started_at
    end,
    request_count = case
      when bucket.window_started_at <= checked_at - make_interval(secs => p_window_seconds) then 1
      else bucket.request_count + 1
    end,
    updated_at = checked_at
  returning request_count, window_started_at into current_count, current_window;

  allowed := current_count <= p_limit;
  retry_after_seconds := greatest(
    1,
    ceil(extract(epoch from current_window + make_interval(secs => p_window_seconds) - checked_at))::integer
  );
  return next;
end;
$$;

revoke all on function public.check_pilot_lead_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_pilot_lead_rate_limit(text, integer, integer) to service_role;
