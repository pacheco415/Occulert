const { remainingProviderMs } = require('./provider-budget');
const { createCachedJwtVerifier, MAX_JWKS_BYTES } = require('./cached-jwks');
const verifyCachedJwt = createCachedJwtVerifier();
const MAX_REST_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_AUTH_RESPONSE_BYTES = 64 * 1024;
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
// See BACKEND_SETUP.md for configuration and deployment checks.

function supabaseError(message, status, details) {
  const error = new Error(message);
  error.provider = 'supabase';
  if (Number.isInteger(status)) error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function parseResponseJson(text, response, invalidMessage) {
  if (!text) return null;
  try { return JSON.parse(text); }
  catch {
    // Error pages often contain HTML. Preserve the HTTP status without retaining
    // that page or leaking parser snippets into diagnostics.
    if (!response.ok) return null;
    throw supabaseError(invalidMessage);
  }
}

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
    let timeoutMs;
    try { timeoutMs = remainingProviderMs(8000); }
    catch { reject(supabaseError('supabase_unavailable', 504)); return; }
    let settled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      finish(supabaseError('supabase_unavailable', 504));
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
      const oversized = () => supabaseError('supabase_response_too_large', response.ok ? undefined : response.status);
      const contentLength = response.headers?.get('content-length');
      if (maxBytes !== undefined && /^\d+$/.test(contentLength || '') && Number(contentLength) > maxBytes) {
        if (response.body?.cancel) Promise.resolve(response.body.cancel()).catch(() => {});
        controller.abort();
        throw oversized();
      }
      if (maxBytes !== undefined && response.body?.getReader) {
        const reader = response.body.getReader(), chunks = []; let total = 0, complete = false;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (controller.signal.aborted) throw supabaseError('supabase_unavailable', 504);
            if (done) { complete = true; break; }
            total += value.byteLength;
            if (total > maxBytes) throw oversized();
            chunks.push(Buffer.from(value));
          }
          text = Buffer.concat(chunks, total).toString("utf8");
        } finally {
          if (!complete) Promise.resolve(reader.cancel()).catch(() => {});
          reader.releaseLock();
        }
      } else {
        text = await response.text();
        if (maxBytes !== undefined && Buffer.byteLength(text) > maxBytes) throw oversized();
      }
      return { response, text };
    }).then(value => finish(null, value), error => finish(error?.provider === 'supabase'
      ? error : supabaseError('supabase_unavailable', 503)));
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
  }, MAX_REST_RESPONSE_BYTES);

  const data = parseResponseJson(text, response, 'supabase_invalid_response');
  if (!response.ok) {
    throw supabaseError('supabase_request_failed', response.status, data);
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
  }, MAX_AUTH_RESPONSE_BYTES);
  if ([400, 401, 403].includes(response.status)) return null;
  if (!response.ok) {
    throw supabaseError('supabase_auth_unavailable', response.status);
  }
  const user = parseResponseJson(text, response, 'supabase_auth_invalid_response');
  if (!user || typeof user.id !== "string" || !user.id) throw supabaseError('supabase_auth_invalid_response');
  return user;
}

// Deletes an Auth user with the server-only service-role key. Callers must
// verify the user's access token before invoking this helper.
async function deleteAuthUser(userId) {
  const { response, text } = await fetchTextWithDeadline(supabaseUrl() + "/auth/v1/admin/users/" + encodeURIComponent(userId), {
    method: "DELETE",
    headers: serviceHeaders(),
  }, MAX_AUTH_RESPONSE_BYTES);
  if (!response.ok) {
    throw supabaseError('supabase_auth_delete_failed', response.status);
  }
}

function bearerToken(request) {
  const header = request.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

module.exports = { pgFetch: pgFetch, verifyAccessToken: verifyAccessToken, deleteAuthUser: deleteAuthUser, bearerToken: bearerToken, serverStorageConfigured: serverStorageConfigured };
