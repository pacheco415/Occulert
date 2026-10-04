// DELETE /api/account -> permanently delete the authenticated Occulert account.
// The service-role key is used only on the server after the bearer token has
// been verified. The browser must send { confirm: "DELETE" } deliberately.

const { hasRecentAuthentication } = require("./_lib/recent-auth");
const supabaseLib = require("./_lib/supabase");
const verifyAccessToken = supabaseLib.verifyAccessToken;
const deleteAuthUser = supabaseLib.deleteAuthUser;
const bearerToken = supabaseLib.bearerToken;

const { validJsonBody } = require("./_lib/validation");
const { json } = require("./_lib/responses");

function validBody(request) {
  return validJsonBody(request, 256) && request.body.confirm === "DELETE";
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
    const user = await verifyAccessToken(accessToken);
    if (!user || !user.id) return json(response, 401, { ok: false, error: "unauthorized" });
    if (!hasRecentAuthentication(accessToken, user)) return json(response, 401, { ok: false, error: "reauth_required" });
    // Database foreign keys perform cleanup in the Auth deletion transaction.
    // Never pre-delete rows: any constraint/storage failure must roll back all data.
    await deleteAuthUser(user.id);
    return json(response, 200, { ok: true, deleted: true });
  } catch (error) {
    return json(response, 502, { ok: false, error: "account_deletion_failed" });
  }
};

module.exports = require("./_lib/provider-budget").withProviderBudget(module.exports);
