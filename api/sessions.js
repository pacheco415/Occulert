// POST /api/sessions  -> start a new driving session for the authenticated driver
// PATCH /api/sessions -> end an existing session and record final scores
//
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

module.exports = async function handler(request, response) {
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
return json(response, 501, {
ok: false,
error: "backend_not_configured",
message: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable session storage. See BACKEND_SETUP.md.",
});
}

const user = await verifyAccessToken(bearerToken(request));
if (!user) {
return json(response, 401, { ok: false, error: "unauthorized" });
}

try {
if (request.method === "POST") {
const body = typeof request.body === "object" && request.body ? request.body : {};
const drivers = await pgFetch("drivers", {
params: { select: "id,fleet_id", user_id: "eq." + user.id, limit: "1" },
});
const driver = drivers[0];
if (!driver) {
return json(response, 403, { ok: false, error: "driver_profile_not_found" });
}

const created = await pgFetch("sessions", {
method: "POST",
body: {
driver_id: driver.id,
fleet_id: driver.fleet_id,
started_at: new Date().toISOString(),
device: body.device || null,
browser: body.browser || null,
},
});
return json(response, 200, { ok: true, session: created[0] });
}

if (request.method === "PATCH") {
const body = typeof request.body === "object" && request.body ? request.body : {};
if (!body.session_id) {
return json(response, 400, { ok: false, error: "missing_session_id" });
}
const updated = await pgFetch("sessions", {
method: "PATCH",
params: { id: "eq." + body.session_id },
body: {
ended_at: new Date().toISOString(),
average_fatigue: body.average_fatigue != null ? body.average_fatigue : null,
max_fatigue: body.max_fatigue != null ? body.max_fatigue : null,
safety_score: body.safety_score != null ? body.safety_score : null,
alert_count: body.alert_count != null ? body.alert_count : null,
head_nod_count: body.head_nod_count != null ? body.head_nod_count : null,
},
});
return json(response, 200, { ok: true, session: updated[0] });
}

response.setHeader("Allow", "POST, PATCH");
return json(response, 405, { ok: false, error: "method_not_allowed" });
} catch (error) {
return json(response, 502, { ok: false, error: "supabase_error", details: error.details || null });
}
};
