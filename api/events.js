// POST /api/events -> log a single drowsiness/distraction event tied to a session.
// Requires a Supabase Auth access token in the Authorization: Bearer header.
// This endpoint is scaffolding: it returns 501 until SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are configured. See BACKEND_SETUP.md.

const supabaseLib = require("./_lib/supabase");
const pgFetch = supabaseLib.pgFetch;
const verifyAccessToken = supabaseLib.verifyAccessToken;
const bearerToken = supabaseLib.bearerToken;
const MAX_BODY_LENGTH = 4096;

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

const ALLOWED_TYPES = ["drowsy", "distracted", "head_nod", "yawn", "phone_use", "ok_check_in", "emergency"];

function numberOrNull(value, min, max) {
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "object") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

function validJsonBody(request) {
  if (!String(request.headers["content-type"] || "").toLowerCase().includes("application/json")) return false;
  const body = typeof request.body === "object" && request.body ? request.body : {};
  return !Array.isArray(body) && JSON.stringify(body).length <= MAX_BODY_LENGTH;
}

module.exports = async function handler(request, response) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(response, 501, {
      ok: false,
      error: "backend_not_configured",
      message: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable event storage. See BACKEND_SETUP.md.",
    });
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return json(response, 405, { ok: false, error: "method_not_allowed" });
  }

  const user = await verifyAccessToken(bearerToken(request));
  if (!user) {
    return json(response, 401, { ok: false, error: "unauthorized" });
  }

  if (!validJsonBody(request)) {
    return json(response, 415, { ok: false, error: "invalid_json_body" });
  }

  const body = typeof request.body === "object" && request.body ? request.body : {};
  const type = String(body.type || "");
  if (!body.session_id || ALLOWED_TYPES.indexOf(type) === -1) {
    return json(response, 400, { ok: false, error: "invalid_event" });
  }

  try {
    const drivers = await pgFetch("drivers", {
      params: { select: "id", user_id: "eq." + user.id, limit: "1" },
    });
    const driver = drivers[0];
    if (!driver) {
      return json(response, 403, { ok: false, error: "driver_profile_not_found" });
    }

    const sessions = await pgFetch("sessions", {
      params: { select: "id", id: "eq." + body.session_id, driver_id: "eq." + driver.id, limit: "1" },
    });
    if (!sessions.length) {
      return json(response, 404, { ok: false, error: "session_not_found" });
    }

    const created = await pgFetch("events", {
      method: "POST",
      body: {
        session_id: body.session_id,
        type: type,
        fatigue_score: numberOrNull(body.fatigue_score, 0, 100),
        confidence: numberOrNull(body.confidence, 0, 100),
        // GPS is opt-in only; omit lat/lng entirely unless the driver has
        // explicitly enabled location sharing on the client.
        latitude: numberOrNull(body.latitude, -90, 90),
        longitude: numberOrNull(body.longitude, -180, 180),
        created_at: new Date().toISOString(),
      },
    });
    return json(response, 200, { ok: true, event: created[0] });
  } catch (error) {
    return json(response, 502, { ok: false, error: "supabase_error" });
  }
};
