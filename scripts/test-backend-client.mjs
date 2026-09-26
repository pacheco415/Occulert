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
  if (String(url).includes("/auth/v1/resend")) return response({});
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
  if (String(url).startsWith("/api/fleet-summary")) return response({ ok: true, fleet: { id: "fleet-1" }, drivers: [], sessions: [], events: [] });
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
  setTimeout, clearTimeout, AbortController,
};
window.window = window;
window.localStorage = localStorage;
window.navigator = context.navigator;
window.fetch = fetchMock;

const clientSource = readFileSync(new URL("../occulert-backend.v60.js", import.meta.url), "utf8");
vm.runInNewContext(clientSource, context);
const backend = window.OcculertBackend;

assert.equal(backend.authMessage({ body: { code: "over_email_send_rate_limit", message: "email rate limit exceeded" } }, "signup"), "Too many confirmation emails were requested. Wait about an hour, then try Create Account once.");
assert.equal(backend.authMessage({ body: { error: "invalid_credentials" } }, "signin"), "Email or password is incorrect.");
assert.equal(backend.authMessage({ body: { message: "User already registered" } }, "signup"), "An account already exists for this email. Use Sign In instead.");
assert.equal(backend.isEmailRateLimited({ body: { error: "email_rate_limit_exceeded" } }), true);
assert.equal(backend.needsSignupConfirmation({ body: { error_code: "email_not_confirmed" } }), true);
assert.equal(backend.needsSignupConfirmation({ body: { error: "invalid_credentials" } }), false);
assert.equal(backend.authMessage({ body: { error: "internal_server_error" } }, "signup"), "The account could not be created. Please try again.");
assert.equal(backend.passwordResetMessage({ body: { error: "email_rate_limit_exceeded" } }), "Too many password reset emails were requested. Wait about an hour, then try once more.");
assert.equal(backend.passwordResetMessage({ body: { error: "invalid_recovery_link" } }), "This password reset link is invalid or expired. Request a new link from the sign-in page.");

assert.equal(await backend.isConfigured(), true);
assert.equal((await backend.signUp("new@example.com", "password123")).ok, true);
assert.ok(calls.some((call) => String(call.url).includes("/auth/v1/signup?redirect_to=https%3A%2F%2Fwww.occulert.com%2Flogin.html")));
assert.equal((await backend.resendSignupConfirmation("new@example.com")).ok, true);
const resendCall = calls.find((call) => String(call.url).includes("/auth/v1/resend"));
assert.ok(String(resendCall.url).includes("/auth/v1/resend?redirect_to=https%3A%2F%2Fwww.occulert.com%2Flogin.html"));
assert.deepEqual(JSON.parse(resendCall.body), { type: "signup", email: "new@example.com" });
assert.equal(backend.resendConfirmationMessage({ body: { error: "cloud_unavailable" } }), "Occulert could not reach the account service. Check your connection and try again.");
assert.equal(backend.resendConfirmationMessage({ body: { error_code: "over_email_send_rate_limit" } }), "Too many confirmation emails were requested. Wait about an hour, then try Resend Confirmation once.");
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
assert.equal((await backend.getFleetSummary({ includeEvents: false })).body.fleet.id, "fleet-1");
assert.ok(calls.some((call) => call.url === "/api/fleet-summary?include_events=0"));
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

function refreshHarness() {
  const storage = new Map();
  const pending = [];
  const protectedPending = [];
  const requests = [];
  let writesBlocked = false;
  const localStorage = {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => { if (writesBlocked) throw new Error('Storage unavailable'); storage.set(key, String(value)); },
    removeItem: key => storage.delete(key),
  };
  const window = {};
  vm.runInNewContext(clientSource, {
    window, localStorage, navigator: {},
    fetch(url) {
      requests.push(String(url));
      if (url === '/api/public-config') return Promise.resolve(response({ supabase: { configured: true, url: 'https://example.supabase.co', anonKey: 'public' } }));
      if (String(url).includes('grant_type=refresh_token')) return new Promise(resolve => pending.push(resolve));
      if (String(url).includes('/api/fleet-summary') || String(url).endsWith('/auth/v1/user')) return new Promise(resolve => protectedPending.push(resolve));
      throw new Error('Unexpected protected request after superseded auth: ' + url);
    },
    Date, JSON, Promise, URLSearchParams, setTimeout, clearTimeout, AbortController,
  });
  const expired = { access_token: 'old-access', refresh_token: 'old-refresh', expires_at: 1, user: { id: 'owner-a' } };
  const fresh = { access_token: 'new-access', refresh_token: 'new-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'owner-b' } };
  window.OcculertBackend.adoptSession(expired);
  return { backend: window.OcculertBackend, pending, protectedPending, requests, storage, expired, fresh, blockWrites: () => { writesBlocked = true; } };
}
async function waitForRefresh(harness, count = 1) {
  for (let i = 0; i < 10 && harness.pending.length < count; i++) await new Promise(setImmediate);
  assert.equal(harness.pending.length, count, 'refresh request must reach the deferred transport');
}

for (const status of [200, 400]) {
  for (const replacement of ['signout', 'adopt', 'other-tab', 'same-session']) {
    const h = refreshHarness();
    const refresh = h.backend.getSession();
    const rejected = assert.rejects(refresh, { code: 'auth_session_changed' });
    await waitForRefresh(h);
    if (replacement === 'signout') h.backend.signOut();
    else if (replacement === 'other-tab') h.storage.set('occulert-auth', JSON.stringify(h.fresh));
    else h.backend.adoptSession(replacement === 'same-session' ? h.expired : h.fresh);
    const expected = h.storage.get('occulert-auth');
    h.pending[0](response({ access_token: 'late-access', refresh_token: 'late-refresh', user: { id: 'owner-a' }, expires_in: 3600 }, status));
    await rejected;
    assert.equal(h.storage.get('occulert-auth'), expected, `late ${status} response must preserve ${replacement}`);
  }
}

for (const [status, body] of [
  [503, { error: 'temporarily_unavailable' }],
  [200, { error: 'missing_session' }],
  [200, null],
  [200, { access_token: 'partial-access' }],
  [200, { access_token: 'partial-access', refresh_token: 'partial-refresh', user: {} }],
  [200, { access_token: 'wrong-owner-access', refresh_token: 'wrong-owner-refresh', user: { id: 'owner-b' }, expires_in: 3600 }],
]) {
  const h = refreshHarness();
  const refresh = h.backend.getSession();
  const rejected = assert.rejects(refresh, { code: 'cloud_unavailable' });
  await waitForRefresh(h);
  const expected = h.storage.get('occulert-auth');
  h.pending[0](response(body, status));
  await rejected;
  assert.equal(h.storage.get('occulert-auth'), expected, 'unavailable or malformed refresh must not clear stored account');
}

for (const status of [400, 401, 403]) {
  const h = refreshHarness();
  const refresh = h.backend.getSession();
  await waitForRefresh(h);
  h.pending[0](response({ error: 'refresh_token_invalid' }, status));
  assert.equal(await refresh, null);
  assert.equal(h.backend.currentUser(), null, 'definitively rejected current token must still sign out');
}

for (const reuseTokens of [false, true]) {
  const h = refreshHarness();
  const refresh = h.backend.getSession();
  const rejected = assert.rejects(refresh, { code: 'cloud_unavailable' });
  await waitForRefresh(h);
  const expected = h.storage.get('occulert-auth');
  h.blockWrites();
  h.pending[0](response({ access_token: reuseTokens ? h.expired.access_token : h.fresh.access_token,
    refresh_token: reuseTokens ? h.expired.refresh_token : h.fresh.refresh_token,
    expires_in: 3600, user: { id: 'owner-a' } }));
  await rejected;
  assert.equal(h.storage.get('occulert-auth'), expected, 'failed refresh persistence must preserve the prior stored account');
}

{
  const h = refreshHarness();
  const first = h.backend.getSession();
  const second = h.backend.getSession();
  const rejected = assert.rejects(second, { code: 'auth_session_changed' });
  await waitForRefresh(h, 2);
  h.pending[0](response({ ...h.fresh, user: { id: 'owner-a' } }));
  assert.equal((await first).access_token, 'new-access');
  h.pending[1](response({ error: 'refresh_token_already_used' }, 400));
  await rejected;
  assert.equal(h.backend.currentUser().id, 'owner-a');
  assert.equal(JSON.parse(h.storage.get('occulert-auth')).access_token, 'new-access', 'concurrent stale token failure must preserve rotated session');
}

{
  const h = refreshHarness();
  const request = h.backend.getFleetSummary({ includeEvents: false });
  await waitForRefresh(h);
  h.backend.adoptSession(h.fresh);
  h.pending[0](response({ ...h.fresh, user: { id: 'owner-a' } }));
  const result = await request;
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'auth_session_changed');
  assert.ok(h.requests.every(url => !url.startsWith('/api/fleet-summary')), 'superseded operation must not continue using another owner');
}

for (const operation of ['summary', 'account']) {
  for (const status of [200, 401]) {
    for (const replacement of ['same-owner', 'other-owner', 'other-tab', 'signout']) {
      const h = refreshHarness();
      h.backend.adoptSession({ ...h.fresh, user: { id: 'owner-a' } });
      const request = operation === 'summary' ? h.backend.getFleetSummary({ includeEvents: false }) : h.backend.updatePassword('new-password');
      for (let i = 0; i < 10 && !h.protectedPending.length; i++) await new Promise(setImmediate);
      assert.equal(h.protectedPending.length, 1);
      if (replacement === 'signout') h.backend.signOut();
      else {
        const next = { ...h.fresh, access_token: 'replacement-access', refresh_token: 'replacement-refresh', user: { id: replacement === 'same-owner' ? 'owner-a' : 'owner-b' } };
        if (replacement === 'other-tab') h.storage.set('occulert-auth', JSON.stringify(next));
        else h.backend.adoptSession(next);
      }
      const expected = h.storage.get('occulert-auth');
      h.protectedPending[0](response(status === 200 ? { fleet: { id: 'old-fleet' } } : { error: 'unauthorized' }, status));
      const result = await request;
      assert.equal(result.status, 409);
      assert.equal(result.ok, false);
      assert.equal(result.body.error, 'auth_session_changed');
      assert.equal(h.storage.get('occulert-auth'), expected, `${operation} late ${status} must preserve ${replacement}`);
    }
  }
}

{
  const h = refreshHarness();
  const request = h.backend.getFleetSummary();
  await waitForRefresh(h);
  h.pending[0](response({ error: 'unavailable' }, 503));
  const result = await request;
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'cloud_unavailable');
  assert.equal(h.backend.currentUser().id, 'owner-a');
  assert.equal(h.protectedPending.length, 0, 'unverified expired auth must not send a protected request');
}
for (const stalledStage of ['fetch', 'body']) {
  const storage = new Map(), timers = new Map(), transport = [], configSignals = [];
  let timerId = 0, configCalls = 0, releaseOld;
  const stalled = new Promise(resolve => { releaseOld = resolve; });
  const window = {};
  const config = { supabase: { configured: true, url: 'https://current.supabase.co', anonKey: 'public' } };
  vm.runInNewContext(clientSource, {
    window, navigator: {}, Date, JSON, Promise, URLSearchParams, AbortController,
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) {
      transport.push(url);
      if (url === '/api/public-config') {
        configSignals.push(options.signal);
        configCalls++;
        if (configCalls === 1) return stalledStage === 'fetch' ? stalled : Promise.resolve({ text: () => stalled });
        return Promise.resolve(response(config));
      }
      return Promise.resolve(response({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3600, user: { id: 'owner-a' } }));
    },
  });
  const client = window.OcculertBackend;
  client.adoptSession({ access_token: 'expired-access', refresh_token: 'expired-refresh', expires_at: 1, user: { id: 'owner-a' } });
  const attempt = client.getSession();
  const rejected = assert.rejects(attempt, { code: 'cloud_unavailable' });
  await new Promise(setImmediate);
  const deadline = [...timers.values()].find(timer => timer.delay === 8000);
  assert.ok(deadline, `${stalledStage} config must have a deadline`);
  deadline.fn();
  await rejected;
  assert.equal(client.currentUser().id, 'owner-a');
  assert.equal(configSignals[0].aborted, true);
  assert.equal(timers.size, 0);
  const recovered = await client.getSession();
  assert.equal(recovered.access_token, 'fresh-access');
  assert.equal(configCalls, 2, 'retry must start a replacement configuration lookup');
  const oldConfig = { supabase: { configured: true, url: 'https://discarded.supabase.co', anonKey: 'old' } };
  releaseOld(stalledStage === 'fetch' ? response(oldConfig) : JSON.stringify(oldConfig));
  await new Promise(setImmediate);
  assert.equal((await client.getAuthConfig()).url, 'https://current.supabase.co', 'late config must not replace the successful retry');
  assert.equal(configCalls, 2);
  assert.ok(transport.includes('https://current.supabase.co/auth/v1/token?grant_type=refresh_token'));
  assert.ok(!transport.some(url => String(url).includes('discarded.supabase.co')));
}

console.log("Occulert browser backend client tests passed.");
