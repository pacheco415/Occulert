// POST /api/sessions  -> start a new driving session for the authenticated driver
// PATCH /api/sessions -> end an existing session and record final scores
// DELETE /api/sessions -> remove an interrupted, unfinished session for the authenticated driver
//
// Requires a Supabase Auth access token in the Authorization: Bearer header.
// This endpoint is scaffolding: it returns 501 until SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are configured. See BACKEND_SETUP.md.

const supabaseLib = require("./_lib/supabase");
const pgFetch = supabaseLib.pgFetch;
const verifyAccessToken = supabaseLib.verifyAccessToken;
const bearerToken = supabaseLib.bearerToken;
const telemetry = require("./_lib/client-telemetry");
const MAX_BODY_LENGTH = 4096;

function json(response, status, body) {
response.statusCode = status;
response.setHeader("Content-Type", "application/json; charset=utf-8");
response.setHeader("Cache-Control", "no-store");
response.end(JSON.stringify(body));
}

function numberOrNull(value, min, max) {
if (value === null || value === undefined || typeof value === "boolean" || typeof value === "object") return null;
if (typeof value === "string" && !value.trim()) return null;
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

const PUBLIC_SESSION_FIELDS = [
"id", "driver_id", "fleet_id", "started_at", "ended_at",
"average_fatigue", "max_fatigue", "safety_score", "alert_count",
"head_nod_count", "device", "browser",
];
function publicSession(row) {
const result = {};
for (const field of PUBLIC_SESSION_FIELDS) {
if (row && Object.prototype.hasOwnProperty.call(row, field)) result[field] = row[field];
}
return result;
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

if ((request.method === "POST" || request.method === "PATCH" || request.method === "DELETE") && !validBody(request)) {
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

if (request.method === "DELETE") {
const body = typeof request.body === "object" && request.body ? request.body : {};
if (!telemetry.validId(body.session_id)) {
return json(response, 400, { ok: false, error: "invalid_session_id" });
}
if (request.occulertSyncVersion === 1) {
const rows = await pgFetch("rpc/cancel_session_sync_v1", {
method: "POST",
body: { p_session_id: body.session_id, p_driver_id: driver.id },
});
const result = Array.isArray(rows) ? rows[0] : rows;
if (!result || result.cancellation_recorded !== true) {
return json(response, 502, { ok: false, error: "session_cancel_not_recorded" });
}
return json(response, 200, {
ok: true,
deleted: result.deleted === true,
cancellation_recorded: true,
});
}
const deleted = await pgFetch("sessions", {
method: "DELETE",
params: {
id: "eq." + body.session_id,
driver_id: "eq." + driver.id,
ended_at: "is.null",
},
});
return json(response, 200, { ok: true, deleted: deleted.length > 0 });
}

if (request.method === "POST") {
const body = typeof request.body === "object" && request.body ? request.body : {};
const clientId = body.client_session_id;
const startedAt = clientId ? telemetry.timestamp(body.started_at) : new Date().toISOString();
if (clientId !== undefined && (!telemetry.validId(clientId) || !startedAt)) {
return json(response, 400, { ok: false, error: "invalid_client_session" });
}
if (request.occulertSyncVersion === 1) {
if (!clientId) return json(response, 400, { ok: false, error: "missing_client_session_id" });
if (!telemetry.validId(body.cancel_token)) return json(response, 400, { ok: false, error: "missing_cancel_token" });
const rows = await pgFetch("rpc/start_session_sync_v1", {
method: "POST",
body: {
p_session_id: clientId,
p_driver_id: driver.id,
p_fleet_sync_token: telemetry.validId(body.fleet_sync_token) ? body.fleet_sync_token : null,
p_cancel_token: body.cancel_token,
p_started_at: startedAt,
p_device: body.device ? String(body.device).slice(0, 120) : null,
p_browser: body.browser ? String(body.browser).slice(0, 240) : null,
},
});
const result = Array.isArray(rows) ? rows[0] : rows;
if (result && result.cancelled === true) {
return json(response, 410, { ok: false, error: "session_start_cancelled" });
}
if (!result || result.conflict === true || !result.session) {
return json(response, 409, { ok: false, error: "session_id_conflict" });
}
return json(response, 200, { ok: true, session: publicSession(result.session) });
}
// Browser starts are observed directly by this request. Client-timestamp
// writes on the unversioned route stay owner-only; durable native uploads use
// the transactionally validated versioned route above.
const sessionFleetId = clientId === undefined ? driver.fleet_id : null;
const created = await telemetry.insertOnce(pgFetch, "sessions", {
...(clientId ? { id: clientId } : {}),
driver_id: driver.id,
fleet_id: sessionFleetId,
started_at: startedAt,
device: body.device ? String(body.device).slice(0, 120) : null,
browser: body.browser ? String(body.browser).slice(0, 240) : null,
}, { driver_id: "eq." + driver.id });
return json(response, 200, { ok: true, session: publicSession(created[0]) });
}

if (request.method === "PATCH") {
const body = typeof request.body === "object" && request.body ? request.body : {};
if (!telemetry.validId(body.session_id)) {
return json(response, 400, { ok: false, error: "invalid_session_id" });
}
const endedAt = body.ended_at === undefined ? new Date().toISOString() : telemetry.timestamp(body.ended_at);
if (!endedAt) return json(response, 400, { ok: false, error: "invalid_end_time" });
if (body.ended_at !== undefined) {
const existing = await pgFetch("sessions", { params: { select: "*", id: "eq." + body.session_id, driver_id: "eq." + driver.id, limit: "1" } });
if (!existing.length) return json(response, 404, { ok: false, error: "session_not_found" });
if (Date.parse(endedAt) < Date.parse(existing[0].started_at)) return json(response, 400, { ok: false, error: "invalid_end_time" });
if (existing[0].ended_at) return json(response, 200, { ok: true, session: publicSession(existing[0]) });
}
const updated = await pgFetch("sessions", {
method: "PATCH",
params: { id: "eq." + body.session_id, driver_id: "eq." + driver.id, ...(body.ended_at !== undefined ? { ended_at: "is.null" } : {}) },
body: {
ended_at: endedAt,
average_fatigue: numberOrNull(body.average_fatigue, 0, 100),
max_fatigue: numberOrNull(body.max_fatigue, 0, 100),
safety_score: numberOrNull(body.safety_score, 0, 100),
alert_count: numberOrNull(body.alert_count, 0, 10000),
head_nod_count: numberOrNull(body.head_nod_count, 0, 10000),
},
});
if (!updated.length && body.ended_at !== undefined) {
const existing = await pgFetch("sessions", { params: { select: "*", id: "eq." + body.session_id, driver_id: "eq." + driver.id, limit: "1" } });
if (existing[0]?.ended_at) return json(response, 200, { ok: true, session: publicSession(existing[0]) });
}
if (!updated.length) {
return json(response, 404, { ok: false, error: "session_not_found" });
}
return json(response, 200, { ok: true, session: publicSession(updated[0]) });
}

response.setHeader("Allow", "POST, PATCH, DELETE");
return json(response, 405, { ok: false, error: "method_not_allowed" });
} catch (error) {
return json(response, 502, { ok: false, error: "supabase_error" });
}
};
