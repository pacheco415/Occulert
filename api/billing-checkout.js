// POST /api/billing-checkout — authenticated fleet owner, Stripe test mode.
const crypto = require("node:crypto");
const { pgFetch } = require("./_lib/supabase");
const billing = require("./_lib/billing-test");
const stripe = require("./_lib/stripe-test");

function fail(message, status) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

async function reserve(fleet, user, plan, requestKey) {
  return pgFetch("rpc/reserve_test_checkout", {
    method: "POST",
    body: {
      p_fleet_id: fleet.id,
      p_owner_user_id: user.id,
      p_plan: plan,
      p_request_key: requestKey,
      p_token: crypto.randomUUID(),
    },
  });
}

async function pendingSession(reservation, fleet, user, customerId, plan) {
  if (reservation.plan !== plan) fail("checkout_pending", 409);
  const id = reservation.session_id;
  const url = stripe.safeStripeUrl(reservation.session_url, "checkout.stripe.com");
  if (!/^cs_test_[A-Za-z0-9]+$/.test(id || "") || !url) throw new Error("invalid_saved_checkout_session");
  const session = await stripe.stripeRequest("/v1/checkout/sessions/" + id);
  if (session.id !== id || session.customer !== customerId ||
      session.mode !== "subscription" || session.livemode !== false) {
    throw new Error("checkout_session_mismatch");
  }
  if (session.status === "open") return { existing: true, id, url };
  if (session.status === "complete") fail("checkout_awaiting_webhook", 409);
  if (session.status !== "expired") throw new Error("invalid_test_checkout_status");
  const cleared = await pgFetch("rpc/clear_expired_test_checkout", {
    method: "POST",
    body: { p_fleet_id: fleet.id, p_owner_user_id: user.id, p_session_id: id },
  });
  if (!cleared || cleared.cleared !== true) fail("checkout_pending", 409);
  return null;
}

module.exports = async function handler(request, response) {
  if (billing.methodOnly(request, response, "POST") || !billing.backendConfigured(response)) return;
  try {
    const cfg = stripe.config();
    const urls = stripe.fixedReturnUrls();
    const body = billing.parseJsonBody(request);
    if (!body || Object.keys(body).length !== 1 || typeof body.plan !== "string") {
      const error = new Error("invalid_json_body"); error.status = 400; throw error;
    }
    if (!Object.hasOwn(cfg.prices, body.plan)) {
      const error = new Error("invalid_plan"); error.status = 400; throw error;
    }
    const rawKey = request.headers["idempotency-key"];
    if (typeof rawKey !== "string" || !/^[A-Za-z0-9._:-]{16,128}$/.test(rawKey)) {
      const error = new Error("idempotency_key_required"); error.status = 400; throw error;
    }

    const { user, fleet } = await billing.ownerContext(request, true);
    let row = await billing.billingRow(fleet.id);
    if (row && row.stripe_subscription_id &&
        !["none", "canceled", "incomplete_expired"].includes(row.status)) {
      const error = new Error("subscription_exists"); error.status = 409; throw error;
    }

    // Fetch the configured price with the test key before creating a customer.
    await stripe.requireMonthlyTestPrice(cfg.prices[body.plan]);

    let customerId = row && row.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.stripeRequest("/v1/customers", {
        method: "POST",
        idempotencyKey: stripe.idempotencyKey("customer", [fleet.id]),
        fields: {
          email: user.email,
          "metadata[fleet_id]": fleet.id,
          "metadata[owner_user_id]": user.id,
        },
      });
      if (!billing.CUSTOMER_RE.test(customer.id)) throw new Error("invalid_test_customer");
      const registered = await pgFetch("rpc/register_test_billing_customer", {
        method: "POST",
        body: { p_fleet_id: fleet.id, p_owner_user_id: user.id, p_customer_id: customer.id },
      });
      customerId = registered && registered.stripe_customer_id;
      if (!billing.CUSTOMER_RE.test(customerId || "")) throw new Error("customer_registration_failed");
      row = await billing.billingRow(fleet.id);
      if (row && row.stripe_subscription_id &&
          !["none", "canceled", "incomplete_expired"].includes(row.status)) {
        const error = new Error("subscription_exists"); error.status = 409; throw error;
      }
    }
    if (!billing.CUSTOMER_RE.test(customerId || "")) throw new Error("invalid_test_customer");

    const providerKey = stripe.idempotencyKey("checkout", [fleet.id, rawKey]);
    let reservation = await reserve(fleet, user, body.plan, providerKey);
    if (reservation && reservation.state === "existing") {
      const pending = await pendingSession(reservation, fleet, user, customerId, body.plan);
      if (pending) {
        return billing.json(response, 200, {
          ok: true, test_mode: true, checkout_url: pending.url, session_id: pending.id,
          existing: true,
        });
      }
      reservation = await reserve(fleet, user, body.plan, providerKey);
    }
    if (!reservation || reservation.state === "pending") fail("checkout_pending", 409);
    if (reservation.state === "subscription_exists") fail("subscription_exists", 409);
    if (reservation.state === "recovery_required") fail("checkout_recovery_required", 409);
    if (!["create", "retry"].includes(reservation.state) ||
        !billing.UUID_RE.test(reservation.token || "")) throw new Error("invalid_checkout_reservation");

    const session = await stripe.stripeRequest("/v1/checkout/sessions", {
      method: "POST",
      idempotencyKey: providerKey,
      fields: {
        mode: "subscription",
        customer: customerId,
        "line_items[0][price]": cfg.prices[body.plan],
        "line_items[0][quantity]": "1",
        success_url: urls.success,
        cancel_url: urls.cancel,
        client_reference_id: fleet.id,
        "metadata[fleet_id]": fleet.id,
        "subscription_data[metadata][fleet_id]": fleet.id,
        "subscription_data[metadata][owner_user_id]": user.id,
      },
    });
    const url = stripe.safeStripeUrl(session.url, "checkout.stripe.com");
    if (!/^cs_test_[A-Za-z0-9]+$/.test(session.id || "") || !url || session.livemode !== false ||
        session.customer !== customerId || session.mode !== "subscription" || session.status !== "open" ||
        !Number.isSafeInteger(session.expires_at) || session.expires_at <= Date.now() / 1000) {
      throw new Error("invalid_test_checkout_session");
    }
    const completed = await pgFetch("rpc/complete_test_checkout", {
      method: "POST",
      body: {
        p_fleet_id: fleet.id,
        p_owner_user_id: user.id,
        p_token: reservation.token,
        p_session_id: session.id,
        p_session_url: url,
        p_expires_at: session.expires_at,
      },
    });
    if (completed && completed.subscription_exists === true) fail("subscription_exists", 409);
    if (!completed || completed.saved !== true) throw new Error("checkout_session_not_saved");
    return billing.json(response, 200, { ok: true, test_mode: true, checkout_url: url, session_id: session.id });
  } catch (error) {
    return billing.replyError(response, error);
  }
};
