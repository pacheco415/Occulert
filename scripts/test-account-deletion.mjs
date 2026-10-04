import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const libPath = require.resolve("../api/_lib/supabase.js");
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

const calls = [];
const makeToken = claims => 'header.' + Buffer.from(JSON.stringify({ sub: 'user-1', role: 'authenticated', session_id: '11111111-1111-4111-8111-111111111111', ...claims })).toString('base64url') + '.signature';
let validToken = makeToken({ amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] });
let deletedUser = null;
let authFailure = false;
let deleteFailure = false;
const handlerPath = require.resolve("../api/account.js");
delete require.cache[handlerPath];
require.cache[libPath] = {
  id: libPath,
  filename: libPath,
  loaded: true,
  exports: {
    bearerToken: (request) => String(request.headers.authorization || "").replace(/^Bearer\s+/i, ""),
    verifyAccessToken: async (token) => {
      if (authFailure) throw new Error("auth unavailable");
      return token === validToken ? { id: "user-1", email: "driver@example.com", last_sign_in_at: new Date().toISOString() } : null;
    },
    deleteAuthUser: async (id) => {
      if (deleteFailure) throw new Error("database or Storage constraint");
      deletedUser = id; calls.push(["auth", id]);
    },
    pgFetch: async (table, options = {}) => {
      throw new Error("Account deletion must never pre-delete application data");
    },
  },
};
const handler = require("../api/account.js");

function request(body, token = validToken) {
  return { method: "DELETE", body, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } };
}

async function invoke(req) {
  const result = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(value) { this.body = value ? JSON.parse(value) : null; } };
  await handler(req, result);
  return result;
}

let result = await invoke(request({ confirm: "delete" }));
assert.equal(result.statusCode, 400);
assert.equal(result.body.error, "confirmation_required");
assert.equal(calls.length, 0);

result = await invoke(request({ confirm: "DELETE", user_id: "someone-else" }));
assert.equal(result.statusCode, 200);
assert.equal(result.body.deleted, true);
assert.equal(deletedUser, "user-1");
assert.deepEqual(calls, [["auth", "user-1"]], "Only the verified identity may be deleted, in one transaction");

result = await invoke(request({ confirm: "DELETE" }, "bad-token"));
assert.equal(result.statusCode, 401);
assert.equal(calls.length, 1);
authFailure = true;
result = await invoke(request({ confirm: "DELETE" }));
assert.equal(result.statusCode, 502);
authFailure = false;
deleteFailure = true;
result = await invoke(request({ confirm: "DELETE" }));
assert.equal(result.statusCode, 502);
assert.equal(result.body.deleted, undefined);
assert.equal(calls.length, 1);
deleteFailure = false;
result = await invoke({ ...request({ confirm: "DELETE" }), method: "GET" });
assert.equal(result.statusCode, 405);
assert.equal(result.headers.Allow, "DELETE");
result = await invoke({ ...request({ confirm: "DELETE" }), headers: { "content-type": "text/plain" } });
assert.equal(result.statusCode, 400);
assert.equal(result.headers["Cache-Control"], "no-store");

// A different recent sign-in on the user object must not refresh this token's proof.
for (const claims of [
  { amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 601 }] },
  { amr: [{ method: 'token_refresh', timestamp: Math.floor(Date.now() / 1000) }] },
  { amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) + 60 }] },
  { amr: [{ method: 'anonymous', timestamp: Math.floor(Date.now() / 1000) }] },
  { amr: [] },
  { iat: Math.floor(Date.now()/1000), amr: [{ method: 'token_refresh', timestamp: Math.floor(Date.now()/1000) }, { method: 'password', timestamp: Math.floor(Date.now()/1000)-3600 }] },
  { session_id: ['11111111-1111-4111-8111-111111111111'], amr: [{ method: 'password', timestamp: Math.floor(Date.now()/1000) }] },
  { sub: 'other-user', amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] },
]) {
  validToken = makeToken(claims);
  const before = calls.length;
  result = await invoke(request({ confirm: 'DELETE' }));
  assert.equal(result.statusCode, 401);
  assert.equal(result.body.error, 'reauth_required');
  assert.equal(calls.length, before);
}
validToken = makeToken({ amr: [{ method: 'passkey', timestamp: Math.floor(Date.now() / 1000) }] });
result = await invoke(request({ confirm: 'DELETE' }));
assert.equal(result.statusCode, 200);
console.log("Occulert account deletion tests passed.");

const { hasRecentAuthentication } = require('../api/_lib/recent-auth.js');
assert.equal(hasRecentAuthentication(makeToken({ amr: [{ method: 'password', timestamp: 1000 }] }), { id: 'user-1' }, 1600), true);
assert.equal(hasRecentAuthentication(makeToken({ amr: [{ method: 'password', timestamp: 1000 }] }), { id: 'user-1' }, 1601), false);
assert.equal(hasRecentAuthentication('malformed', { id: 'user-1' }), false);
