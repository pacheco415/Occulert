import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const libPath = require.resolve("../api/_lib/supabase.js");
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

const calls = [];
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
      return token === "valid-token" ? { id: "user-1", email: "driver@example.com" } : null;
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

function request(body, token = "valid-token") {
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

console.log("Occulert account deletion tests passed.");
