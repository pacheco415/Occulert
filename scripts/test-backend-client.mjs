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
  if (String(url).includes("/auth/v1/recover")) return response({});
  if (String(url).includes("/auth/v1/user") && (options.method || "GET") === "GET") {
    return response({ id: "user-1", email: "driver@example.com" });
  }
  if (String(url).includes("/auth/v1/user") && options.method === "PUT") {
    const sent = JSON.parse(options.body || "{}");
    if (sent.password === "short") return response({ error_code: "weak_password", msg: "Password should be at least 6 characters" }, 422);
    if (sent.email === "taken@example.com") return response({ error_code: "email_exists", msg: "email address already registered" }, 422);
    return response({ id: "user-1", email: "driver@example.com", new_email: sent.email });
  }
  if (url === "/api/profile") return response({ ok: true, driver: { id: "driver-1" } });
  if (url === "/api/sessions" && options.method === "POST") return response({ ok: true, session: { id: "session-1" } });
  if (url === "/api/sessions" && options.method === "PATCH") return response({ ok: true, session: { id: "session-1" } });
  if (url === "/api/events") return response({ ok: true, event: { id: "event-1" } });
  if (url === "/api/fleets" && options.method === "GET") return response({ ok: true, fleet: { id: "fleet-1" } });
  if (url === "/api/fleets" && options.method === "POST") return response({ ok: true, fleet: { id: "fleet-1" } }, 201);
  if (url === "/api/fleet-summary") return response({ ok: true, fleet: { id: "fleet-1" }, drivers: [], sessions: [], events: [] });
  if (url === "/api/fleet-invitations" && options.method === "GET") return response({ ok: true, invitations: [] });
  if (url === "/api/fleet-invitations" && options.method === "POST") return response({ ok: true, invitation: { id: "invite-1" } }, 201);
  if (url === "/api/fleet-invitations" && options.method === "DELETE") return response({ ok: true });
  if (url === "/api/accept-invitation") return response({ ok: true, fleet: { id: "fleet-1" } });
  throw new Error(`unexpected fetch: ${options.method || "GET"} ${url}`);
}

const historyCalls = [];
const window = {
  location: { origin: "https://www.occulert.com", pathname: "/login.html", search: "", hash: "" },
  history: { replaceState(...args) { historyCalls.push(args); } },
};
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
  URLSearchParams,
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
assert.equal(backend.passwordResetMessage({ body: { error: "email_rate_limit_exceeded" } }), "Too many password reset emails were requested. Wait about an hour, then try once more.");
assert.equal(backend.passwordResetMessage({ body: { error: "invalid_recovery_link" } }), "This password reset link is invalid or expired. Request a new link from the sign-in page.");

assert.equal(await backend.isConfigured(), true);
assert.equal((await backend.signUp("new@example.com", "password123")).ok, true);
assert.ok(calls.some((call) => String(call.url).includes("/auth/v1/signup?redirect_to=https%3A%2F%2Fwww.occulert.com%2Flogin.html")));
assert.equal((await backend.requestPasswordReset("driver@example.com")).ok, true);
const resetCall = calls.find((call) => String(call.url).includes("/auth/v1/recover"));
assert.ok(String(resetCall.url).includes("redirect_to=https%3A%2F%2Fwww.occulert.com%2Faccount.html%3Frecovery%3D1"));
assert.equal(JSON.parse(resetCall.body).email, "driver@example.com");
const signedIn = await backend.signIn("driver@example.com", "password123");
assert.equal(signedIn.ok, true);
assert.equal(backend.currentUser().id, "user-1");
assert.equal((await backend.getSession()).access_token, "access-token");
const adopted = backend.adoptSession({
  access_token: "passkey-access",
  refresh_token: "passkey-refresh",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "user-1", email: "driver@example.com" },
});
assert.equal(adopted.access_token, "passkey-access");
backend.adoptSession(signedIn.body);
assert.equal((await backend.ensureDriverProfile({ name: "Test Driver", vehicle: "Van 12" })).ok, true);
assert.equal((await backend.startSession()).body.session.id, "session-1");
assert.equal((await backend.logEvent("session-1", "drowsy", { fatigue_score: 80 })).ok, true);
assert.equal((await backend.endSession("session-1", { safety_score: 70 })).ok, true);
assert.equal((await backend.getFleet()).body.fleet.id, "fleet-1");
assert.equal((await backend.createFleet("Safe Transit")).status, 201);
assert.equal((await backend.getFleetSummary()).body.fleet.id, "fleet-1");
assert.equal((await backend.listFleetInvitations()).ok, true);
assert.equal((await backend.createFleetInvitation("driver@example.com")).status, 201);
assert.equal((await backend.revokeFleetInvitation("invite-1")).ok, true);
assert.equal((await backend.acceptFleetInvitation("one-time-token")).body.fleet.id, "fleet-1");

// Account credential changes go to Supabase Auth with the live session token.
const emailChange = await backend.updateEmail("second@example.com");
assert.equal(emailChange.ok, true);
const emailCall = calls.find((call) => String(call.url).includes("/auth/v1/user") && call.method === "PUT");
assert.equal(emailCall.headers.Authorization, "Bearer access-token");
assert.equal(emailCall.headers.apikey, "public-key");
assert.equal(JSON.parse(emailCall.body).email, "second@example.com");
assert.ok(String(emailCall.url).includes("redirect_to=https%3A%2F%2Fwww.occulert.com%2Flogin.html"));

assert.equal((await backend.updatePassword("longenough")).ok, true);
const passwordCall = calls.filter((call) => String(call.url).includes("/auth/v1/user") && call.method === "PUT").pop();
assert.equal(JSON.parse(passwordCall.body).password, "longenough");
assert.equal(JSON.parse(passwordCall.body).email, undefined);

const weak = await backend.updatePassword("short");
assert.equal(weak.ok, false);
assert.equal(backend.accountMessage(weak, "password"), "Use a password with at least 6 characters.");
const taken = await backend.updateEmail("taken@example.com");
assert.equal(taken.ok, false);
assert.equal(backend.accountMessage(taken, "email"), "Another account already uses that email address.");
assert.equal(backend.accountMessage({ body: { error: "cloud_unavailable" } }, "email"), "Occulert could not reach the account service. Check your connection and try again.");
assert.equal(backend.accountMessage({ body: { code: "reauthentication_needed" } }, "password"), "For security, sign out and sign back in, then change your password again.");

const protectedCalls = calls.filter((call) => String(call.url).startsWith("/api/") && call.url !== "/api/public-config");
assert.ok(protectedCalls.length >= 4);
assert.ok(protectedCalls.every((call) => call.headers.Authorization === "Bearer access-token"));
assert.equal(calls.find((call) => String(call.url).includes("/auth/v1/token")).headers.apikey, "public-key");
assert.equal(JSON.parse(calls.find((call) => call.url === "/api/fleets" && call.method === "POST").body).company_name, "Safe Transit");
assert.equal(JSON.parse(calls.find((call) => call.url === "/api/fleet-invitations" && call.method === "DELETE").body).invitation_id, "invite-1");

// Recovery links are verified, removed from the visible URL, and persisted as
// a short-lived authenticated session before the password can be changed.
window.location.pathname = "/account.html";
window.location.search = "?recovery=1";
window.location.hash = "#access_token=recovery-access&refresh_token=recovery-refresh&type=recovery&expires_in=3600";
const recovered = await backend.consumeAuthRedirect();
assert.equal(recovered.handled, true);
assert.equal(recovered.ok, true);
assert.equal(backend.currentUser().email, "driver@example.com");
assert.equal(historyCalls.at(-1).at(-1), "/account.html?recovery=1");
const recoveryUserCall = calls.find((call) => String(call.url).includes("/auth/v1/user") && (call.method || "GET") === "GET");
assert.equal(recoveryUserCall.headers.Authorization, "Bearer recovery-access");

backend.signOut();
assert.equal(backend.currentUser(), null);
console.log("Occulert browser backend client tests passed.");
