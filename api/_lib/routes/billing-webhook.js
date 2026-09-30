// POST /api/billing-webhook — raw-body, signature-verified Stripe test events.
// Browser redirects never write billing state. The signed event identifies a
// subscription; current subscription state is then retrieved from Stripe.
const crypto = require("node:crypto");
const { pgFetch } = require("../supabase");
const billing = require("../billing-test");
const stripe = require("../stripe-test");

const SUPPORTED = new Set([
  "customer.subscription.created", "customer.subscription.updated",
  "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed",
]);
const STATUSES = new Set([
  "incomplete", "incomplete_expired", "trialing", "active",
  "past_due", "unpaid", "canceled", "paused",
]);

function subscriptionId(event) {
  const object = event && event.data && event.data.object;
  if (!object || typeof object !== "object") return null;
  if (event.type.startsWith("customer.subscription.")) return object.id;
  const parent = object.parent && object.parent.subscription_details;
  return object.subscription || parent && parent.subscription || null;
}

function currentSubscription(subscription, cfg, expectedId) {
  if (!subscription || subscription.id !== expectedId || subscription.livemode !== false ||
      !STATUSES.has(subscription.status) || !Array.isArray(subscription.items && subscription.items.data) ||
      subscription.items.data.length !== 1) throw new Error("invalid_test_subscription");
  const item = subscription.items.data[0];
  const priceId = item && item.price && item.price.id;
  const plan = Object.keys(cfg.prices).find(name => cfg.prices[name] === priceId);
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer && subscription.customer.id;
  const metadata = subscription.metadata || {};
  const periodEnd = item.current_period_end || subscription.current_period_end || null;
  if (!plan || !billing.CUSTOMER_RE.test(customerId || "") ||
      !billing.UUID_RE.test(metadata.fleet_id || "") ||
      !billing.UUID_RE.test(metadata.owner_user_id || "") ||
      (periodEnd !== null && (!Number.isSafeInteger(periodEnd) || periodEnd < 0 || periodEnd > 4102444800)) ||
      (["active", "trialing"].includes(subscription.status) && periodEnd === null)) {
    throw new Error("invalid_test_subscription");
  }
  return {
    fleetId: metadata.fleet_id,
    ownerId: metadata.owner_user_id,
    customerId,
    priceId,
    plan,
    status: subscription.status,
    periodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
  };
}

module.exports = async function handler(request, response) {
  if (billing.methodOnly(request, response, "POST") || !billing.backendConfigured(response)) return;
  try {
    const cfg = stripe.config();
    const raw = await stripe.readRawBody(request);
    if (!stripe.verifyWebhookSignature(raw, request.headers["stripe-signature"], cfg.webhookSecret)) {
      const error = new Error("invalid_signature"); error.status = 400; throw error;
    }
    let event;
    try { event = JSON.parse(raw.toString("utf8")); } catch (_) { event = null; }
    if (!event || !billing.EVENT_RE.test(event.id || "") || event.livemode !== false || event.account) {
      const error = new Error("invalid_signature"); error.status = 400; throw error;
    }
    if (!SUPPORTED.has(event.type)) {
      return billing.json(response, 200, { ok: true, ignored: true });
    }
    const id = subscriptionId(event);
    if (!billing.SUBSCRIPTION_RE.test(id || "")) throw new Error("invalid_test_subscription_event");
    const token = crypto.randomUUID();
    const claim = await pgFetch("rpc/claim_test_billing_sync", {
      method: "POST", body: { p_subscription_id: id, p_token: token },
    });
    if (!claim || claim.claimed !== true) {
      const error = new Error("billing_sync_busy"); error.status = 503; throw error;
    }
    let result;
    try {
      // Fetch only after the per-subscription lease is held. Concurrent
      // deliveries cannot commit snapshots in the reverse order they were read.
      const subscription = await stripe.stripeRequest("/v1/subscriptions/" + id);
      const current = currentSubscription(subscription, cfg, id);
      result = await pgFetch("rpc/apply_test_billing_event", {
        method: "POST",
        body: {
          p_event_id: event.id,
          p_event_type: event.type,
          p_fleet_id: current.fleetId,
          p_owner_user_id: current.ownerId,
          p_customer_id: current.customerId,
          p_subscription_id: id,
          p_price_id: current.priceId,
          p_plan: current.plan,
          p_status: current.status,
          p_period_end: current.periodEnd,
          p_cancel_at_period_end: current.cancelAtPeriodEnd,
          p_sync_token: token,
        },
      });
      if (!result || (result.applied !== true && result.duplicate !== true) ||
          (result.applied === true && result.duplicate === true)) {
        throw new Error("invalid_billing_persistence_result");
      }
    } finally {
      // A lost release only delays the next delivery until the 30-second lease
      // expires; it cannot permit an unguarded write.
      try {
        await pgFetch("rpc/release_test_billing_sync", {
          method: "POST", body: { p_subscription_id: id, p_token: token },
        });
      } catch (_) {}
    }
    return billing.json(response, 200, {
      ok: true, applied: result && result.applied === true, duplicate: result && result.duplicate === true,
    });
  } catch (error) {
    return billing.replyError(response, error);
  }
};
