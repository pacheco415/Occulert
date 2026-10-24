// DELETE /api/account -> permanently delete the authenticated Occulert account.
// The service-role key is used only on the server after the bearer token has
// been verified. The browser must send { confirm: "DELETE" } deliberately.

const { hasRecentAuthentication } = require("./_lib/recent-auth");
const supabaseLib = require("./_lib/supabase");
const verifyAccessToken = supabaseLib.verifyAccessToken;
const deleteAuthUser = supabaseLib.deleteAuthUser;
const bearerToken = supabaseLib.bearerToken;
const stripe = require("./_lib/stripe-test");

const { validJsonBody } = require("./_lib/validation");
const { json } = require("./_lib/responses");

function validBody(request) {
  return validJsonBody(request, 256) && request.body.confirm === "DELETE";
}

function billingCleanupUnavailable() {
  const error = new Error("billing_cleanup_unavailable");
  error.code = "billing_cleanup_unavailable";
  return error;
}

// Database cascades remove the billing row, but Stripe would keep the customer
// (email plus fleet and owner IDs) and keep renewing its subscription. Delete
// the customer first; that also cancels its active subscriptions. Fail closed
// so billing never outlives the account. Reads only: nothing is pre-deleted.
async function deleteBillingCustomer(userId) {
  let row = null;
  try {
    const fleets = await supabaseLib.pgFetch("fleets", {
      params: { select: "id", owner_user_id: "eq." + userId, limit: "1" },
    });
    if (!Array.isArray(fleets) || !fleets[0]) return;
    const rows = await supabaseLib.pgFetch("fleet_billing_test", {
      params: { select: "stripe_customer_id", fleet_id: "eq." + fleets[0].id, limit: "1" },
    });
    row = Array.isArray(rows) ? rows[0] : null;
  } catch (error) {
    // Databases without the test-billing migration have no billing rows.
    if (["42P01", "PGRST205"].includes(error && error.details && error.details.code)) return;
    throw billingCleanupUnavailable();
  }
  if (!row || !row.stripe_customer_id) return;
  try {
    // Validates the stored customer ID and refuses anything but test keys.
    await stripe.deleteTestCustomer(row.stripe_customer_id);
  } catch (error) {
    throw billingCleanupUnavailable();
  }
}

module.exports = async function handler(request, response) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(response, 501, { ok: false, error: "backend_not_configured" });
  }
  if (request.method !== "DELETE") {
    response.setHeader("Allow", "DELETE");
    return json(response, 405, { ok: false, error: "method_not_allowed" });
  }

  if (!validBody(request)) return json(response, 400, { ok: false, error: "confirmation_required" });

  try {
    const accessToken = bearerToken(request);
    const user = await verifyAccessToken(accessToken, { freshUser: true });
    if (!user || !user.id) return json(response, 401, { ok: false, error: "unauthorized" });
    if (!hasRecentAuthentication(accessToken, user)) return json(response, 401, { ok: false, error: "reauth_required" });
    await deleteBillingCustomer(user.id);
    // Database foreign keys perform cleanup in the Auth deletion transaction.
    // Never pre-delete rows: any constraint/storage failure must roll back all data.
    await deleteAuthUser(user.id);
    return json(response, 200, { ok: true, deleted: true });
  } catch (error) {
    if (error && error.code === "billing_cleanup_unavailable") {
      return json(response, 503, { ok: false, error: "billing_cleanup_unavailable" });
    }
    return json(response, 502, { ok: false, error: "account_deletion_failed" });
  }
};

module.exports = require("./_lib/provider-budget").withProviderBudget(module.exports);
