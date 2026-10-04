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
const { isUuid, numberOrNull, integerOrNull, validJsonBody } = require("./_lib/validation");
const PIPELINES = new Set(["web_mediapipe_ear", "ios_mlkit_eye_probability", "android_mlkit_eye_probability"]);

const { json } = require("./_lib/responses");

function provenanceText(value, maxLength) {
if (typeof value !== "string") return null;
const text = value.trim();
return text && text.length <= maxLength && /^[a-zA-Z0-9._() -]+$/.test(text) ? text : null;
}

module.exports = async function handler(request, response) {
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
return json(response, 501, {
ok: false,
error: "backend_not_configured",
message: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable session storage. See BACKEND_SETUP.md.",
});
}

let user;
try {
  user = await verifyAccessToken(bearerToken(request), { cachedIdentity: true });
  if (!user) {
  return json(response, 401, { ok: false, error: "unauthorized" });
  }

  if ((request.method === "POST" || request.method === "PATCH") && !validJsonBody(request)) {
  return json(response, 415, { ok: false, error: "invalid_json_body" });
  }
if (request.method === "GET" && !isUuid(request.query?.session_id)) {
return json(response, 400, { ok: false, error: "invalid_session_id" });
}
const drivers = await pgFetch("drivers", {
params: { select: "id,fleet_id", user_id: "eq." + user.id, limit: "1" },
});
const driver = drivers[0];
if (!driver) {
return json(response, 403, { ok: false, error: "driver_profile_not_found" });
}

if (request.method === "GET") {
// Recover an uncertain start by reading only. Never create a replacement.
const stored = await pgFetch("sessions", { params: { id: "eq." + request.query.session_id, driver_id: "eq." + driver.id, select: "*", limit: "1" } });
return json(response, 200, { ok: true, session: stored[0] || null, session_start_protocol: "client_uuid_v1", session_lookup_protocol: "client_uuid_lookup_v1" });
}

if (request.method === "POST") {
const body = typeof request.body === "object" && request.body ? request.body : {};
const hasClientId = Object.prototype.hasOwnProperty.call(body, "session_id");
if (hasClientId && !isUuid(body.session_id)) {
return json(response, 400, { ok: false, error: "invalid_session_id" });
}
const ownedStartParams = hasClientId ? { id: "eq." + body.session_id, driver_id: "eq." + driver.id, select: "*", limit: "1" } : null;
if (ownedStartParams) {
const stored = await pgFetch("sessions", { params: ownedStartParams });
if (stored[0]) return json(response, 200, { ok: true, session: stored[0], session_start_protocol: "client_uuid_v1" });
}
let created;
try {
created = await pgFetch("sessions", {
method: "POST",
body: {
...(hasClientId ? { id: body.session_id } : {}),
driver_id: driver.id,
fleet_id: driver.fleet_id,
started_at: new Date().toISOString(),
device: body.device ? String(body.device).slice(0, 120) : null,
browser: body.browser ? String(body.browser).slice(0, 240) : null,
detector_pipeline: PIPELINES.has(body.detector_pipeline) ? body.detector_pipeline : null,
detector_version: provenanceText(body.detector_version, 80),
app_version: provenanceText(body.app_version, 80),
},
});
} catch (error) {
if (!hasClientId || error?.details?.code !== "23505") throw error;
// A concurrent retry may have inserted the UUID after the first read. Only
// return a row belonging to the verified driver; never upsert another owner.
const stored = await pgFetch("sessions", { params: ownedStartParams });
if (stored[0]) return json(response, 200, { ok: true, session: stored[0], session_start_protocol: "client_uuid_v1" });
return json(response, 409, { ok: false, error: "session_id_conflict" });
}
return json(response, 200, { ok: true, session: created[0], session_start_protocol: "client_uuid_v1" });
}

if (request.method === "PATCH") {
const body = typeof request.body === "object" && request.body ? request.body : {};
if (!body.session_id) {
return json(response, 400, { ok: false, error: "missing_session_id" });
}
if (!isUuid(body.session_id)) return json(response, 400, { ok: false, error: "invalid_session_id" });
const ownedParams = { id: "eq." + body.session_id, driver_id: "eq." + driver.id };
const existing = await pgFetch("sessions", { params: { ...ownedParams, select: "*", limit: "1" } });
if (!existing.length) return json(response, 404, { ok: false, error: "session_not_found" });
if (existing[0].ended_at) return json(response, 200, { ok: true, session: existing[0] });
const now = Date.now();
const startedAt = Date.parse(existing[0].started_at);
const clientEnd = typeof body.ended_at === "string" && /^\d{4}-\d{2}-\d{2}T/.test(body.ended_at) ? Date.parse(body.ended_at) : NaN;
const endedAt = Number.isFinite(clientEnd) && clientEnd >= startedAt && clientEnd <= now + 120000
  ? new Date(clientEnd).toISOString() : new Date(now).toISOString();
const updated = await pgFetch("sessions", {
method: "PATCH",
params: { ...ownedParams, ended_at: "is.null" },
body: {
ended_at: endedAt,
average_fatigue: numberOrNull(body.average_fatigue, 0, 100),
max_fatigue: numberOrNull(body.max_fatigue, 0, 100),
safety_score: numberOrNull(body.safety_score, 0, 100),
alert_count: integerOrNull(body.alert_count),
head_nod_count: integerOrNull(body.head_nod_count),
},
});
if (!updated.length) {
// Another finalizer may have won after the read. Return its stored result.
const stored = await pgFetch("sessions", { params: { ...ownedParams, select: "*", limit: "1" } });
if (stored[0]?.ended_at) return json(response, 200, { ok: true, session: stored[0] });
return json(response, 404, { ok: false, error: "session_not_found" });
}
return json(response, 200, { ok: true, session: updated[0] });
}

response.setHeader("Allow", "GET, POST, PATCH");
return json(response, 405, { ok: false, error: "method_not_allowed" });
} catch (error) {
return json(response, 502, { ok: false, error: "supabase_error" });
}
};

module.exports = require("./_lib/provider-budget").withProviderBudget(module.exports);
