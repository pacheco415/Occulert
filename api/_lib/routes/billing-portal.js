// POST /api/billing-portal — authenticated fleet owner, Stripe test mode.
const billing = require("../billing-test");
const stripe = require("../stripe-test");

module.exports = async function handler(request, response) {
  if (billing.methodOnly(request, response, "POST") || !billing.backendConfigured(response)) return;
  try {
    stripe.config();
    const configurationId = stripe.portalConfigurationId();
    const urls = stripe.fixedReturnUrls();
    const { fleet } = await billing.ownerContext(request, true);
    const row = await billing.billingRow(fleet.id);
    if (!row || !billing.CUSTOMER_RE.test(row.stripe_customer_id || "")) {
      const error = new Error("billing_not_started"); error.status = 404; throw error;
    }
    await stripe.requireSafePortalConfiguration(configurationId);
    const session = await stripe.stripeRequest("/v1/billing_portal/sessions", {
      method: "POST",
      fields: { customer: row.stripe_customer_id, configuration: configurationId, return_url: urls.portal },
    });
    const url = stripe.safeStripeUrl(session.url, "billing.stripe.com");
    if (!url || session.livemode !== false || session.customer !== row.stripe_customer_id ||
        session.configuration !== configurationId) throw new Error("invalid_test_portal_session");
    return billing.json(response, 200, { ok: true, test_mode: true, portal_url: url });
  } catch (error) {
    return billing.replyError(response, error);
  }
};
