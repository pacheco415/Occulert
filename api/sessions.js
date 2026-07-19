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
const MAX_BODY_LENGTH = 4096;

function json(response, status, body) {
response.statusCode = status;
response.setHeader("Content-Type", "application/json; charset=utf-8");
response.setHeader("Cache-Control", "no-store");
response.end(JSON.stringify(body));
}

function numberOrNull(value, min, max) {
const n = Number(value);
if (!Number.isFinite(n)) return null;
return Math.max(min, Math.min(max, n));
}

function isJsonRequest(request) {
return String(request.headers["content-type"] || "").toLowerCase().includes("application/json");
}

function validBody(request) {
if (request.method === "GET") return true;
if (!isJsonRequest(request)) return false;
const body = typeof request.body === "object" && request.body ? request.body : {};
return !Array.isArray(body) && JSON.stringify(body).length <= MAX_BODY_LENGTH;
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

if ((request.method === "POST" || request.method === "PATCH") && !validBody(request)) {
return json(response, 415, { ok: false, error: "invalid_json_body" });
}

try {
const drivers = await pgFetch("drivers", {
params: { select: "id,fleet_id", user_id: "eq." + user.id, limit: "1" },
});
const driver = drivers[0];
if (!driver) {
return json(response, 403, { ok: false, error: "driver_profile_not_found" });
}

if (request.method === "POST") {
const body = typeof request.body === "object" && request.body ? request.body : {};
const created = await pgFetch("sessions", {
method: "POST",
body: {
driver_id: driver.id,
fleet_id: driver.fleet_id,
started_at: new Date().toISOString(),
device: body.device ? String(body.device).slice(0, 120) : null,
browser: body.browser ? String(body.browser).slice(0, 240) : null,
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
params: { id: "eq." + body.session_id, driver_id: "eq." + driver.id },
body: {
ended_at: new Date().toISOString(),
average_fatigue: numberOrNull(body.average_fatigue, 0, 100),
max_fatigue: numberOrNull(body.max_fatigue, 0, 100),
safety_score: numberOrNull(body.safety_score, 0, 100),
alert_count: numberOrNull(body.alert_count, 0, 10000),
head_nod_count: numberOrNull(body.head_nod_count, 0, 10000),
},
});
if (!updated.length) {
return json(response, 404, { ok: false, error: "session_not_found" });
}
return json(response, 200, { ok: true, session: updated[0] });
}

response.setHeader("Allow", "POST, PATCH");
return json(response, 405, { ok: false, error: "method_not_allowed" });
} catch (error) {
return json(response, 502, { ok: false, error: "supabase_error" });
}
};
