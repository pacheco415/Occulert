-- Isolated Stripe test-mode billing state. This table does not change fleets.plan
-- or grant access to any feature. Apply only after the base fleets schema.

create table if not exists public.fleet_billing_test (
  fleet_id uuid primary key references public.fleets(id) on delete cascade,
  stripe_customer_id text not null unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_subscription_id text unique check (stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  stripe_price_id text check (stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  plan text check (plan is null or plan in ('starter', 'growth')),
  status text not null default 'none' check (status in (
    'none', 'incomplete', 'incomplete_expired', 'trialing', 'active',
    'past_due', 'unpaid', 'canceled', 'paused'
  )),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  checkout_request_key text check (checkout_request_key is null or checkout_request_key ~ '^occulert-test-checkout-[a-f0-9]{64}$'),
  checkout_plan text check (checkout_plan is null or checkout_plan in ('starter', 'growth')),
  checkout_reservation_token uuid,
  checkout_started_at timestamptz,
  checkout_session_id text check (checkout_session_id is null or checkout_session_id ~ '^cs_test_[A-Za-z0-9]+$'),
  checkout_session_url text,
  checkout_expires_at timestamptz,
  constraint checkout_reservation_consistent check (
    (checkout_reservation_token is null and checkout_request_key is null and checkout_plan is null
      and checkout_started_at is null and checkout_session_id is null and checkout_session_url is null
      and checkout_expires_at is null)
    or (checkout_reservation_token is not null and checkout_request_key is not null
      and checkout_plan is not null and checkout_started_at is not null)
  ),
  constraint checkout_session_consistent check (
    (checkout_session_id is null and checkout_session_url is null and checkout_expires_at is null)
    or (checkout_session_id is not null and checkout_session_url is not null and checkout_expires_at is not null)
  ),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_test_webhook_events (
  event_id text primary key check (event_id ~ '^evt_[A-Za-z0-9]+$'),
  event_type text not null,
  fleet_id uuid not null references public.fleets(id) on delete cascade,
  stripe_subscription_id text not null,
  processed_at timestamptz not null default now()
);

-- A short lease encloses the Stripe GET and the atomic database update. A
-- second delivery retries later instead of writing an older Stripe snapshot.
create table if not exists public.billing_test_subscription_sync_locks (
  stripe_subscription_id text primary key check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  lock_token uuid not null,
  lease_expires_at timestamptz not null
);

create index if not exists billing_test_webhook_events_processed_at_idx
  on public.billing_test_webhook_events(processed_at);

alter table public.fleet_billing_test enable row level security;
alter table public.billing_test_webhook_events enable row level security;
alter table public.billing_test_subscription_sync_locks enable row level security;
revoke all on public.fleet_billing_test from anon, authenticated;
revoke all on public.billing_test_webhook_events from anon, authenticated;
revoke all on public.billing_test_subscription_sync_locks from anon, authenticated;
grant select, insert, update on public.fleet_billing_test to service_role;
grant select, insert on public.billing_test_webhook_events to service_role;
grant select, insert, update, delete on public.billing_test_subscription_sync_locks to service_role;

-- A customer must be registered against an owned fleet before Checkout runs.
-- Concurrent attempts serialize on the fleet row and return the same customer.
create or replace function public.register_test_billing_customer(
  p_fleet_id uuid,
  p_owner_user_id uuid,
  p_customer_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer_id text;
begin
  if p_customer_id !~ '^cus_[A-Za-z0-9]+$' then
    raise exception 'invalid_test_customer_id';
  end if;
  perform 1 from public.fleets
    where id = p_fleet_id and owner_user_id = p_owner_user_id for update;
  if not found then
    raise exception 'fleet_owner_mismatch';
  end if;

  select stripe_customer_id into v_customer_id
    from public.fleet_billing_test where fleet_id = p_fleet_id for update;
  if v_customer_id is null then
    insert into public.fleet_billing_test(fleet_id, stripe_customer_id)
      values (p_fleet_id, p_customer_id);
    v_customer_id := p_customer_id;
  end if;
  return jsonb_build_object('stripe_customer_id', v_customer_id);
end;
$$;

-- One fleet has one pending Checkout reservation. Retries with the same key
-- resume that reservation; a different key cannot create a second session.
create or replace function public.reserve_test_checkout(
  p_fleet_id uuid,
  p_owner_user_id uuid,
  p_plan text,
  p_request_key text,
  p_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_billing public.fleet_billing_test%rowtype;
begin
  if p_plan not in ('starter', 'growth')
     or p_request_key !~ '^occulert-test-checkout-[a-f0-9]{64}$'
     or p_token is null then
    raise exception 'invalid_test_checkout_reservation';
  end if;
  perform 1 from public.fleets
    where id = p_fleet_id and owner_user_id = p_owner_user_id for update;
  if not found then raise exception 'fleet_owner_mismatch'; end if;
  select * into v_billing from public.fleet_billing_test
    where fleet_id = p_fleet_id for update;
  if not found then raise exception 'test_customer_missing'; end if;

  if v_billing.stripe_subscription_id is not null
     and v_billing.status not in ('none', 'canceled', 'incomplete_expired') then
    return jsonb_build_object('state', 'subscription_exists');
  end if;
  if v_billing.checkout_session_id is not null then
    return jsonb_build_object(
      'state', 'existing', 'plan', v_billing.checkout_plan,
      'session_id', v_billing.checkout_session_id,
      'session_url', v_billing.checkout_session_url,
      'expires_at', extract(epoch from v_billing.checkout_expires_at)::bigint
    );
  end if;
  if v_billing.checkout_reservation_token is not null then
    if v_billing.checkout_started_at < now() - interval '23 hours' then
      return jsonb_build_object('state', 'recovery_required');
    end if;
    if v_billing.checkout_request_key = p_request_key and v_billing.checkout_plan = p_plan then
      return jsonb_build_object('state', 'retry', 'token', v_billing.checkout_reservation_token);
    end if;
    return jsonb_build_object('state', 'pending');
  end if;

  update public.fleet_billing_test set
    checkout_request_key = p_request_key,
    checkout_plan = p_plan,
    checkout_reservation_token = p_token,
    checkout_started_at = now(),
    updated_at = now()
  where fleet_id = p_fleet_id;
  return jsonb_build_object('state', 'create', 'token', p_token);
end;
$$;

create or replace function public.complete_test_checkout(
  p_fleet_id uuid,
  p_owner_user_id uuid,
  p_token uuid,
  p_session_id text,
  p_session_url text,
  p_expires_at bigint
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_billing public.fleet_billing_test%rowtype;
begin
  if p_token is null or p_session_id !~ '^cs_test_[A-Za-z0-9]+$'
     or p_session_url !~ '^https://checkout[.]stripe[.]com/'
     or length(p_session_url) > 4096
     or p_expires_at is null or p_expires_at < extract(epoch from now()) - 60
     or p_expires_at > extract(epoch from now()) + 90000 then
    raise exception 'invalid_test_checkout_session';
  end if;
  perform 1 from public.fleets
    where id = p_fleet_id and owner_user_id = p_owner_user_id for update;
  if not found then raise exception 'fleet_owner_mismatch'; end if;
  select * into v_billing from public.fleet_billing_test
    where fleet_id = p_fleet_id for update;
  if not found or v_billing.checkout_reservation_token is distinct from p_token then
    raise exception 'test_checkout_reservation_mismatch';
  end if;
  if v_billing.stripe_subscription_id is not null
     and v_billing.status not in ('none', 'canceled', 'incomplete_expired') then
    return jsonb_build_object('saved', false, 'subscription_exists', true);
  end if;
  if v_billing.checkout_session_id is not null and v_billing.checkout_session_id <> p_session_id then
    raise exception 'test_checkout_session_conflict';
  end if;
  update public.fleet_billing_test set
    checkout_session_id = p_session_id,
    checkout_session_url = p_session_url,
    checkout_expires_at = to_timestamp(p_expires_at),
    updated_at = now()
  where fleet_id = p_fleet_id;
  return jsonb_build_object('saved', true);
end;
$$;

-- The caller first confirms the exact Session is expired at Stripe. Its ID
-- must still match the saved Session to avoid clearing a newer reservation.
create or replace function public.clear_expired_test_checkout(
  p_fleet_id uuid,
  p_owner_user_id uuid,
  p_session_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  perform 1 from public.fleets
    where id = p_fleet_id and owner_user_id = p_owner_user_id for update;
  if not found then raise exception 'fleet_owner_mismatch'; end if;
  update public.fleet_billing_test set
    checkout_request_key = null,
    checkout_plan = null,
    checkout_reservation_token = null,
    checkout_started_at = null,
    checkout_session_id = null,
    checkout_session_url = null,
    checkout_expires_at = null,
    updated_at = now()
  where fleet_id = p_fleet_id and checkout_session_id = p_session_id;
  get diagnostics v_count = row_count;
  return jsonb_build_object('cleared', v_count = 1);
end;
$$;

create or replace function public.claim_test_billing_sync(
  p_subscription_id text,
  p_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claimed text;
begin
  if p_subscription_id !~ '^sub_[A-Za-z0-9]+$' or p_token is null then
    raise exception 'invalid_test_sync_claim';
  end if;
  insert into public.billing_test_subscription_sync_locks
    (stripe_subscription_id, lock_token, lease_expires_at)
    values (p_subscription_id, p_token, now() + interval '30 seconds')
    on conflict (stripe_subscription_id) do update set
      lock_token = excluded.lock_token,
      lease_expires_at = excluded.lease_expires_at
    where public.billing_test_subscription_sync_locks.lease_expires_at <= now()
    returning stripe_subscription_id into v_claimed;
  return jsonb_build_object('claimed', v_claimed is not null);
end;
$$;

create or replace function public.release_test_billing_sync(
  p_subscription_id text,
  p_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  delete from public.billing_test_subscription_sync_locks
    where stripe_subscription_id = p_subscription_id and lock_token = p_token;
  get diagnostics v_count = row_count;
  return jsonb_build_object('released', v_count = 1);
end;
$$;

-- The verified webhook worker alone calls this function. Event insertion and
-- billing-state update are one transaction, so retries are harmless.
create or replace function public.apply_test_billing_event(
  p_event_id text,
  p_event_type text,
  p_fleet_id uuid,
  p_owner_user_id uuid,
  p_customer_id text,
  p_subscription_id text,
  p_price_id text,
  p_plan text,
  p_status text,
  p_period_end bigint,
  p_cancel_at_period_end boolean,
  p_sync_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_billing public.fleet_billing_test%rowtype;
  v_inserted integer;
  v_lock_token uuid;
  v_lease_expires_at timestamptz;
  v_preserve_checkout boolean;
begin
  if p_event_id !~ '^evt_[A-Za-z0-9]+$'
     or p_event_type not in (
       'customer.subscription.created', 'customer.subscription.updated',
       'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'
     )
     or p_customer_id !~ '^cus_[A-Za-z0-9]+$'
     or p_subscription_id !~ '^sub_[A-Za-z0-9]+$'
     or p_price_id !~ '^price_[A-Za-z0-9]+$'
     or p_plan not in ('starter', 'growth')
     or p_status not in (
       'incomplete', 'incomplete_expired', 'trialing', 'active',
       'past_due', 'unpaid', 'canceled', 'paused'
     )
     or p_period_end is not null and (p_period_end < 0 or p_period_end > 4102444800)
     or p_status in ('trialing', 'active') and p_period_end is null then
    raise exception 'invalid_test_billing_event';
  end if;

  select lock_token, lease_expires_at into v_lock_token, v_lease_expires_at
    from public.billing_test_subscription_sync_locks
    where stripe_subscription_id = p_subscription_id for update;
  if not found or v_lock_token is distinct from p_sync_token or v_lease_expires_at <= now() then
    raise exception 'test_billing_sync_not_claimed';
  end if;

  perform 1 from public.fleets
    where id = p_fleet_id and owner_user_id = p_owner_user_id for update;
  if not found then
    raise exception 'fleet_owner_mismatch';
  end if;

  select * into v_billing from public.fleet_billing_test
    where fleet_id = p_fleet_id for update;
  if not found or v_billing.stripe_customer_id <> p_customer_id then
    raise exception 'test_customer_mismatch';
  end if;
  insert into public.billing_test_webhook_events
    (event_id, event_type, fleet_id, stripe_subscription_id)
    values (p_event_id, p_event_type, p_fleet_id, p_subscription_id)
    on conflict (event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('applied', false, 'duplicate', true);
  end if;
  if v_billing.stripe_subscription_id is not null
     and v_billing.stripe_subscription_id <> p_subscription_id
     and v_billing.status not in ('none', 'canceled', 'incomplete_expired') then
    raise exception 'multiple_test_subscriptions_conflict';
  end if;

  -- A delayed event for a canceled old subscription must not erase a new
  -- pending Checkout session. Only an event for a new subscription consumes it.
  v_preserve_checkout := v_billing.checkout_reservation_token is not null
    and v_billing.stripe_subscription_id = p_subscription_id
    and v_billing.status in ('canceled', 'incomplete_expired');

  update public.fleet_billing_test set
    stripe_subscription_id = p_subscription_id,
    stripe_price_id = p_price_id,
    plan = p_plan,
    status = p_status,
    current_period_end = case when p_period_end is null then null else to_timestamp(p_period_end) end,
    cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
    checkout_request_key = case when v_preserve_checkout then checkout_request_key else null end,
    checkout_plan = case when v_preserve_checkout then checkout_plan else null end,
    checkout_reservation_token = case when v_preserve_checkout then checkout_reservation_token else null end,
    checkout_started_at = case when v_preserve_checkout then checkout_started_at else null end,
    checkout_session_id = case when v_preserve_checkout then checkout_session_id else null end,
    checkout_session_url = case when v_preserve_checkout then checkout_session_url else null end,
    checkout_expires_at = case when v_preserve_checkout then checkout_expires_at else null end,
    updated_at = now()
  where fleet_id = p_fleet_id;
  return jsonb_build_object('applied', true, 'duplicate', false);
end;
$$;

revoke all on function public.register_test_billing_customer(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.reserve_test_checkout(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.complete_test_checkout(uuid, uuid, uuid, text, text, bigint) from public, anon, authenticated;
revoke all on function public.clear_expired_test_checkout(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.claim_test_billing_sync(text, uuid) from public, anon, authenticated;
revoke all on function public.release_test_billing_sync(text, uuid) from public, anon, authenticated;
revoke all on function public.apply_test_billing_event(text, text, uuid, uuid, text, text, text, text, text, bigint, boolean, uuid) from public, anon, authenticated;
grant execute on function public.register_test_billing_customer(uuid, uuid, text) to service_role;
grant execute on function public.reserve_test_checkout(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.complete_test_checkout(uuid, uuid, uuid, text, text, bigint) to service_role;
grant execute on function public.clear_expired_test_checkout(uuid, uuid, text) to service_role;
grant execute on function public.claim_test_billing_sync(text, uuid) to service_role;
grant execute on function public.release_test_billing_sync(text, uuid) to service_role;
grant execute on function public.apply_test_billing_event(text, text, uuid, uuid, text, text, text, text, text, bigint, boolean, uuid) to service_role;
