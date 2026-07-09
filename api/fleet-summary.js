// GET /api/fleet-summary -> live roster + recent sessions for the
// authenticated fleet manager's fleet. Powers a future real fleet-dashboard.html
// (replacing the current localStorage-only prototype).
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
const fleets = await pgFetch("fleets", {
params: { select: "id,company_name,plan", owner_user_id: "eq." + user.id, limit: "1" },
});
const fleet = fleets[0];
if (!fleet) {
return json(response, 403, { ok: false, error: "fleet_not_found" });
}

const drivers = await pgFetch("drivers", {
params: { select: "id,name,active,vehicle_id", fleet_id: "eq." + fleet.id },
});

const sessions = await pgFetch("sessions", {
params: {
select: "id,driver_id,started_at,ended_at,safety_score,alert_count",
fleet_id: "eq." + fleet.id,
order: "started_at.desc",
limit: "50",
},
});

return json(response, 200, { ok: true, fleet: fleet, drivers: drivers, sessions: sessions });
} catch (error) {
return json(response, 502, { ok: false, error: "supabase_error", details: error.details || null });
}
};
