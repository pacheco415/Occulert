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
let ownedFleet = null, billingCustomer = null, billingReadFailure = null, stripeResponse = null;
const stripeCalls = [], reads = [];
globalThis.fetch = async (url, options = {}) => {
  stripeCalls.push({ url: String(url), method: options.method || "GET" });
  calls.push(["stripe", options.method || "GET", String(url)]);
  if (!stripeResponse) throw new Error("unexpected fetch " + url);
  return new Response(JSON.stringify(stripeResponse.body), { status: stripeResponse.status });
};
function configureStripe(secret = "sk_test_fixture") {
  Object.assign(process.env, { STRIPE_TEST_SECRET_KEY: secret, STRIPE_TEST_WEBHOOK_SECRET: "whsec_fixture",
    STRIPE_TEST_PRICE_STARTER: "price_starter", STRIPE_TEST_PRICE_GROWTH: "price_growth" });
}
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
      // Billing cleanup may read the owned fleet and its billing row only.
      if (options.method) throw new Error("Account deletion must never pre-delete application data");
      reads.push(table);
      if (billingReadFailure) { const error = new Error("supabase_request_failed"); error.details = billingReadFailure; throw error; }
      if (table === "fleets") return ownedFleet ? [{ id: ownedFleet }] : [];
      if (table === "fleet_billing_test") return billingCustomer ? [{ fleet_id: ownedFleet, stripe_customer_id: billingCustomer }] : [];
      throw new Error("unexpected read " + table);
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
// Stripe cleanup: the customer is deleted before Auth; failures keep the account.
const freshToken = () => makeToken({ amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] });
async function deletion() { validToken = freshToken(); calls.length = 0; stripeCalls.length = 0; reads.length = 0; deletedUser = null; return invoke(request({ confirm: 'DELETE' })); }
ownedFleet = '22222222-2222-4222-8222-222222222222'; billingCustomer = null;
result = await deletion();
assert.equal(result.statusCode, 200); assert.equal(stripeCalls.length, 0, 'a fleet without billing makes no Stripe call');
billingCustomer = 'cus_Fixture1'; configureStripe(); stripeResponse = { status: 200, body: { id: 'cus_Fixture1', object: 'customer', deleted: true } };
result = await deletion();
assert.equal(result.statusCode, 200);
assert.deepEqual(stripeCalls, [{ url: 'https://api.stripe.com/v1/customers/cus_Fixture1', method: 'DELETE' }]);
assert.deepEqual(calls.map(call => call[0]), ['stripe', 'auth'], 'Stripe cleanup runs before the Auth deletion');
assert.deepEqual(reads, ['fleets', 'fleet_billing_test'], 'cleanup only reads the owned fleet and its billing row');
stripeResponse = { status: 404, body: { error: { code: 'resource_missing', message: 'No such customer' } } };
result = await deletion();
assert.equal(result.statusCode, 200, 'an already-deleted customer does not block account deletion'); assert.equal(deletedUser, 'user-1');
for (const failure of [{ status: 500, body: { error: { code: 'api_error' } } }, { status: 200, body: { id: 'cus_Other', object: 'customer', deleted: true } }, { status: 200, body: { id: 'cus_Fixture1', object: 'customer', deleted: false, livemode: false } }]) {
  stripeResponse = failure;
  result = await deletion();
  assert.equal(result.statusCode, 503); assert.equal(result.body.error, 'billing_cleanup_unavailable'); assert.equal(deletedUser, null, 'billing failure must keep the account');
}
stripeResponse = { status: 200, body: { id: 'cus_Fixture1', object: 'customer', deleted: true } };
for (const secret of ['', 'sk_live_Forbidden']) {
  configureStripe(secret);
  result = await deletion();
  assert.equal(result.statusCode, 503); assert.equal(stripeCalls.length, 0, 'unconfigured or live keys never reach Stripe'); assert.equal(deletedUser, null);
}
configureStripe();
billingCustomer = 'not-a-customer';
result = await deletion();
assert.equal(result.statusCode, 503); assert.equal(stripeCalls.length, 0); assert.equal(deletedUser, null);
billingCustomer = 'cus_Fixture1';
billingReadFailure = { code: 'PGRST205' };
result = await deletion();
assert.equal(result.statusCode, 200, 'a database without the billing migration has nothing to clean up'); assert.equal(stripeCalls.length, 0);
billingReadFailure = { code: '08006' };
result = await deletion();
assert.equal(result.statusCode, 503); assert.equal(deletedUser, null, 'an unreadable billing row keeps the account');
billingReadFailure = null; ownedFleet = null;
console.log("Occulert account deletion tests passed.");

const { hasRecentAuthentication } = require('../api/_lib/recent-auth.js');
assert.equal(hasRecentAuthentication(makeToken({ amr: [{ method: 'password', timestamp: 1000 }] }), { id: 'user-1' }, 1600), true);
assert.equal(hasRecentAuthentication(makeToken({ amr: [{ method: 'password', timestamp: 1000 }] }), { id: 'user-1' }, 1601), false);
assert.equal(hasRecentAuthentication('malformed', { id: 'user-1' }), false);
