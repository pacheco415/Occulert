import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkout = require("../api/_lib/routes/billing-checkout.js");
const portal = require("../api/_lib/routes/billing-portal.js");
const status = require("../api/_lib/routes/billing-status.js");
const webhook = require("../api/_lib/routes/billing-webhook.js");
const stripe = require("../api/_lib/stripe-test.js");

process.env.SUPABASE_URL = "https://unit-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.STRIPE_TEST_SECRET_KEY = "sk_test_UnitOnly";
process.env.STRIPE_TEST_WEBHOOK_SECRET = "whsec_UnitOnly";
process.env.STRIPE_TEST_PRICE_STARTER = "price_TestStarter";
process.env.STRIPE_TEST_PRICE_GROWTH = "price_TestGrowth";
process.env.STRIPE_TEST_PORTAL_CONFIGURATION_ID = "bpc_TestSafePortal";
process.env.OCCULERT_BILLING_SITE_ORIGIN = "https://www.occulert.com";

const fleetId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const customerId = "cus_TestCustomer";
const subscriptionId = "sub_TestSubscription";
let billingRow = null;
let providerCalls = [];
let ownerEmail = "owner@example.com";
let failCustomerRegistrationOnce = false;
const customerRequests = new Map();
let appliedEvents = new Set();
let applyCalls = 0;
let subscriptionState = "active";
let priceLivemode = false;
let priceErrorStatus = null;
let portalConfigurationSafe = true;
let checkoutSessionStatus = "open";
let checkoutCreateCount = 0;
let malformedPersistenceResult = false;
let fleetState = "owned";
let persistenceErrorStatus = null;
let stripeSubscriptionTimeout = false;
const ignoredEvents = new Map();
const syncLocks = new Map();

function http(statusCode, body) {
  return { ok: statusCode >= 200 && statusCode < 300, status: statusCode,
    text: async () => body === undefined ? "" : JSON.stringify(body) };
}

globalThis.fetch = async (url, options = {}) => {
  const target = new URL(String(url));
  if (target.hostname === "unit-test.supabase.co") {
    if (target.pathname === "/auth/v1/user") {
      if (options.headers.Authorization === "Bearer owner-token") return http(200, {
        id: ownerId, email: ownerEmail, email_confirmed_at: "2026-09-01T00:00:00Z",
      });
      if (options.headers.Authorization === "Bearer other-token") return http(200, {
        id: "33333333-3333-4333-8333-333333333333", email: "other@example.com",
        email_confirmed_at: "2026-09-01T00:00:00Z",
      });
      return http(401);
    }
    if (target.pathname === "/rest/v1/fleets") {
      return http(200, target.searchParams.get("owner_user_id") === "eq." + ownerId
        ? [{ id: fleetId, owner_user_id: ownerId }] : []);
    }
    if (target.pathname === "/rest/v1/fleet_billing_test") {
      return http(200, billingRow ? [billingRow] : []);
    }
    if (target.pathname === "/rest/v1/rpc/register_test_billing_customer") {
      const body = JSON.parse(options.body);
      assert.equal(body.p_fleet_id, fleetId);
      assert.equal(body.p_owner_user_id, ownerId);
      if (failCustomerRegistrationOnce) {
        failCustomerRegistrationOnce = false;
        return http(503, { message: "temporary_registration_failure" });
      }
      billingRow ||= {
        fleet_id: fleetId, stripe_customer_id: body.p_customer_id,
        stripe_subscription_id: null, plan: null, status: "none",
        current_period_end: null, cancel_at_period_end: false, updated_at: null,
        checkout_request_key: null, checkout_plan: null, checkout_reservation_token: null,
        checkout_session_id: null, checkout_session_url: null, checkout_expires_at: null,
      };
      return http(200, { stripe_customer_id: billingRow.stripe_customer_id });
    }
    if (target.pathname === "/rest/v1/rpc/reserve_test_checkout") {
      const body = JSON.parse(options.body);
      assert.equal(body.p_fleet_id, fleetId);
      assert.equal(body.p_owner_user_id, ownerId);
      if (billingRow.stripe_subscription_id &&
          !["none", "canceled", "incomplete_expired"].includes(billingRow.status)) {
        return http(200, { state: "subscription_exists" });
      }
      if (billingRow.checkout_session_id) return http(200, {
        state: "existing", plan: billingRow.checkout_plan,
        session_id: billingRow.checkout_session_id,
        session_url: billingRow.checkout_session_url,
        expires_at: billingRow.checkout_expires_at,
      });
      if (billingRow.checkout_reservation_token) {
        return http(200, billingRow.checkout_request_key === body.p_request_key &&
          billingRow.checkout_plan === body.p_plan
          ? { state: "retry", token: billingRow.checkout_reservation_token }
          : { state: "pending" });
      }
      Object.assign(billingRow, {
        checkout_request_key: body.p_request_key,
        checkout_plan: body.p_plan,
        checkout_reservation_token: body.p_token,
      });
      return http(200, { state: "create", token: body.p_token });
    }
    if (target.pathname === "/rest/v1/rpc/complete_test_checkout") {
      const body = JSON.parse(options.body);
      assert.equal(body.p_token, billingRow.checkout_reservation_token);
      Object.assign(billingRow, {
        checkout_session_id: body.p_session_id,
        checkout_session_url: body.p_session_url,
        checkout_expires_at: body.p_expires_at,
      });
      return http(200, { saved: true });
    }
    if (target.pathname === "/rest/v1/rpc/clear_expired_test_checkout") {
      const body = JSON.parse(options.body);
      if (body.p_session_id !== billingRow.checkout_session_id) return http(200, { cleared: false });
      Object.assign(billingRow, {
        checkout_request_key: null, checkout_plan: null, checkout_reservation_token: null,
        checkout_session_id: null, checkout_session_url: null, checkout_expires_at: null,
      });
      return http(200, { cleared: true });
    }
    if (target.pathname === "/rest/v1/rpc/claim_test_billing_sync") {
      const body = JSON.parse(options.body);
      if (syncLocks.has(body.p_subscription_id)) return http(200, { claimed: false });
      syncLocks.set(body.p_subscription_id, body.p_token);
      return http(200, { claimed: true });
    }
    if (target.pathname === "/rest/v1/rpc/release_test_billing_sync") {
      const body = JSON.parse(options.body);
      const released = syncLocks.get(body.p_subscription_id) === body.p_token;
      if (released) syncLocks.delete(body.p_subscription_id);
      return http(200, { released });
    }
    if (target.pathname === "/rest/v1/rpc/apply_test_billing_event") {
      applyCalls++;
      const body = JSON.parse(options.body);
      assert.equal(body.p_fleet_id, fleetId);
      assert.equal(body.p_owner_user_id, ownerId);
      assert.equal(body.p_customer_id, customerId);
      assert.equal(syncLocks.get(body.p_subscription_id), body.p_sync_token);
      if (malformedPersistenceResult) return http(200, {});
      if (persistenceErrorStatus) return http(persistenceErrorStatus, { message: "temporary_database_failure" });
      if (ignoredEvents.has(body.p_event_id)) {
        return http(200, { ignored: true, reason: ignoredEvents.get(body.p_event_id) });
      }
      if (appliedEvents.has(body.p_event_id)) return http(200, { applied: false, duplicate: true });
      const reason = fleetState !== "owned" ? "fleet_owner_mismatch"
        : billingRow.stripe_customer_id !== body.p_customer_id ? "test_customer_mismatch" : null;
      if (reason) {
        ignoredEvents.set(body.p_event_id, reason);
        return http(200, { ignored: true, reason });
      }
      appliedEvents.add(body.p_event_id);
      billingRow = {
        ...billingRow,
        stripe_subscription_id: body.p_subscription_id,
        plan: body.p_plan,
        status: body.p_status,
        current_period_end: new Date(body.p_period_end * 1000).toISOString(),
        cancel_at_period_end: body.p_cancel_at_period_end,
        updated_at: "2026-09-27T23:00:00Z",
        checkout_request_key: null, checkout_plan: null, checkout_reservation_token: null,
        checkout_session_id: null, checkout_session_url: null, checkout_expires_at: null,
      };
      return http(200, { applied: true, duplicate: false });
    }
    throw new Error("Unexpected Supabase request: " + target.pathname);
  }
  if (target.hostname === "api.stripe.com") {
    providerCalls.push({ path: target.pathname, options });
    assert.equal(options.headers.Authorization, "Bearer sk_test_UnitOnly");
    if (target.pathname.startsWith("/v1/prices/") && priceErrorStatus) {
      return http(priceErrorStatus, { error: { code: "test_config_error" } });
    }
    if (target.pathname === "/v1/prices/price_TestStarter") return http(200, {
      id: "price_TestStarter", livemode: priceLivemode, active: true, type: "recurring",
      recurring: { interval: "month", interval_count: 1 }, unit_amount: 900,
    });
    if (target.pathname === "/v1/prices/price_TestGrowth") return http(200, {
      id: "price_TestGrowth", livemode: false, active: true, type: "recurring",
      recurring: { interval: "month", interval_count: 1 }, unit_amount: 2500,
    });
    if (target.pathname === "/v1/customers") {
      const key = options.headers["Idempotency-Key"];
      if (customerRequests.has(key) && customerRequests.get(key) !== options.body) {
        return http(400, { error: { code: "idempotency_error" } });
      }
      customerRequests.set(key, options.body);
      return http(200, { id: customerId, livemode: false });
    }
    if (target.pathname === "/v1/checkout/sessions" && options.method === "POST") {
      checkoutCreateCount++;
      const id = "cs_test_UnitSession" + checkoutCreateCount;
      return http(200, {
        id, livemode: false, mode: "subscription", customer: customerId, status: "open",
        url: "https://checkout.stripe.com/c/pay/" + id,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      });
    }
    if (/^\/v1\/checkout\/sessions\/cs_test_[A-Za-z0-9]+$/.test(target.pathname)) return http(200, {
      id: target.pathname.split("/").at(-1), livemode: false, mode: "subscription",
      customer: customerId, status: checkoutSessionStatus,
    });
    if (target.pathname === "/v1/billing_portal/configurations/bpc_TestSafePortal") return http(200, {
      id: "bpc_TestSafePortal", livemode: false, active: true,
      features: {
        subscription_cancel: { enabled: true },
        subscription_update: { enabled: !portalConfigurationSafe },
      },
    });
    if (target.pathname === "/v1/billing_portal/sessions") return http(200, {
      id: "bps_TestSession", livemode: false, customer: customerId,
      configuration: "bpc_TestSafePortal",
      url: "https://billing.stripe.com/p/session/test_UnitSession",
    });
    if (target.pathname === "/v1/subscriptions/" + subscriptionId && stripeSubscriptionTimeout) {
      const error = new Error("Stripe subscription request timed out");
      error.name = "AbortError";
      throw error;
    }
    if (target.pathname === "/v1/subscriptions/" + subscriptionId) return http(200, {
      id: subscriptionId, livemode: false, status: subscriptionState,
      customer: customerId, metadata: { fleet_id: fleetId, owner_user_id: ownerId },
      items: { data: [{ price: { id: "price_TestStarter" }, current_period_end: 1800000000 }] },
      cancel_at_period_end: subscriptionState === "canceled",
    });
    throw new Error("Unexpected Stripe request: " + target.pathname);
  }
  throw new Error("Unexpected host: " + target.hostname);
};

async function invoke(handler, request) {
  let output;
  const response = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { output = { status: this.statusCode, body: JSON.parse(body), headers: this.headers }; },
  };
  await handler(request, response);
  assert.ok(output, "handler must complete response");
  return output;
}

function request(method, token = "owner-token", body = undefined, extraHeaders = {}) {
  return {
    method,
    headers: { authorization: "Bearer " + token, "content-type": "application/json", ...extraHeaders },
    body,
  };
}

function signedWebhook(id, type, livemode = false, valid = true) {
  const object = type.startsWith("invoice.")
    ? { id: "in_TestInvoice", parent: { subscription_details: { subscription: subscriptionId } } }
    : { id: subscriptionId };
  const payload = { id, type, livemode, data: { object } };
  const raw = Buffer.from(JSON.stringify(payload));
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = crypto.createHmac("sha256", process.env.STRIPE_TEST_WEBHOOK_SECRET)
    .update(Buffer.concat([Buffer.from(timestamp + "."), raw])).digest("hex");
  return {
    method: "POST",
    headers: {
      "content-length": String(raw.length),
      "stripe-signature": `t=${timestamp},v1=${valid ? digest : "0".repeat(64)}`,
    },
    async *[Symbol.asyncIterator]() { yield raw; },
  };
}

assert.equal(stripe.verifyWebhookSignature(Buffer.from("{}"), "t=0,v1=" + "0".repeat(64),
  process.env.STRIPE_TEST_WEBHOOK_SECRET), false, "old signatures must fail");

let result = await invoke(checkout, request("POST", "bad-token", { plan: "starter" },
  { "idempotency-key": "test-request-0001" }));
assert.equal(result.status, 401);
assert.equal(providerCalls.length, 0);

priceLivemode = true;
result = await invoke(checkout, request("POST", "owner-token", { plan: "starter" },
  { "idempotency-key": "test-request-0001" }));
assert.equal(result.status, 502, "a live-mode price object must be rejected");
assert.equal(providerCalls.some(call => call.path === "/v1/customers"), false);
priceLivemode = false;

priceErrorStatus = 401;
result = await invoke(checkout, request("POST", "owner-token", { plan: "starter" },
  { "idempotency-key": "test-request-0001" }));
assert.equal(result.status, 502, "Stripe key errors must not be returned as owner-auth errors");
priceErrorStatus = null;

failCustomerRegistrationOnce = true;
result = await invoke(checkout, request("POST", "owner-token", { plan: "starter" },
  { "idempotency-key": "test-request-0001" }));
assert.equal(result.status, 503, "a failed customer registration should be retryable");
const firstCustomerCall = providerCalls.filter(call => call.path === "/v1/customers").at(-1);
assert.equal(new URLSearchParams(firstCustomerCall.options.body).get("email"), "owner@example.com");
ownerEmail = "new-owner@example.com";
result = await invoke(checkout, request("POST", "owner-token", { plan: "starter" },
  { "idempotency-key": "test-request-0001" }));
assert.equal(result.status, 200);
const secondCustomerCall = providerCalls.filter(call => call.path === "/v1/customers").at(-1);
assert.notEqual(firstCustomerCall.options.headers["Idempotency-Key"],
  secondCustomerCall.options.headers["Idempotency-Key"],
  "changed email must get a new customer idempotency key");
assert.equal(new URLSearchParams(secondCustomerCall.options.body).get("email"), "new-owner@example.com");
assert.equal(customerRequests.size, 2, "Stripe must accept the retried customer request");
assert.equal(result.body.test_mode, true);
assert.match(result.body.checkout_url, /^https:\/\/checkout\.stripe\.com\//);
assert.equal(billingRow.status, "none", "Checkout must not grant subscription state");
const checkoutCall = providerCalls.find(call => call.path === "/v1/checkout/sessions");
assert.ok(checkoutCall.options.headers["Idempotency-Key"]);
const checkoutFields = new URLSearchParams(checkoutCall.options.body);
assert.equal(checkoutFields.get("line_items[0][price]"), "price_TestStarter");
assert.equal(checkoutFields.get("subscription_data[metadata][fleet_id]"), fleetId);
assert.equal(checkoutFields.get("success_url"), "https://www.occulert.com/fleet-dashboard.html?billing=return");
result = await invoke(checkout, request("POST", "owner-token", { plan: "starter" },
  { "idempotency-key": "test-request-0001" }));
assert.equal(result.status, 200);
assert.equal(result.body.existing, true);
assert.equal(checkoutCreateCount, 1, "a retry must reuse the saved Checkout session");
result = await invoke(checkout, request("POST", "owner-token", { plan: "starter" },
  { "idempotency-key": "test-request-0002" }));
assert.equal(result.status, 200);
assert.equal(checkoutCreateCount, 1, "a different key cannot create a second pending session");
result = await invoke(checkout, request("POST", "owner-token", { plan: "growth" },
  { "idempotency-key": "test-request-0003" }));
assert.equal(result.status, 409, "changing plans must wait for the pending session to expire");
assert.equal(result.body.error, "checkout_pending");

result = await invoke(portal, request("POST", "other-token"));
assert.equal(result.status, 404, "a different authenticated user cannot open the owner's portal");
portalConfigurationSafe = false;
result = await invoke(portal, request("POST"));
assert.equal(result.status, 502, "portal configuration with plan updates must be rejected");
portalConfigurationSafe = true;
result = await invoke(portal, request("POST"));
assert.equal(result.status, 200);
assert.match(result.body.portal_url, /^https:\/\/billing\.stripe\.com\//);
const portalCall = providerCalls.find(call => call.path === "/v1/billing_portal/sessions");
assert.equal(new URLSearchParams(portalCall.options.body).get("configuration"), "bpc_TestSafePortal");

result = await invoke(webhook, signedWebhook("evt_Unit1", "customer.subscription.updated", false, false));
assert.equal(result.status, 400);
assert.equal(applyCalls, 0);
result = await invoke(webhook, signedWebhook("evt_Unit1", "customer.subscription.updated", true));
assert.equal(result.status, 400, "signed live-mode events must fail");
assert.equal(applyCalls, 0);
syncLocks.set(subscriptionId, "other-worker");
result = await invoke(webhook, signedWebhook("evt_Unit1", "customer.subscription.updated"));
assert.equal(result.status, 503, "a busy subscription sync must ask Stripe to retry");
assert.equal(applyCalls, 0);
syncLocks.delete(subscriptionId);
result = await invoke(webhook, signedWebhook("evt_Unit1", "customer.subscription.updated"));
assert.equal(result.status, 200);
assert.equal(result.body.applied, true);
assert.equal(billingRow.status, "active");
result = await invoke(webhook, signedWebhook("evt_Unit1", "customer.subscription.updated"));
assert.equal(result.status, 200);
assert.equal(result.body.duplicate, true);
assert.equal(appliedEvents.size, 1);
malformedPersistenceResult = true;
result = await invoke(webhook, signedWebhook("evt_RetryAfterBadResult", "customer.subscription.updated"));
assert.equal(result.status, 502, "an unknown database result must not acknowledge a webhook");
assert.equal(syncLocks.has(subscriptionId), false, "failed processing must release its lease");
malformedPersistenceResult = false;
result = await invoke(webhook, signedWebhook("evt_RetryAfterBadResult", "customer.subscription.updated"));
assert.equal(result.status, 200);
assert.equal(result.body.applied, true);

fleetState = "deleted";
result = await invoke(webhook, signedWebhook("evt_DeletedFleet", "customer.subscription.updated"));
assert.deepEqual(result.body, { ok: true, ignored: true, reason: "fleet_owner_mismatch" });
assert.equal(result.status, 200, "a deleted fleet is a permanent webhook mismatch");
fleetState = "owner_changed";
result = await invoke(webhook, signedWebhook("evt_ChangedOwner", "customer.subscription.updated"));
assert.equal(result.status, 200, "an owner change is a permanent webhook mismatch");
assert.equal(result.body.reason, "fleet_owner_mismatch");
fleetState = "owned";
result = await invoke(webhook, signedWebhook("evt_DeletedFleet", "customer.subscription.updated"));
assert.deepEqual(result.body, { ok: true, ignored: true, reason: "fleet_owner_mismatch" },
  "the ignored event ID keeps its reason on redelivery");
billingRow.stripe_customer_id = "cus_AnotherCustomer";
result = await invoke(webhook, signedWebhook("evt_CustomerMismatch", "customer.subscription.updated"));
assert.equal(result.status, 200);
assert.deepEqual(result.body, { ok: true, ignored: true, reason: "test_customer_mismatch" });
billingRow.stripe_customer_id = customerId;
persistenceErrorStatus = 503;
result = await invoke(webhook, signedWebhook("evt_TemporaryDatabaseFailure", "customer.subscription.updated"));
assert.equal(result.status, 503, "database failures must ask Stripe to retry");
assert.equal(ignoredEvents.has("evt_TemporaryDatabaseFailure"), false);
persistenceErrorStatus = null;
result = await invoke(webhook, signedWebhook("evt_TemporaryDatabaseFailure", "customer.subscription.updated"));
assert.equal(result.status, 200, "a transient database failure must be retryable");
assert.equal(result.body.applied, true);
stripeSubscriptionTimeout = true;
result = await invoke(webhook, signedWebhook("evt_StripeTimeout", "customer.subscription.updated"));
assert.equal(result.status, 504, "a Stripe timeout must ask Stripe to retry");
assert.equal(ignoredEvents.has("evt_StripeTimeout"), false);
stripeSubscriptionTimeout = false;
ignoredEvents.set("evt_UnsupportedIgnore", "billing_sync_busy");
result = await invoke(webhook, signedWebhook("evt_UnsupportedIgnore", "customer.subscription.updated"));
assert.equal(result.status, 502, "only the two permanent mismatch reasons may be acknowledged");
ignoredEvents.delete("evt_UnsupportedIgnore");

result = await invoke(status, request("GET"));
assert.equal(result.status, 200);
assert.equal(result.body.informational_only, true);
assert.equal(result.body.billing.status, "active");
assert.equal(result.body.billing.plan, "starter");
assert.equal(result.body.billing.stripe_customer_id, undefined);

subscriptionState = "canceled";
result = await invoke(webhook, signedWebhook("evt_Unit2", "customer.subscription.updated"));
assert.equal(result.status, 200);
assert.equal(billingRow.status, "canceled", "latest Stripe state must win over event snapshot");
subscriptionState = "active";
result = await invoke(webhook, signedWebhook("evt_Unit3", "invoice.paid"));
assert.equal(result.status, 200);
assert.equal(billingRow.status, "active", "invoice parent subscription references must be supported");

subscriptionState = "canceled";
result = await invoke(webhook, signedWebhook("evt_Unit4", "customer.subscription.updated"));
assert.equal(result.status, 200);
result = await invoke(checkout, request("POST", "owner-token", { plan: "starter" },
  { "idempotency-key": "test-request-0004" }));
assert.equal(result.status, 200);
assert.equal(checkoutCreateCount, 2);
checkoutSessionStatus = "complete";
result = await invoke(checkout, request("POST", "owner-token", { plan: "starter" },
  { "idempotency-key": "test-request-0005" }));
assert.equal(result.status, 409, "a completed session cannot be replaced before its webhook");
assert.equal(result.body.error, "checkout_awaiting_webhook");
checkoutSessionStatus = "expired";
result = await invoke(checkout, request("POST", "owner-token", { plan: "starter" },
  { "idempotency-key": "test-request-0005" }));
assert.equal(result.status, 200, "a Stripe-confirmed expired session can be replaced");
assert.equal(checkoutCreateCount, 3);

process.env.STRIPE_TEST_SECRET_KEY = "sk_live_Forbidden";
result = await invoke(checkout, request("POST", "owner-token", { plan: "starter" },
  { "idempotency-key": "test-request-0002" }));
assert.equal(result.status, 501, "live keys must be rejected");
process.env.STRIPE_TEST_SECRET_KEY = "sk_test_UnitOnly";

process.env.OCCULERT_BILLING_SITE_ORIGIN = "https://example.com";
result = await invoke(checkout, request("POST", "owner-token", { plan: "starter" },
  { "idempotency-key": "test-request-0003" }));
assert.equal(result.status, 501, "return URLs must stay on Occulert domains");

console.log("Stripe test-mode billing routes: owner auth, redirects, webhook signature, deduplication and informational status passed.");
