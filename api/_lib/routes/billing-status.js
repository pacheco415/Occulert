// GET /api/billing-status — informational Stripe test-mode state for owner.
const billing = require("../billing-test");
const stripe = require("../stripe-test");

module.exports = async function handler(request, response) {
  if (billing.methodOnly(request, response, "GET") || !billing.backendConfigured(response)) return;
  try {
    stripe.config();
    const { fleet } = await billing.ownerContext(request, false);
    const row = await billing.billingRow(fleet.id);
    return billing.json(response, 200, {
      ok: true,
      test_mode: true,
      informational_only: true,
      billing: row ? {
        plan: row.plan,
        status: row.status,
        current_period_end: row.current_period_end,
        cancel_at_period_end: row.cancel_at_period_end,
        updated_at: row.updated_at,
      } : { plan: null, status: "none", current_period_end: null, cancel_at_period_end: false, updated_at: null },
    });
  } catch (error) {
    return billing.replyError(response, error);
  }
};
