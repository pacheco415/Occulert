// POST /api/profile -> create or update the authenticated user's driver row.
// Fleet membership is deliberately not accepted from the browser. A future
// invitation/admin flow must perform that privileged assignment.

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
  if (!validBody(request)) return json(response, 415, { ok: false, error: "invalid_json_body" });

  const body = request.body || {};
  const email = clean(user.email, 240).toLowerCase();
  const name = clean(body.name, 160) || email.split("@")[0] || "Occulert Driver";
  const vehicleId = clean(body.vehicle, 120) || null;

  try {
    const existing = await pgFetch("drivers", {
      params: { select: "id,user_id,name,email,vehicle_id,fleet_id,active", user_id: "eq." + user.id, limit: "1" },
    });
    const values = { name, email: email || null, vehicle_id: vehicleId, active: true };
    let rows;

    if (existing.length) {
      rows = await pgFetch("drivers", {
        method: "PATCH",
        params: { id: "eq." + existing[0].id, user_id: "eq." + user.id },
        body: values,
      });
    } else {
      rows = await pgFetch("drivers", {
        method: "POST",
        body: Object.assign({ user_id: user.id, fleet_id: null }, values),
      });
    }

    if (!rows.length) return json(response, 502, { ok: false, error: "profile_not_saved" });
    return json(response, 200, { ok: true, driver: rows[0] });
  } catch {
    return json(response, 502, { ok: false, error: "supabase_error" });
  }
};
