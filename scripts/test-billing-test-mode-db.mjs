import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const migrations = [
  "20260927030000_stripe_test_billing.sql",
  "20260929010000_billing_ignored_webhook_events.sql",
].map(name => readFileSync(new URL("../supabase/migrations/" + name, import.meta.url), "utf8"));
const fleet = "11111111-1111-4111-8111-111111111111";
const owner = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const customer = "cus_TestCustomer";
const subscription = "sub_TestSubscription";

async function apply(eventId, overrides = {}) {
  const input = {
    eventId, eventType: "customer.subscription.updated", fleet, owner, customer,
    subscription, price: "price_TestStarter", plan: "starter", status: "active",
    periodEnd: 1800000000, cancel: false,
    ...overrides,
  };
  const token = crypto.randomUUID();
  const claimed = (await db.query(
    "select public.claim_test_billing_sync($1::text,$2::uuid) as result",
    [input.subscription, token],
  )).rows[0].result;
  assert.equal(claimed.claimed, true);
  try {
    const rows = (await db.query(`select public.apply_test_billing_event(
      $1::text,$2::text,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::text,$9::text,$10::bigint,$11::boolean,$12::uuid
    ) as result`, [
      input.eventId, input.eventType, input.fleet, input.owner, input.customer,
      input.subscription, input.price, input.plan, input.status, input.periodEnd, input.cancel, token,
    ])).rows;
    return rows[0].result;
  } finally {
    await db.query("select public.release_test_billing_sync($1::text,$2::uuid)", [input.subscription, token]);
  }
}

try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.fleets(id uuid primary key, owner_user_id uuid not null);
    grant usage on schema public to anon, authenticated, service_role;
    grant select on public.fleets to service_role;
    insert into public.fleets values ('${fleet}', '${owner}');`);
  for (const migration of migrations) await db.exec(migration);

  await db.exec("set role service_role");
  await assert.rejects(db.query(
    "select public.register_test_billing_customer($1::uuid,$2::uuid,$3::text)",
    [fleet, other, customer],
  ), /fleet_owner_mismatch/);
  let rows = (await db.query(
    "select public.register_test_billing_customer($1::uuid,$2::uuid,$3::text) as result",
    [fleet, owner, customer],
  )).rows;
  assert.equal(rows[0].result.stripe_customer_id, customer);
  rows = (await db.query(
    "select public.register_test_billing_customer($1::uuid,$2::uuid,$3::text) as result",
    [fleet, owner, "cus_AnotherCustomer"],
  )).rows;
  assert.equal(rows[0].result.stripe_customer_id, customer, "customer registration must be stable");

  const key = "occulert-test-checkout-" + "a".repeat(64);
  const otherKey = "occulert-test-checkout-" + "b".repeat(64);
  const reservationToken = crypto.randomUUID();
  const otherReservationToken = crypto.randomUUID();
  const reserve = async (requestKey, token = crypto.randomUUID()) => (await db.query(
    "select public.reserve_test_checkout($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid) as result",
    [fleet, owner, "starter", requestKey, token],
  )).rows[0].result;
  assert.deepEqual(await reserve(key, reservationToken), { state: "create", token: reservationToken });
  assert.deepEqual(await reserve(otherKey, otherReservationToken), { state: "pending" },
    "a second request key cannot reserve another session");
  assert.deepEqual(await reserve(key), { state: "retry", token: reservationToken });
  const expires = Math.floor(Date.now() / 1000) + 3600;
  await assert.rejects(db.query(
    "select public.complete_test_checkout($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::bigint)",
    [fleet, owner, otherReservationToken, "cs_test_TestCheckout", "https://checkout.stripe.com/c/pay/cs_test_TestCheckout", expires],
  ), /test_checkout_reservation_mismatch/);
  rows = (await db.query(
    "select public.complete_test_checkout($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::bigint) as result",
    [fleet, owner, reservationToken, "cs_test_TestCheckout", "https://checkout.stripe.com/c/pay/cs_test_TestCheckout", expires],
  )).rows;
  assert.deepEqual(rows[0].result, { saved: true });
  assert.equal((await reserve(otherKey)).state, "existing", "a saved pending session must be reused");
  rows = (await db.query(
    "select public.clear_expired_test_checkout($1::uuid,$2::uuid,$3::text) as result",
    [fleet, owner, "cs_test_TestCheckout"],
  )).rows;
  assert.deepEqual(rows[0].result, { cleared: true });
  assert.equal((await reserve(otherKey)).state, "create", "verified expired sessions can be replaced");

  const firstToken = crypto.randomUUID();
  const secondToken = crypto.randomUUID();
  assert.deepEqual((await db.query(
    "select public.claim_test_billing_sync($1::text,$2::uuid) as result",
    [subscription, firstToken],
  )).rows[0].result, { claimed: true });
  assert.deepEqual((await db.query(
    "select public.claim_test_billing_sync($1::text,$2::uuid) as result",
    [subscription, secondToken],
  )).rows[0].result, { claimed: false }, "a second webhook cannot fetch while one holds the lease");
  await assert.rejects(db.query(`select public.apply_test_billing_event(
    $1::text,$2::text,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::text,$9::text,$10::bigint,$11::boolean,$12::uuid
  )`, ["evt_NoLease", "customer.subscription.updated", fleet, owner, customer,
    subscription, "price_TestStarter", "starter", "active", 1800000000, false, secondToken]),
  /test_billing_sync_not_claimed/);
  await db.query(
    "update public.billing_test_subscription_sync_locks set lease_expires_at=now()-interval '1 second' where stripe_subscription_id=$1",
    [subscription],
  );
  assert.deepEqual((await db.query(
    "select public.claim_test_billing_sync($1::text,$2::uuid) as result",
    [subscription, secondToken],
  )).rows[0].result, { claimed: true }, "expired leases can be reclaimed");
  await assert.rejects(db.query(`select public.apply_test_billing_event(
    $1::text,$2::text,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::text,$9::text,$10::bigint,$11::boolean,$12::uuid
  )`, ["evt_StaleWorker", "customer.subscription.updated", fleet, owner, customer,
    subscription, "price_TestStarter", "starter", "active", 1800000000, false, firstToken]),
  /test_billing_sync_not_claimed/, "the old worker cannot commit after lease takeover");
  rows = (await db.query(
    "select public.release_test_billing_sync($1::text,$2::uuid) as result", [subscription, firstToken],
  )).rows;
  assert.deepEqual(rows[0].result, { released: false });
  await db.query("select public.release_test_billing_sync($1::text,$2::uuid)", [subscription, secondToken]);

  assert.deepEqual(await apply("evt_TestFirst"), { applied: true, duplicate: false });
  assert.deepEqual(await apply("evt_TestFirst", { status: "canceled" }),
    { applied: false, duplicate: true }, "duplicate event IDs must be harmless");
  rows = (await db.query("select status, plan from public.fleet_billing_test where fleet_id=$1", [fleet])).rows;
  assert.equal(rows[0].status, "active");
  assert.equal(rows[0].plan, "starter");
  rows = (await db.query("select checkout_reservation_token from public.fleet_billing_test where fleet_id=$1", [fleet])).rows;
  assert.equal(rows[0].checkout_reservation_token, null, "signed subscription state clears pending Checkout");

  assert.deepEqual(await apply("evt_BadOwner", { owner: other }),
    { ignored: true, reason: "fleet_owner_mismatch" });
  assert.deepEqual(await apply("evt_BadCustomer", { customer: "cus_AnotherCustomer" }),
    { ignored: true, reason: "test_customer_mismatch" });
  assert.deepEqual(await apply("evt_BadCustomer"),
    { ignored: true, reason: "test_customer_mismatch" },
    "an ignored event ID must retain its original reason");
  await assert.rejects(apply("evt_SecondSub", { subscription: "sub_AnotherSubscription" }),
    /multiple_test_subscriptions_conflict/);
  rows = (await db.query("select count(*)::integer as n from public.billing_test_webhook_events")).rows;
  assert.equal(rows[0].n, 1, "ignored and transiently rejected events must not be marked applied");
  rows = (await db.query(
    "select event_id, reason from public.billing_test_ignored_webhook_events order by event_id",
  )).rows;
  assert.deepEqual(rows, [
    { event_id: "evt_BadCustomer", reason: "test_customer_mismatch" },
    { event_id: "evt_BadOwner", reason: "fleet_owner_mismatch" },
  ]);

  assert.deepEqual(await apply("evt_Canceled", { status: "canceled", cancel: true }),
    { applied: true, duplicate: false });
  const newReservation = await reserve(otherKey);
  assert.equal(newReservation.state, "create");
  rows = (await db.query(
    "select public.complete_test_checkout($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::bigint) as result",
    [fleet, owner, newReservation.token, "cs_test_NewCheckout", "https://checkout.stripe.com/c/pay/cs_test_NewCheckout", expires],
  )).rows;
  assert.deepEqual(rows[0].result, { saved: true });
  assert.deepEqual(await apply("evt_OldAfterReservation", { status: "canceled" }),
    { applied: true, duplicate: false });
  rows = (await db.query("select checkout_session_id from public.fleet_billing_test where fleet_id=$1", [fleet])).rows;
  assert.equal(rows[0].checkout_session_id, "cs_test_NewCheckout",
    "late events for the old canceled subscription must preserve the new Checkout");
  assert.deepEqual(await apply("evt_NewSub", { subscription: "sub_AnotherSubscription" }),
    { applied: true, duplicate: false });
  rows = (await db.query("select checkout_session_id from public.fleet_billing_test where fleet_id=$1", [fleet])).rows;
  assert.equal(rows[0].checkout_session_id, null, "the new subscription consumes the pending Checkout");
  assert.deepEqual(await apply("evt_TestFirst"), { applied: false, duplicate: true },
    "old duplicate delivery must remain acknowledged after a later subscription");

  await db.exec("reset role");
  await db.query("update public.fleets set owner_user_id=$1 where id=$2", [other, fleet]);
  await db.exec("set role service_role");
  assert.deepEqual(await apply("evt_ChangedOwner"),
    { ignored: true, reason: "fleet_owner_mismatch" });
  await db.exec("reset role");
  await db.query("delete from public.fleets where id=$1", [fleet]);
  await db.exec("set role service_role");
  assert.deepEqual(await apply("evt_DeletedFleet"),
    { ignored: true, reason: "fleet_owner_mismatch" });
  rows = (await db.query(
    "select event_id, reason from public.billing_test_ignored_webhook_events where event_id in ($1, $2) order by event_id",
    ["evt_ChangedOwner", "evt_DeletedFleet"],
  )).rows;
  assert.deepEqual(rows, [
    { event_id: "evt_ChangedOwner", reason: "fleet_owner_mismatch" },
    { event_id: "evt_DeletedFleet", reason: "fleet_owner_mismatch" },
  ], "ignored reasons must survive fleet deletion");
  await db.exec("reset role");

  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query("select * from public.fleet_billing_test"), /permission denied/);
    await assert.rejects(db.query("select * from public.billing_test_subscription_sync_locks"), /permission denied/);
    await assert.rejects(db.query("select * from public.billing_test_ignored_webhook_events"), /permission denied/);
    await assert.rejects(db.query(
      "select public.register_test_billing_customer($1::uuid,$2::uuid,$3::text)",
      [fleet, owner, customer],
    ), /permission denied/);
    await assert.rejects(db.query(
      "select public.claim_test_billing_sync($1::text,$2::uuid)",
      [subscription, crypto.randomUUID()],
    ), /permission denied/);
    await db.exec("reset role");
  }
  console.log("Stripe test-mode billing SQL: owner checks, atomic deduplication, conflicts, and permissions passed.");
} finally {
  await db.close();
}
