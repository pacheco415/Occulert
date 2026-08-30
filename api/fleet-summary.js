// GET /api/fleet-summary -> live roster, recent sessions, and privacy-limited
// events for the authenticated fleet manager's server-owned fleet.
// Returns 501 when the required Supabase environment is not configured.

const supabaseLib = require("./_lib/supabase");
const pgFetch = supabaseLib.pgFetch;
const verifyAccessToken = supabaseLib.verifyAccessToken;
const bearerToken = supabaseLib.bearerToken;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(response, status, body) {
response.statusCode = status;
response.setHeader("Content-Type", "application/json; charset=utf-8");
response.setHeader("Cache-Control", "no-store");
response.end(JSON.stringify(body));
}

function shouldIncludeEvents(request) {
let value = request.query && request.query.include_events;
if (Array.isArray(value)) value = value[0];
if (value === undefined && request.url) {
try {
value = new URL(request.url, "https://www.occulert.com").searchParams.get("include_events");
} catch (error) {}
}
return value !== "0" && value !== "false";
}

module.exports = async function handler(request, response) {
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
return json(response, 501, {
ok: false,
error: "backend_not_configured",
message: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable the fleet dashboard API. See BACKEND_SETUP.md.",
});
}

if (request.method !== "GET") {
response.setHeader("Allow", "GET");
return json(response, 405, { ok: false, error: "method_not_allowed" });
}

const user = await verifyAccessToken(bearerToken(request));
if (!user) {
return json(response, 401, { ok: false, error: "unauthorized" });
}

try {
const requestStartedAt = Date.now();
const fleets = await pgFetch("fleets", {
params: { select: "id,company_name,plan", owner_user_id: "eq." + user.id, limit: "1" },
});
const fleet = fleets[0];
if (!fleet) {
return json(response, 403, { ok: false, error: "fleet_not_found" });
}
const fleetLookupMs = Date.now() - requestStartedAt;

const rosterStartedAt = Date.now();
const rosterResults = await Promise.all([pgFetch("drivers", {
params: { select: "id,name,active,vehicle_id", fleet_id: "eq." + fleet.id },
}), pgFetch("sessions", {
params: {
select: "id,driver_id,started_at,ended_at,average_fatigue,max_fatigue,safety_score,alert_count,head_nod_count",
fleet_id: "eq." + fleet.id,
order: "started_at.desc",
limit: "50",
},
})]);
const drivers = rosterResults[0];
const sessions = rosterResults[1];
const rosterLookupMs = Date.now() - rosterStartedAt;

const includeEvents = shouldIncludeEvents(request);
const sessionIds = sessions
.map(function (session) { return String(session.id || ""); })
.filter(function (id) { return UUID_PATTERN.test(id); });
let events = [];
const eventsStartedAt = Date.now();
if (includeEvents && sessionIds.length) {
const eventRows = await pgFetch("events", {
params: {
select: "id,session_id,type,fatigue_score,confidence,created_at",
session_id: "in.(" + sessionIds.join(",") + ")",
order: "created_at.desc",
limit: "200",
},
});
events = eventRows.map(function (event) {
return {
id: event.id,
session_id: event.session_id,
type: String(event.type || "").slice(0, 40),
fatigue_score: event.fatigue_score,
confidence: event.confidence,
created_at: event.created_at,
};
});
}
const eventsLookupMs = Date.now() - eventsStartedAt;

response.setHeader("Server-Timing", [
"fleet;dur=" + fleetLookupMs,
"roster;dur=" + rosterLookupMs,
"events;dur=" + eventsLookupMs,
].join(", "));

return json(response, 200, {
ok: true,
fleet: fleet,
drivers: drivers,
sessions: sessions,
events: events,
events_included: includeEvents,
telemetry_trust: "unverified_client_report",
privacy: {
includes_location: false,
includes_personal_media: false,
includes_raw_motion: false,
},
});
} catch (error) {
return json(response, 502, { ok: false, error: "supabase_error" });
}
};
