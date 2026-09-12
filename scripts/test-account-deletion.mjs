import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const libPath = require.resolve("../api/_lib/supabase.js");
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

const calls = [];
let deletedUser = null;
const handlerPath = require.resolve("../api/account.js");
delete require.cache[handlerPath];
require.cache[libPath] = {
  id: libPath,
  filename: libPath,
  loaded: true,
  exports: {
    bearerToken: (request) => String(request.headers.authorization || "").replace(/^Bearer\s+/i, ""),
    verifyAccessToken: async (token) => token === "valid-token" ? { id: "user-1", email: "driver@example.com" } : null,
    deleteAuthUser: async (id) => { deletedUser = id; calls.push(["auth", id]); },
    pgFetch: async (table, options = {}) => {
      calls.push([table, options.method || "GET", options.params || {}]);
      if (table === "drivers" && !options.method) return [{ id: "driver-1" }];
      if (table === "fleets" && !options.method) return [{ id: "fleet-1" }];
      if (table === "sessions" && !options.method) return [{ id: "session-1" }];
      if (table === "fleet_invitations" && !options.method && options.params.or) return [{ id: "invite-user" }];
      if (table === "fleet_invitations" && !options.method && options.params.fleet_id) return [{ id: "invite-fleet" }];
      return [];
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

result = await invoke(request({ confirm: "DELETE" }));
assert.equal(result.statusCode, 200);
assert.equal(result.body.deleted, true);
assert.equal(deletedUser, "user-1");
assert.equal(calls.at(-1)[0], "auth", "Auth deletion must happen after user-owned rows are removed");
assert.ok(calls.some(([table, method]) => table === "events" && method === "DELETE"));
assert.ok(calls.some(([table, method]) => table === "drivers" && method === "DELETE"));
assert.ok(calls.some(([table, method]) => table === "fleets" && method === "DELETE"));

result = await invoke(request({ confirm: "DELETE" }, "bad-token"));
assert.equal(result.statusCode, 401);

console.log("Occulert account deletion tests passed.");
