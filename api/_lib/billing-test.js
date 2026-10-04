const { pgFetch, verifyAccessToken, bearerToken } = require("./supabase");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUSTOMER_RE = /^cus_[A-Za-z0-9]+$/;
const SUBSCRIPTION_RE = /^sub_[A-Za-z0-9]+$/;
const EVENT_RE = /^evt_[A-Za-z0-9]+$/;

const { json: sendJson } = require("./responses");
function json(response, status, body) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  return sendJson(response, status, body);
}

function methodOnly(request, response, method) {
  if (request.method === method) return false;
  response.setHeader("Allow", method);
  json(response, 405, { ok: false, error: "method_not_allowed" });
  return true;
}

function backendConfigured(response) {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return true;
  json(response, 501, { ok: false, error: "backend_not_configured" });
  return false;
}

function parseJsonBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(request.headers["content-type"] || ""))) return null;
  const body = request.body;
  if (typeof body === "string") {
    if (Buffer.byteLength(body) > 2048) return null;
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch (_) { return null; }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return Buffer.byteLength(JSON.stringify(body)) <= 2048 ? body : null;
}

async function ownerContext(request, requireVerifiedEmail) {
  const user = await verifyAccessToken(bearerToken(request));
  if (!user) {
    const error = new Error("unauthorized");
    error.status = 401;
    throw error;
  }
  if (requireVerifiedEmail && (!user.email || !(user.email_confirmed_at || user.confirmed_at))) {
    const error = new Error("email_not_verified");
    error.status = 403;
    throw error;
  }
  if (!UUID_RE.test(user.id)) throw new Error("invalid_owner_id");
  const fleets = await pgFetch("fleets", {
    params: { select: "id,owner_user_id", owner_user_id: "eq." + user.id, limit: "1" },
  });
  const fleet = fleets && fleets[0];
  if (!fleet || !UUID_RE.test(fleet.id) || fleet.owner_user_id !== user.id) {
    const error = new Error("fleet_not_found");
    error.status = 404;
    throw error;
  }
  return { user, fleet };
}

async function billingRow(fleetId) {
  const rows = await pgFetch("fleet_billing_test", {
    params: {
      select: "fleet_id,stripe_customer_id,stripe_subscription_id,plan,status,current_period_end,cancel_at_period_end,updated_at",
      fleet_id: "eq." + fleetId,
      limit: "1",
    },
  });
  return rows && rows[0] || null;
}

function replyError(response, error) {
  const safe = new Set([
    "unauthorized", "email_not_verified", "fleet_not_found", "invalid_json_body",
    "invalid_plan", "idempotency_key_required", "subscription_exists",
    "checkout_pending", "checkout_awaiting_webhook", "checkout_recovery_required",
    "billing_sync_busy",
    "billing_test_not_configured", "billing_site_origin_invalid", "customer_not_ready",
    "billing_not_started", "invalid_signature", "webhook_too_large",
  ]);
  const code = safe.has(error && error.message) ? error.message : "billing_unavailable";
  const status = error && Number.isInteger(error.status) ? error.status : 502;
  return json(response, status, { ok: false, error: code });
}

module.exports = {
  UUID_RE, CUSTOMER_RE, SUBSCRIPTION_RE, EVENT_RE,
  json, methodOnly, backendConfigured, parseJsonBody, ownerContext,
  billingRow, replyError,
};
