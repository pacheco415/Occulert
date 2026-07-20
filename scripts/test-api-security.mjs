import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const libPath = require.resolve("../api/_lib/supabase.js");

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.SUPABASE_ANON_KEY = "test-public-anon-key";
delete process.env.PILOT_LEADS_WEBHOOK_URL;
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_FROM_EMAIL;
delete process.env.OCCULERT_PUBLIC_URL;

const verifiedUser = {
  id: "user-1",
  email: "manager@example.com",
  email_confirmed_at: "2026-07-19T00:00:00.000Z",
};

function loadHandler(path, pgFetch, user = verifiedUser) {
  const handlerPath = require.resolve(path);
  delete require.cache[handlerPath];
  require.cache[libPath] = {
    id: libPath,
    filename: libPath,
    loaded: true,
    exports: {
      pgFetch,
      verifyAccessToken: async () => user,
      bearerToken: () => "valid-token",
    },
  };
  return require(path);
}

function request(method, body, ip = "203.0.113.10") {
  return {
    method,
    body,
    headers: {
      authorization: "Bearer valid-token",
      "content-type": "application/json",
      origin: "https://www.occulert.com",
      host: "www.occulert.com",
      "x-vercel-forwarded-for": ip,
    },
  };
}

async function invoke(handler, req) {
  const headers = {};
  const res = {
    statusCode: 200,
    setHeader(name, value) { headers[name.toLowerCase()] = String(value); },
    end(value) { this.body = value ? JSON.parse(value) : null; },
  };
  await handler(req, res);
  return { status: res.statusCode, body: res.body, headers };
}

let allowSessionUpdate = false;
let sessionPatchParams;
let patchedSession;
const sessions = loadHandler("../api/sessions.js", async (table, options = {}) => {
  if (table === "drivers") return [{ id: "driver-1", fleet_id: "fleet-1" }];
  if (table === "sessions" && options.method === "PATCH") {
    sessionPatchParams = options.params;
    patchedSession = options.body;
    return allowSessionUpdate ? [{ id: "session-1" }] : [];
  }
  throw new Error(`unexpected sessions call: ${table}`);
});

const patchBody = { session_id: "session-1", average_fatigue: 30, max_fatigue: 60, safety_score: 80 };
const deniedPatch = await invoke(sessions, request("PATCH", patchBody));
assert.equal(deniedPatch.status, 404, "a session not owned by the authenticated driver must stay hidden");
assert.deepEqual(sessionPatchParams, { id: "eq.session-1", driver_id: "eq.driver-1" });

allowSessionUpdate = true;
const allowedPatch = await invoke(sessions, request("PATCH", patchBody));
assert.equal(allowedPatch.status, 200, "the authenticated driver must still be able to finish their own session");

const blankMetricsPatch = await invoke(sessions, request("PATCH", {
  session_id: "session-1",
  average_fatigue: null,
  max_fatigue: "",
  safety_score: false,
}));
assert.equal(blankMetricsPatch.status, 200);
assert.equal(patchedSession.average_fatigue, null, "explicitly absent fatigue must not become 0");
assert.equal(patchedSession.max_fatigue, null, "blank fatigue must not become 0");
assert.equal(patchedSession.safety_score, null, "boolean metrics must not become 0");

let allowEventSession = false;
let insertedEvent;
const events = loadHandler("../api/events.js", async (table, options = {}) => {
  if (table === "drivers") return [{ id: "driver-1" }];
  if (table === "sessions") return allowEventSession ? [{ id: "session-1" }] : [];
  if (table === "events") {
    insertedEvent = options.body;
    return [{ id: "event-1", ...options.body }];
  }
  throw new Error(`unexpected events call: ${table}`);
});

const eventBody = { session_id: "session-1", type: "drowsy", fatigue_score: 140, confidence: -5, latitude: 120, longitude: -240 };
const deniedEvent = await invoke(events, request("POST", eventBody));
assert.equal(deniedEvent.status, 404, "events must not be written to another driver's session");

allowEventSession = true;
const allowedEvent = await invoke(events, request("POST", eventBody));
assert.equal(allowedEvent.status, 200, "events for the authenticated driver's session must still be accepted");
assert.equal(insertedEvent.fatigue_score, 100);
assert.equal(insertedEvent.confidence, 0);
assert.equal(insertedEvent.latitude, 90);
assert.equal(insertedEvent.longitude, -180);

const eventWithoutLocation = await invoke(events, request("POST", {
  session_id: "session-1",
  type: "drowsy",
  fatigue_score: 25,
  latitude: null,
  longitude: "",
}));
assert.equal(eventWithoutLocation.status, 200);
assert.equal(insertedEvent.latitude, null, "explicitly absent latitude must not become 0");
assert.equal(insertedEvent.longitude, null, "explicitly absent longitude must not become 0");

let insertedProfile;
const profile = loadHandler("../api/profile.js", async (table, options = {}) => {
  assert.equal(table, "drivers");
  if (!options.method) return [];
  if (options.method === "POST") {
    insertedProfile = options.body;
    return [{ id: "driver-1", ...options.body }];
  }
  throw new Error(`unexpected profile call: ${options.method}`);
});
const savedProfile = await invoke(profile, request("POST", {
  name: "Test Driver",
  vehicle: "Van 12",
  fleet_id: "attacker-chosen-fleet",
  role: "fleet-owner",
}));
assert.equal(savedProfile.status, 200);
assert.equal(insertedProfile.user_id, "user-1");
assert.equal(insertedProfile.fleet_id, null, "drivers must not self-assign fleet membership");
assert.equal(Object.hasOwn(insertedProfile, "role"), false, "privileged roles must not be accepted from the browser");

let insertedFleet;
const fleets = loadHandler("../api/fleets.js", async (table, options = {}) => {
  assert.equal(table, "fleets");
  if (!options.method) return [];
  if (options.method === "POST") {
    insertedFleet = options.body;
    return [{ id: "fleet-1", created_at: new Date().toISOString(), ...options.body }];
  }
  throw new Error(`unexpected fleet call: ${options.method}`);
});
const createdFleet = await invoke(fleets, request("POST", {
  company_name: "Safe Transit",
  owner_user_id: "attacker-user",
  plan: "enterprise",
  role: "admin",
}));
assert.equal(createdFleet.status, 201);
assert.equal(insertedFleet.owner_user_id, "user-1", "fleet ownership must come from the verified access token");
assert.equal(insertedFleet.plan, "trial", "browser callers must not choose privileged plans");
assert.equal(Object.hasOwn(insertedFleet, "role"), false, "browser callers must not create privileged roles");

const unverifiedFleet = loadHandler("../api/fleets.js", async () => {
  throw new Error("database must not be called for an unverified owner");
}, { id: "user-2", email: "unverified@example.com" });
const unverifiedFleetResult = await invoke(unverifiedFleet, request("POST", { company_name: "Unverified Fleet" }));
assert.equal(unverifiedFleetResult.status, 403);
assert.equal(unverifiedFleetResult.body.error, "email_not_verified");

let insertedInvitation;
let pendingInvitationParams;
let recentInvitationParams;
const invitations = loadHandler("../api/fleet-invitations.js", async (table, options = {}) => {
  if (table === "fleets") return [{ id: "fleet-1", company_name: "Safe Transit", plan: "trial" }];
  if (table === "fleet_invitations" && !options.method) {
    if (options.params.select === "id") recentInvitationParams = options.params;
    else pendingInvitationParams = options.params;
    return [];
  }
  if (table === "fleet_invitations" && options.method === "POST") {
    insertedInvitation = options.body;
    return [{ id: "11111111-1111-4111-8111-111111111111", ...options.body }];
  }
  throw new Error(`unexpected invitation call: ${table} ${options.method || "GET"}`);
});
const createdInvitation = await invoke(invitations, request("POST", { email: "Driver@Example.com" }));
assert.equal(createdInvitation.status, 201);
assert.equal(insertedInvitation.fleet_id, "fleet-1");
assert.equal(insertedInvitation.invited_by, "user-1");
assert.equal(insertedInvitation.email, "driver@example.com");
assert.match(pendingInvitationParams.expires_at, /^gt\./, "expired invitations must not exhaust the active invitation limit");
assert.equal(recentInvitationParams.fleet_id, "eq.fleet-1", "hourly invitation limits must use the verified owner's indexed fleet scope");
assert.match(insertedInvitation.token_hash, /^[0-9a-f]{64}$/);
assert.equal(Object.hasOwn(insertedInvitation, "token"), false, "raw invitation tokens must never be stored");
assert.equal(createdInvitation.body.invitation.delivery.status, "not_configured", "copy-link fallback must survive missing email configuration");
const rawInviteToken = createdInvitation.body.invitation.accept_path.split("#token=")[1];
assert.ok(rawInviteToken.length >= 32);
assert.equal(JSON.stringify(insertedInvitation).includes(rawInviteToken), false, "the stored invitation must not contain its usable token");

let revokedReplacement;
let replacementInsert;
const replacementId = "22222222-2222-4222-8222-222222222222";
const replacementInvitations = loadHandler("../api/fleet-invitations.js", async (table, options = {}) => {
  if (table === "fleets") return [{ id: "fleet-1", company_name: "Safe Transit", plan: "trial" }];
  if (table !== "fleet_invitations") throw new Error(`unexpected replacement call: ${table}`);
  if (!options.method && options.params.select !== "id") {
    return [{ id: replacementId, email: "driver@example.com", expires_at: new Date(Date.now() + 60000).toISOString(), created_at: new Date(Date.now() - 120000).toISOString() }];
  }
  if (!options.method) return [];
  if (options.method === "PATCH") {
    revokedReplacement = options;
    return [{ id: replacementId }];
  }
  if (options.method === "POST") {
    replacementInsert = options.body;
    return [{ id: "33333333-3333-4333-8333-333333333333", ...options.body }];
  }
  throw new Error(`unexpected replacement method: ${options.method}`);
});
const replacedInvitation = await invoke(replacementInvitations, request("POST", { replace_invitation_id: replacementId, email: "attacker@example.com" }));
assert.equal(replacedInvitation.status, 201);
assert.equal(revokedReplacement.params.id, "eq." + replacementId, "resending must revoke the selected pending invitation");
assert.equal(replacementInsert.email, "driver@example.com", "resending must reuse the server-stored invited email");
assert.notEqual(replacementInsert.token_hash, insertedInvitation.token_hash, "resending must create a fresh one-time token");

const invitationRateLimit = loadHandler("../api/fleet-invitations.js", async (table, options = {}) => {
  if (table === "fleets") return [{ id: "fleet-1", company_name: "Safe Transit", plan: "trial" }];
  if (table === "fleet_invitations" && !options.method && options.params.select === "id") {
    return Array.from({ length: 20 }, (_, index) => ({ id: `invite-${index}` }));
  }
  if (table === "fleet_invitations" && !options.method) return [];
  throw new Error("rate-limited invitations must not write to the database");
});
const rateLimitedInvitation = await invoke(invitationRateLimit, request("POST", { email: "driver@example.com" }));
assert.equal(rateLimitedInvitation.status, 429);
assert.equal(rateLimitedInvitation.body.error, "invitation_rate_limited");
assert.equal(rateLimitedInvitation.headers["retry-after"], "3600");

let invitationListSelect;
const listInvitations = loadHandler("../api/fleet-invitations.js", async (table, options = {}) => {
  if (table === "fleets") return [{ id: "fleet-1", company_name: "Safe Transit", plan: "trial" }];
  invitationListSelect = options.params.select;
  return [{ id: "invite-1", email: "driver@example.com", expires_at: new Date(Date.now() + 60000).toISOString() }];
});
const invitationList = await invoke(listInvitations, request("GET"));
assert.equal(invitationList.status, 200);
assert.equal(invitationListSelect.includes("token_hash"), false, "invitation listings must never select token hashes");

const emailLibPath = require.resolve("../api/_lib/email.js");
delete require.cache[emailLibPath];
process.env.RESEND_API_KEY = "re_test_server_secret";
process.env.RESEND_FROM_EMAIL = "Occulert <invites@occulert.com>";
const originalFetch = global.fetch;
let resendRequest;
global.fetch = async (url, options) => {
  resendRequest = { url, options };
  return { ok: true, async json() { return { id: "email-1" }; } };
};
const emailLib = require(emailLibPath);
const sentEmail = await emailLib.sendFleetInvitationEmail({
  to: "driver@example.com",
  fleetName: "Safe <Transit>\r\nBcc: attacker@example.com",
  acceptUrl: "https://www.occulert.com/accept-invite.html#token=safe-token",
  invitationId: "33333333-3333-4333-8333-333333333333",
});
global.fetch = originalFetch;
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_FROM_EMAIL;
assert.equal(sentEmail.status, "sent");
assert.equal(resendRequest.url, "https://api.resend.com/emails");
assert.equal(resendRequest.options.headers["Idempotency-Key"], "fleet-invitation-33333333-3333-4333-8333-333333333333");
assert.equal(resendRequest.options.headers.Authorization, "Bearer re_test_server_secret");
const resendBody = JSON.parse(resendRequest.options.body);
assert.equal(resendBody.to[0], "driver@example.com");
assert.equal(resendBody.subject.includes("\r"), false, "fleet names must not inject email headers");
assert.equal(resendBody.subject.includes("\n"), false, "fleet names must not inject email headers");
assert.ok(resendBody.html.includes("Safe &lt;Transit&gt;"), "fleet names must be escaped in HTML email");
assert.equal(resendRequest.options.body.includes("re_test_server_secret"), false, "email provider keys must never enter message bodies");

const nonOwnerInvitations = loadHandler("../api/fleet-invitations.js", async (table) => {
  if (table === "fleets") return [];
  throw new Error("a non-owner must not reach invitation data");
});
const nonOwnerInviteResult = await invoke(nonOwnerInvitations, request("POST", { email: "driver@example.com" }));
assert.equal(nonOwnerInviteResult.status, 403, "only a server-verified fleet owner may invite drivers");

let acceptanceCall;
const acceptInvitation = loadHandler("../api/accept-invitation.js", async (table, options = {}) => {
  acceptanceCall = { table, options };
  return [{ fleet_id: "fleet-1", company_name: "Safe Transit", driver_id: "driver-1" }];
}, { id: "driver-user", email: "driver@example.com", email_confirmed_at: "2026-07-19T00:00:00.000Z" });
const acceptedInvitation = await invoke(acceptInvitation, request("POST", { token: rawInviteToken }));
assert.equal(acceptedInvitation.status, 200);
assert.equal(acceptanceCall.table, "rpc/accept_fleet_invitation");
assert.equal(acceptanceCall.options.body.p_user_id, "driver-user");
assert.equal(acceptanceCall.options.body.p_user_email, "driver@example.com");
assert.match(acceptanceCall.options.body.p_token_hash, /^[0-9a-f]{64}$/);
assert.equal(JSON.stringify(acceptanceCall).includes(rawInviteToken), false, "the raw token must be hashed before the database call");

const mismatchedInvitation = loadHandler("../api/accept-invitation.js", async () => {
  const error = new Error("database rejected mismatched email");
  error.details = { message: "invitation_email_mismatch" };
  throw error;
}, { id: "attacker-user", email: "attacker@example.com", email_confirmed_at: "2026-07-19T00:00:00.000Z" });
const mismatchedResult = await invoke(mismatchedInvitation, request("POST", { token: rawInviteToken }));
assert.equal(mismatchedResult.status, 403);
assert.equal(mismatchedResult.body.error, "invitation_email_mismatch");

const fleetSummaryCalls = [];
const fleetSummary = loadHandler("../api/fleet-summary.js", async (table, options = {}) => {
  fleetSummaryCalls.push({ table, options });
  if (table === "fleets") return [{ id: "fleet-1", company_name: "Safe Transit", plan: "trial" }];
  if (table === "drivers") return [{ id: "driver-1", name: "Driver", active: true, vehicle_id: "Van 12" }];
  if (table === "sessions") return [];
  throw new Error(`unexpected fleet summary call: ${table}`);
});
const fleetSummaryResult = await invoke(fleetSummary, request("GET"));
assert.equal(fleetSummaryResult.status, 200);
assert.equal(fleetSummaryCalls[0].options.params.owner_user_id, "eq.user-1");
assert.equal(fleetSummaryCalls[1].options.params.fleet_id, "eq.fleet-1");
assert.equal(fleetSummaryCalls[2].options.params.fleet_id, "eq.fleet-1");

const publicConfigPath = require.resolve("../api/public-config.js");
delete require.cache[publicConfigPath];
const publicConfig = require(publicConfigPath);
const configResult = await invoke(publicConfig, request("GET"));
assert.equal(configResult.status, 200);
assert.equal(configResult.body.supabase.configured, true);
assert.equal(configResult.body.supabase.url, "https://example.supabase.co");
assert.equal(configResult.body.supabase.anonKey, "test-public-anon-key");
assert.equal(JSON.stringify(configResult.body).includes("test-service-role"), false, "public config must never expose the service-role key");

let storedLead;
const pilotLeads = loadHandler("../api/pilot-leads.js", async (table, options = {}) => {
  assert.equal(table, "pilot_leads");
  storedLead = options.body;
  return [{ id: "lead-1", ...options.body }];
});

const validLead = {
  name: "Test Driver",
  company: "Test Fleet",
  email: "driver@example.com",
  startedAt: new Date(Date.now() - 3000).toISOString(),
  website: "",
};
const missingTiming = await invoke(pilotLeads, request("POST", { ...validLead, startedAt: "" }, "203.0.113.20"));
assert.equal(missingTiming.status, 400, "pilot form timing metadata is required");
const botLead = await invoke(pilotLeads, request("POST", { ...validLead, website: "https://spam.example" }, "203.0.113.21"));
assert.equal(botLead.status, 400, "the honeypot must reject automated submissions");
const stored = await invoke(pilotLeads, request("POST", validLead, "203.0.113.22"));
assert.equal(stored.status, 200);
assert.equal(stored.body.stored, true);
assert.equal(storedLead.email, "driver@example.com");
assert.equal(storedLead.use_case, null);

let rateLimited;
for (let i = 0; i < 6; i += 1) {
  rateLimited = await invoke(pilotLeads, request("POST", { ...validLead, startedAt: "" }, "203.0.113.30"));
}
assert.equal(rateLimited.status, 429, "submission bursts must be rate limited");
assert.ok(Number(rateLimited.headers["retry-after"]) > 0);

console.log("Occulert API security tests passed.");
