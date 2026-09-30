-- Record permanent Stripe test webhook mismatches even after a fleet is deleted.
-- This table has no fleet FK because deletion is one of the outcomes it records.
create table public.billing_test_ignored_webhook_events (
  event_id text primary key check (event_id ~ '^evt_[A-Za-z0-9]+$'),
  event_type text not null,
  fleet_id uuid not null,
  stripe_subscription_id text not null check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  reason text not null check (reason in ('fleet_owner_mismatch', 'test_customer_mismatch')),
  ignored_at timestamptz not null default now()
);

create index billing_test_ignored_webhook_events_ignored_at_idx
  on public.billing_test_ignored_webhook_events(ignored_at);

alter table public.billing_test_ignored_webhook_events enable row level security;
revoke all on public.billing_test_ignored_webhook_events from anon, authenticated;
grant select, insert on public.billing_test_ignored_webhook_events to service_role;

-- Event classification and durable recording run in the same transaction.
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
  v_ignored_reason text;
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

  select reason into v_ignored_reason
    from public.billing_test_ignored_webhook_events where event_id = p_event_id;
  if found then
    return jsonb_build_object('ignored', true, 'reason', v_ignored_reason);
  end if;
  perform 1 from public.billing_test_webhook_events where event_id = p_event_id;
  if found then
    return jsonb_build_object('applied', false, 'duplicate', true);
  end if;

  perform 1 from public.fleets
    where id = p_fleet_id and owner_user_id = p_owner_user_id for update;
  if not found then
    v_ignored_reason := 'fleet_owner_mismatch';
  else
    select * into v_billing from public.fleet_billing_test
      where fleet_id = p_fleet_id for update;
    if not found or v_billing.stripe_customer_id <> p_customer_id then
      v_ignored_reason := 'test_customer_mismatch';
    end if;
  end if;
  if v_ignored_reason is not null then
    insert into public.billing_test_ignored_webhook_events
      (event_id, event_type, fleet_id, stripe_subscription_id, reason)
      values (p_event_id, p_event_type, p_fleet_id, p_subscription_id, v_ignored_reason)
      on conflict (event_id) do nothing;
    -- A concurrent delivery may have inserted the same event first.
    select reason into v_ignored_reason
      from public.billing_test_ignored_webhook_events where event_id = p_event_id;
    return jsonb_build_object('ignored', true, 'reason', v_ignored_reason);
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
