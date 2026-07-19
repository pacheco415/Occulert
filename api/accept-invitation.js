// POST /api/accept-invitation -> atomically attach the authenticated driver to
// the invited fleet. The verified account email must match the invitation.

const crypto = require("node:crypto");
const supabaseLib = require("./_lib/supabase");
const pgFetch = supabaseLib.pgFetch;
const verifyAccessToken = supabaseLib.verifyAccessToken;
const bearerToken = supabaseLib.bearerToken;
const MAX_BODY_LENGTH = 1024;

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function validBody(request) {
  if (!String(request.headers["content-type"] || "").toLowerCase().includes("application/json")) return false;
  const body = typeof request.body === "object" && request.body ? request.body : {};
  return !Array.isArray(body) && JSON.stringify(body).length <= MAX_BODY_LENGTH;
}

function knownDatabaseError(error) {
  const message = String(error && error.details && error.details.message || "");
  return [
    "invalid_invitation",
    "invitation_already_used",
    "invitation_revoked",
    "invitation_expired",
    "invitation_email_mismatch",
    "driver_profile_required",
    "driver_already_assigned",
  ].includes(message) ? message : "";
}

module.exports = async function handler(request, response) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(response, 501, { ok: false, error: "backend_not_configured" });
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return json(response, 405, { ok: false, error: "method_not_allowed" });
  }

  const user = await verifyAccessToken(bearerToken(request));
  if (!user) return json(response, 401, { ok: false, error: "unauthorized" });
  if (!user.email || !(user.email_confirmed_at || user.confirmed_at)) {
    return json(response, 403, { ok: false, error: "email_not_verified" });
  }
  if (!validBody(request)) return json(response, 415, { ok: false, error: "invalid_json_body" });

  const token = String(request.body && request.body.token || "").trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    return json(response, 400, { ok: false, error: "invalid_invitation" });
  }
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  try {
    const rows = await pgFetch("rpc/accept_fleet_invitation", {
      method: "POST",
      body: {
        p_token_hash: tokenHash,
        p_user_id: user.id,
        p_user_email: String(user.email).trim().toLowerCase(),
      },
    });
    const result = Array.isArray(rows) ? rows[0] : rows;
    if (!result || !result.fleet_id) return json(response, 502, { ok: false, error: "invitation_not_accepted" });
    return json(response, 200, { ok: true, fleet: result });
  } catch (error) {
    const known = knownDatabaseError(error);
    if (known) {
      const status = known === "invitation_email_mismatch" || known === "driver_already_assigned" ? 403
        : known === "driver_profile_required" ? 409
        : known === "invalid_invitation" ? 404 : 410;
      return json(response, status, { ok: false, error: known });
    }
    return json(response, 502, { ok: false, error: "supabase_error" });
  }
};
