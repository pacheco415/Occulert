// POST /api/events -> log a single drowsiness/distraction event tied to a session.
// Requires a Supabase Auth access token in the Authorization: Bearer header.
// This endpoint is scaffolding: it returns 501 until SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are configured. See BACKEND_SETUP.md.

const supabaseLib = require("./_lib/supabase");
const pgFetch = supabaseLib.pgFetch;
const verifyAccessToken = supabaseLib.verifyAccessToken;
const bearerToken = supabaseLib.bearerToken;

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

const ALLOWED_TYPES = ["drowsy", "distracted", "head_nod", "yawn", "phone_use", "ok_check_in", "emergency"];

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

  const body = typeof request.body === "object" && request.body ? request.body : {};
  const type = String(body.type || "");
  if (!body.session_id || ALLOWED_TYPES.indexOf(type) === -1) {
    return json(response, 400, { ok: false, error: "invalid_event" });
  }

  try {
    const created = await pgFetch("events", {
      method: "POST",
      body: {
        session_id: body.session_id,
        type: type,
        fatigue_score: body.fatigue_score != null ? body.fatigue_score : null,
        confidence: body.confidence != null ? body.confidence : null,
        // GPS is opt-in only; omit lat/lng entirely unless the driver has
        // explicitly enabled location sharing on the client.
        latitude: body.latitude != null ? body.latitude : null,
        longitude: body.longitude != null ? body.longitude : null,
        created_at: new Date().toISOString(),
      },
    });
    return json(response, 200, { ok: true, event: created[0] });
  } catch (error) {
    return json(response, 502, { ok: false, error: "supabase_error", details: error.details || null });
  }
};
