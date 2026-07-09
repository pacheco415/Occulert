// Shared Supabase REST helpers for Occulert backend endpoints.
//
// This project intentionally avoids the @supabase/supabase-js SDK to keep
// zero npm dependencies (matching api/pilot-leads.js). All calls go straight
// to Supabase's auto-generated PostgREST API and GoTrue auth API over fetch.
//
// Required environment variables (set these in Vercel project settings,
// NEVER commit real values):
//   SUPABASE_URL              e.g. https://xxxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY service_role key (server-side only, full access)
//
// These do not exist yet until a Supabase project is created. See
// BACKEND_SETUP.md for the exact setup steps.

function requireEnv(name) {
const value = process.env[name];
if (!value) {
throw new Error("missing_env_" + name);
}
return value;
}

function supabaseUrl() {
return requireEnv("SUPABASE_URL").replace(/\/+$/, "");
}

function serviceHeaders() {
const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
return {
apikey: key,
Authorization: "Bearer " + key,
"Content-Type": "application/json",
};
}

// Minimal PostgREST query helper. `table` is the table name, `params` is a
// plain object of PostgREST query params, e.g. { select: "*", id: "eq.123" }.
async function pgFetch(table, options) {
const opts = options || {};
const method = opts.method || "GET";
const params = opts.params || {};
const body = opts.body;

const url = new URL(supabaseUrl() + "/rest/v1/" + table);
for (const key of Object.keys(params)) {
url.searchParams.set(key, params[key]);
}

const response = await fetch(url, {
method: method,
headers: Object.assign({}, serviceHeaders(), { Prefer: "return=representation" }),
body: body !== undefined ? JSON.stringify(body) : undefined,
});

const text = await response.text();
const data = text ? JSON.parse(text) : null;
if (!response.ok) {
const error = new Error("supabase_request_failed");
error.status = response.status;
error.details = data;
throw error;
}
return data;
}

// Verifies a driver/fleet-manager access token (issued by Supabase Auth on
// the client) and returns the Supabase user object, or null if invalid.
async function verifyAccessToken(accessToken) {
if (!accessToken) return null;
const response = await fetch(supabaseUrl() + "/auth/v1/user", {
headers: {
apikey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
Authorization: "Bearer " + accessToken,
},
});
if (!response.ok) return null;
return response.json();
}

function bearerToken(request) {
const header = request.headers.authorization || "";
const match = /^Bearer\s+(.+)$/i.exec(header);
return match ? match[1] : null;
}

module.exports = { pgFetch: pgFetch, verifyAccessToken: verifyAccessToken, bearerToken: bearerToken };
