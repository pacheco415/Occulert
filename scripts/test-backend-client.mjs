import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const values = new Map();
const calls = [];
const localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function fetchMock(url, options = {}) {
  calls.push({ url: String(url), method: options.method || "GET", headers: options.headers || {}, body: options.body });
  if (url === "/api/public-config") {
    return response({ ok: true, supabase: { configured: true, url: "https://example.supabase.co", anonKey: "public-key" } });
  }
  if (String(url).includes("/auth/v1/token")) {
    return response({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      user: { id: "user-1", email: "driver@example.com" },
    });
  }
  if (String(url).includes("/auth/v1/signup")) return response({ user: { id: "pending-user", email: "new@example.com" } });
  if (url === "/api/profile") return response({ ok: true, driver: { id: "driver-1" } });
  if (url === "/api/sessions" && options.method === "POST") return response({ ok: true, session: { id: "session-1" } });
  if (url === "/api/sessions" && options.method === "PATCH") return response({ ok: true, session: { id: "session-1" } });
  if (url === "/api/events") return response({ ok: true, event: { id: "event-1" } });
  if (url === "/api/fleets" && options.method === "GET") return response({ ok: true, fleet: { id: "fleet-1" } });
  if (url === "/api/fleets" && options.method === "POST") return response({ ok: true, fleet: { id: "fleet-1" } }, 201);
  if (url === "/api/fleet-invitations" && options.method === "GET") return response({ ok: true, invitations: [] });
  if (url === "/api/fleet-invitations" && options.method === "POST") return response({ ok: true, invitation: { id: "invite-1" } }, 201);
  if (url === "/api/fleet-invitations" && options.method === "DELETE") return response({ ok: true });
  if (url === "/api/accept-invitation") return response({ ok: true, fleet: { id: "fleet-1" } });
  throw new Error(`unexpected fetch: ${options.method || "GET"} ${url}`);
}

const window = { location: { origin: "https://www.occulert.com" } };
const context = {
  window,
  localStorage,
  navigator: { platform: "test-platform", userAgent: "test-browser" },
  fetch: fetchMock,
  Response,
  JSON,
  Date,
  Math,
  Object,
  Promise,
  String,
};
window.window = window;
window.localStorage = localStorage;
window.navigator = context.navigator;
window.fetch = fetchMock;

vm.runInNewContext(readFileSync(new URL("../occulert-backend.js", import.meta.url), "utf8"), context);
const backend = window.OcculertBackend;

assert.equal(backend.authMessage({ body: { code: "over_email_send_rate_limit", message: "email rate limit exceeded" } }, "signup"), "Too many confirmation emails were requested. Wait about an hour, then try Create Account once.");
assert.equal(backend.authMessage({ body: { error: "invalid_credentials" } }, "signin"), "Email or password is incorrect.");
assert.equal(backend.authMessage({ body: { message: "User already registered" } }, "signup"), "An account already exists for this email. Use Sign In instead.");
assert.equal(backend.isEmailRateLimited({ body: { error: "email_rate_limit_exceeded" } }), true);
assert.equal(backend.authMessage({ body: { error: "internal_server_error" } }, "signup"), "The account could not be created. Please try again.");

assert.equal(await backend.isConfigured(), true);
assert.equal((await backend.signUp("new@example.com", "password123")).ok, true);
assert.ok(calls.some((call) => String(call.url).includes("/auth/v1/signup?redirect_to=https%3A%2F%2Fwww.occulert.com%2Flogin.html")));
const signedIn = await backend.signIn("driver@example.com", "password123");
assert.equal(signedIn.ok, true);
assert.equal(backend.currentUser().id, "user-1");
assert.equal((await backend.ensureDriverProfile({ name: "Test Driver", vehicle: "Van 12" })).ok, true);
assert.equal((await backend.startSession()).body.session.id, "session-1");
assert.equal((await backend.logEvent("session-1", "drowsy", { fatigue_score: 80 })).ok, true);
assert.equal((await backend.endSession("session-1", { safety_score: 70 })).ok, true);
assert.equal((await backend.getFleet()).body.fleet.id, "fleet-1");
assert.equal((await backend.createFleet("Safe Transit")).status, 201);
assert.equal((await backend.listFleetInvitations()).ok, true);
assert.equal((await backend.createFleetInvitation("driver@example.com")).status, 201);
assert.equal((await backend.revokeFleetInvitation("invite-1")).ok, true);
assert.equal((await backend.acceptFleetInvitation("one-time-token")).body.fleet.id, "fleet-1");

const protectedCalls = calls.filter((call) => String(call.url).startsWith("/api/") && call.url !== "/api/public-config");
assert.ok(protectedCalls.length >= 4);
assert.ok(protectedCalls.every((call) => call.headers.Authorization === "Bearer access-token"));
assert.equal(calls.find((call) => String(call.url).includes("/auth/v1/token")).headers.apikey, "public-key");
assert.equal(JSON.parse(calls.find((call) => call.url === "/api/fleets" && call.method === "POST").body).company_name, "Safe Transit");
assert.equal(JSON.parse(calls.find((call) => call.url === "/api/fleet-invitations" && call.method === "DELETE").body).invitation_id, "invite-1");

backend.signOut();
assert.equal(backend.currentUser(), null);
console.log("Occulert browser backend client tests passed.");
