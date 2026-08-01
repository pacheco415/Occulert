-- Durable, atomic rate limiting for the unauthenticated pilot-interest form.
-- Apply this migration before deploying the matching API change.

create table if not exists public.pilot_lead_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now()
);

alter table public.pilot_lead_rate_limits enable row level security;
revoke all on public.pilot_lead_rate_limits from public, anon, authenticated;

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
