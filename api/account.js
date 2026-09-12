// DELETE /api/account -> permanently delete the authenticated Occulert account.
// The service-role key is used only on the server after the bearer token has
// been verified. The browser must send { confirm: "DELETE" } deliberately.

const supabaseLib = require("./_lib/supabase");
const verifyAccessToken = supabaseLib.verifyAccessToken;
const deleteAuthUser = supabaseLib.deleteAuthUser;
const bearerToken = supabaseLib.bearerToken;

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function validBody(request) {
  if (!String(request.headers["content-type"] || "").toLowerCase().includes("application/json")) return false;
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body : {};
  return JSON.stringify(body).length <= 256 && body.confirm === "DELETE";
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
    const user = await verifyAccessToken(bearerToken(request));
    if (!user || !user.id) return json(response, 401, { ok: false, error: "unauthorized" });
    // Database foreign keys perform cleanup in the Auth deletion transaction.
    // Never pre-delete rows: any constraint/storage failure must roll back all data.
    await deleteAuthUser(user.id);
    return json(response, 200, { ok: true, deleted: true });
  } catch (error) {
    return json(response, 502, { ok: false, error: "account_deletion_failed" });
  }
};
