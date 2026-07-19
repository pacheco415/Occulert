// GET /api/fleets  -> return the authenticated manager's fleet.
// POST /api/fleets -> create one fleet owned by the authenticated manager.
//
// Ownership always comes from the verified Supabase user. Browser-provided
// owner IDs, plans, and roles are intentionally ignored.

const supabaseLib = require("./_lib/supabase");
const pgFetch = supabaseLib.pgFetch;
const verifyAccessToken = supabaseLib.verifyAccessToken;
const bearerToken = supabaseLib.bearerToken;
const MAX_BODY_LENGTH = 2048;

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function clean(value, max) {
  return String(value || "").replace(/\0/g, "").trim().slice(0, max);
}

function validBody(request) {
  if (!String(request.headers["content-type"] || "").toLowerCase().includes("application/json")) return false;
  const body = typeof request.body === "object" && request.body ? request.body : {};
  return !Array.isArray(body) && JSON.stringify(body).length <= MAX_BODY_LENGTH;
}

function emailVerified(user) {
  return Boolean(user && user.email && (user.email_confirmed_at || user.confirmed_at));
}

async function ownedFleet(userId) {
  const rows = await pgFetch("fleets", {
    params: { select: "id,company_name,plan,created_at", owner_user_id: "eq." + userId, limit: "1" },
  });
  return rows[0] || null;
}

module.exports = async function handler(request, response) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(response, 501, { ok: false, error: "backend_not_configured" });
  }

  if (request.method !== "GET" && request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    return json(response, 405, { ok: false, error: "method_not_allowed" });
  }

  const user = await verifyAccessToken(bearerToken(request));
  if (!user) return json(response, 401, { ok: false, error: "unauthorized" });
  if (request.method === "POST" && !emailVerified(user)) {
    return json(response, 403, { ok: false, error: "email_not_verified" });
  }

  try {
    const existing = await ownedFleet(user.id);
    if (request.method === "GET") {
      if (!existing) return json(response, 404, { ok: false, error: "fleet_not_found" });
      return json(response, 200, { ok: true, fleet: existing });
    }

    if (!validBody(request)) return json(response, 415, { ok: false, error: "invalid_json_body" });
    if (existing) return json(response, 200, { ok: true, created: false, fleet: existing });

    const companyName = clean(request.body && request.body.company_name, 160);
    if (companyName.length < 2) return json(response, 400, { ok: false, error: "invalid_company_name" });

    const rows = await pgFetch("fleets", {
      method: "POST",
      body: { company_name: companyName, owner_user_id: user.id, plan: "trial" },
    });
    if (!rows.length) return json(response, 502, { ok: false, error: "fleet_not_saved" });
    return json(response, 201, { ok: true, created: true, fleet: rows[0] });
  } catch (error) {
    if (error && error.details && error.details.code === "23505") {
      try {
        const fleet = await ownedFleet(user.id);
        if (fleet) return json(response, 200, { ok: true, created: false, fleet: fleet });
      } catch (_) {}
    }
    return json(response, 502, { ok: false, error: "supabase_error" });
  }
};
