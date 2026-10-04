const { remainingProviderMs } = require('./provider-budget');
const { createCachedJwtVerifier, MAX_JWKS_BYTES } = require('./cached-jwks');
const verifyCachedJwt = createCachedJwtVerifier();
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

// Public capability checks may learn only whether storage is configured,
// never the server credential itself. This helper performs no network request.
function serverStorageConfigured() {
return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
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

// Headers and the complete body share one deadline. Do not retry mutations:
// a transport timeout does not prove that a server transaction was rolled back.
function fetchTextWithDeadline(url, options, maxBytes) {
return new Promise((resolve, reject) => {
const timeoutMs = remainingProviderMs(8000);
let settled = false;
const controller = new AbortController();
const timer = setTimeout(() => {
const error = new Error("supabase_unavailable");
error.status = 504;
finish(error);
controller.abort();
}, timeoutMs);
function finish(error, value) {
if (settled) return;
settled = true;
clearTimeout(timer);
if (error) reject(error); else resolve(value);
}
Promise.resolve().then(() => {
if (settled) return;
return fetch(url, Object.assign({}, options, { signal: controller.signal }));
}).then(async response => {
if (settled) return;
let text;
if (maxBytes !== undefined && response.body?.getReader) {
  const reader = response.body.getReader(), chunks = []; let total = 0, complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) throw new Error("supabase_unavailable");
      if (done) { complete = true; break; }
      total += value.byteLength;
      if (total > maxBytes) throw new Error("supabase_response_too_large");
      chunks.push(Buffer.from(value));
    }
    text = Buffer.concat(chunks, total).toString("utf8");
  } finally {
    if (!complete) Promise.resolve(reader.cancel()).catch(() => {});
    reader.releaseLock();
  }
} else {
  text = await response.text();
  if (maxBytes !== undefined && Buffer.byteLength(text) > maxBytes) throw new Error("supabase_response_too_large");
}
return { response, text };
}).then(value => finish(null, value), error => finish(error));
});
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

const { response, text } = await fetchTextWithDeadline(url, {
method: method,
headers: Object.assign({}, serviceHeaders(), { Prefer: "return=representation" }),
body: body !== undefined ? JSON.stringify(body) : undefined,
});

const data = text ? JSON.parse(text) : null;
if (!response.ok) {
const error = new Error("supabase_request_failed");
error.status = response.status;
error.details = data;
throw error;
}
return data;
}

// Network Auth remains the default. Only explicit id-only callers may use a
// cached asymmetric signature identity; fresh profile/email/security operations
// never downgrade after an Auth denial, outage or timeout.
async function verifyAccessToken(accessToken, options) {
if (!accessToken) return null;
if (options?.cachedIdentity === true && options?.freshUser !== true) {
  const base = supabaseUrl(), configured = new URL(base);
  if (configured.protocol !== "https:" || configured.username || configured.password
      || configured.pathname !== "/" || configured.search || configured.hash) throw new Error("invalid_supabase_origin");
  const identity = await verifyCachedJwt(accessToken, base + "/auth/v1", async () => {
    const { response, text } = await fetchTextWithDeadline(base + "/auth/v1/.well-known/jwks.json", {
      method: "GET", redirect: "error", headers: { Accept: "application/json" },
    }, MAX_JWKS_BYTES);
    if (!response.ok) throw new Error("jwks_unavailable");
    return JSON.parse(text);
  });
  // undefined means HS256 or unavailable discovery; null is a failed signature,
  // unknown key after refresh, invalid header or invalid claims. Never fall back
  // from a cryptographic/claim rejection to a more permissive identity path.
  if (identity !== undefined) return identity;
}
const { response, text } = await fetchTextWithDeadline(supabaseUrl() + "/auth/v1/user", {
headers: {
apikey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
Authorization: "Bearer " + accessToken,
},
});
if ([400, 401, 403].includes(response.status)) return null;
if (!response.ok) {
const error = new Error("supabase_auth_unavailable");
error.status = response.status;
throw error;
}
const user = JSON.parse(text);
if (!user || typeof user.id !== "string" || !user.id) throw new Error("supabase_auth_invalid_response");
return user;
}

// Deletes an Auth user with the server-only service-role key. Callers must
// verify the user's access token before invoking this helper.
async function deleteAuthUser(userId) {
const { response, text } = await fetchTextWithDeadline(supabaseUrl() + "/auth/v1/admin/users/" + encodeURIComponent(userId), {
method: "DELETE",
headers: serviceHeaders(),
});
if (!response.ok) {
const error = new Error("supabase_auth_delete_failed");
error.status = response.status;
error.details = text;
throw error;
}
}

function bearerToken(request) {
const header = request.headers.authorization || "";
const match = /^Bearer\s+(.+)$/i.exec(header);
return match ? match[1] : null;
}

module.exports = { pgFetch: pgFetch, verifyAccessToken: verifyAccessToken, deleteAuthUser: deleteAuthUser, bearerToken: bearerToken, serverStorageConfigured: serverStorageConfigured };
