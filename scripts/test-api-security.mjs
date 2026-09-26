import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";

const require = createRequire(import.meta.url);
const libPath = require.resolve("../api/_lib/supabase.js");

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.SUPABASE_ANON_KEY = "test-public-anon-key";
delete process.env.PILOT_LEADS_WEBHOOK_URL;

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
assert.equal(allowedEvent.body.telemetry_trust, "unverified_client_report");
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

let invitationRpcBody;
const invitations = loadHandler("../api/fleet-invitations.js", async (table, options = {}) => {
  if (table === "fleets") return [{ id: "fleet-1", company_name: "Safe Transit", plan: "trial" }];
  assert.equal(table, "rpc/create_fleet_invitation");
  assert.equal(options.method, "POST");
  invitationRpcBody = options.body;
  return { id: "11111111-1111-4111-8111-111111111111", email: "driver@example.com", expires_at: new Date(Date.now() + 60000).toISOString() };
});
const createdInvitation = await invoke(invitations, request("POST", { email: "Driver@Example.com", fleet_id: "attacker-fleet", invited_by: "attacker" }));
assert.equal(createdInvitation.status, 201);
assert.equal(invitationRpcBody.p_fleet_id, "fleet-1");
assert.equal(invitationRpcBody.p_owner_user_id, "user-1");
assert.equal(invitationRpcBody.p_email, "driver@example.com");
assert.match(invitationRpcBody.p_token_hash, /^[0-9a-f]{64}$/);
const originalHash = invitationRpcBody.p_token_hash;
const rawInviteToken = createdInvitation.body.invitation.accept_path.split("#token=")[1];
assert.ok(rawInviteToken.length >= 32);
assert.equal(JSON.stringify(invitationRpcBody).includes(rawInviteToken), false, "only a digest may reach the database");
assert.equal(JSON.stringify(createdInvitation.body).includes(originalHash), false);
const replacementId = "22222222-2222-4222-8222-222222222222";
const replacedInvitation = await invoke(invitations, request("POST", { replace_invitation_id: replacementId, email: "attacker@example.com" }));
assert.equal(replacedInvitation.status, 201);
assert.equal(invitationRpcBody.p_replace_invitation_id, replacementId);
assert.equal(invitationRpcBody.p_email, null, "the transaction reuses the stored invited email");
assert.notEqual(invitationRpcBody.p_token_hash, originalHash);

for (const [message, status, retry] of [
  ["active_invitation_exists", 409], ["too_many_pending_invitations", 429],
  ["invitation_rate_limited", 429, "3600"], ["resend_too_soon", 429, "60"],
  ["invitation_not_found", 404], ["fleet_not_found", 403], ["invalid_email", 400],
]) {
  const failed = loadHandler("../api/fleet-invitations.js", async (table) => {
    if (table === "fleets") return [{ id: "fleet-1" }];
    assert.equal(table, "rpc/create_fleet_invitation");
    const error = new Error("database detail"); error.details = { code: "P0001", message }; throw error;
  });
  const result = await invoke(failed, request("POST", { email: "driver@example.com" }));
  assert.equal(result.status, status); assert.equal(result.body.error, message);
  if (retry) assert.equal(result.headers["retry-after"], retry);
}

let invitationListSelect;
const listInvitations = loadHandler("../api/fleet-invitations.js", async (table, options = {}) => {
  if (table === "fleets") return [{ id: "fleet-1", company_name: "Safe Transit", plan: "trial" }];
  invitationListSelect = options.params.select;
  return [{ id: "invite-1", email: "driver@example.com", expires_at: new Date(Date.now() + 60000).toISOString() }];
});
const invitationList = await invoke(listInvitations, request("GET"));
assert.equal(invitationList.status, 200);
assert.equal(invitationListSelect.includes("token_hash"), false, "invitation listings must never select token hashes");


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
const fleetSessionId = "11111111-1111-4111-8111-111111111111";
const fleetSummary = loadHandler("../api/fleet-summary.js", async (table, options = {}) => {
  fleetSummaryCalls.push({ table, options });
  if (table === "fleets") return [{ id: "fleet-1", company_name: "Safe Transit", plan: "trial" }];
  if (table === "drivers") return [{ id: "driver-1", name: "Driver", active: true, vehicle_id: "Van 12" }];
  if (table === "sessions") return [{ id: fleetSessionId, driver_id: "driver-1", safety_score: 74 }];
  if (table === "events") return [{
    id: "event-1",
    session_id: fleetSessionId,
    type: "drowsy",
    fatigue_score: 68,
    confidence: 91,
    latitude: 37.7749,
    longitude: -122.4194,
    created_at: "2026-08-01T17:00:00.000Z",
  }];
  throw new Error(`unexpected fleet summary call: ${table}`);
});
const fleetSummaryResult = await invoke(fleetSummary, request("GET"));
assert.equal(fleetSummaryResult.status, 200);
assert.equal(fleetSummaryCalls[0].options.params.owner_user_id, "eq.user-1");
assert.equal(fleetSummaryCalls[1].options.params.fleet_id, "eq.fleet-1");
assert.equal(fleetSummaryCalls[2].options.params.fleet_id, "eq.fleet-1");
assert.equal(fleetSummaryCalls[3].table, "events");
assert.equal(fleetSummaryCalls[3].options.params.session_id, `in.(${fleetSessionId})`);
assert.doesNotMatch(fleetSummaryCalls[3].options.params.select, /latitude|longitude/i);
assert.equal(fleetSummaryResult.body.telemetry_trust, "unverified_client_report");
assert.equal(fleetSummaryResult.body.events_included, true);
assert.match(fleetSummaryResult.headers["server-timing"], /fleet;dur=\d+, roster;dur=\d+, events;dur=\d+/);
assert.deepEqual(fleetSummaryResult.body.privacy, {
  includes_location: false,
  includes_personal_media: false,
  includes_raw_motion: false,
});
assert.equal(Object.hasOwn(fleetSummaryResult.body.events[0], "latitude"), false);
assert.equal(Object.hasOwn(fleetSummaryResult.body.events[0], "longitude"), false);

const lightweightSummaryCalls = [];
const lightweightSummary = loadHandler("../api/fleet-summary.js", async (table) => {
  lightweightSummaryCalls.push(table);
  if (table === "fleets") return [{ id: "fleet-1", company_name: "Safe Transit", plan: "trial" }];
  if (table === "drivers") return [];
  if (table === "sessions") return [{ id: fleetSessionId, driver_id: "driver-1" }];
  throw new Error("a lightweight fleet refresh must not query events");
});
const lightweightRequest = request("GET");
lightweightRequest.url = "/api/fleet-summary?include_events=0";
const lightweightResult = await invoke(lightweightSummary, lightweightRequest);
assert.equal(lightweightResult.status, 200);
assert.deepEqual(lightweightSummaryCalls, ["fleets", "drivers", "sessions"]);
assert.equal(lightweightResult.body.events_included, false);
assert.deepEqual(lightweightResult.body.events, []);

// Exercise the query's real ordering at the latest-50 boundary. Equal start
// times must select the same sessions as follow-ups, independent of row order.
const orderingDb = new PGlite();
try {
  await orderingDb.exec(`
    create table sessions (id uuid primary key, fleet_id uuid, driver_id uuid,
      started_at timestamptz not null, ended_at timestamptz, average_fatigue numeric,
      max_fatigue numeric, safety_score numeric, alert_count integer, head_nod_count integer);
    create index sessions_fleet_started_id_idx on sessions (fleet_id, started_at desc, id desc);
  `);
  const sessionId = n => `11111111-1111-4111-8111-${n.toString(16).padStart(12, "0")}`;
  const ownedFleetId = "22222222-2222-4222-8222-222222222222";
  const otherFleetId = "33333333-3333-4333-8333-333333333333";
  const driverId = "44444444-4444-4444-8444-444444444444";
  const ownedRows = Array.from({ length: 66 }, (_, i) => ({
    id: sessionId(i + 1), fleet_id: ownedFleetId, driver_id: driverId,
    started_at: i < 3 ? "2026-09-26T12:00:00Z" : i < 63 ? "2026-09-25T12:00:00Z" : "2026-09-24T12:00:00Z",
  }));
  const foreignRows = Array.from({ length: 3 }, (_, i) => ({
    id: sessionId(101 + i), fleet_id: otherFleetId, driver_id: driverId,
    started_at: "2026-09-27T12:00:00Z",
  }));
  const expectedIds = [3, 2, 1, ...Array.from({ length: 47 }, (_, i) => 63 - i)].map(sessionId);
  const eventScopes = [], followupScopes = [];
  const fetchOrderedRows = async (table, { params }) => {
    if (table === "fleets") {
      assert.equal(params.owner_user_id, "eq." + verifiedUser.id);
      return [{ id: ownedFleetId, company_name: "Owned Fleet" }];
    }
    if (table === "drivers") {
      assert.equal(params.fleet_id, "eq." + ownedFleetId);
      return [{ id: driverId, name: "Driver", active: true }];
    }
    if (table === "sessions") {
      assert.equal(params.fleet_id, "eq." + ownedFleetId);
      assert.equal(params.limit, "50");
      assert.doesNotMatch(params.select, /latitude|longitude|location|raw_motion/i);
      const order = params.order.split(",").map(term => {
        const [column, direction] = term.split(".");
        assert.ok(["started_at", "id"].includes(column));
        assert.equal(direction, "desc");
        return `${column} desc`;
      }).join(",");
      return (await orderingDb.query(`select ${params.select} from sessions where fleet_id=$1 order by ${order} limit $2`,
        [ownedFleetId, Number(params.limit)])).rows;
    }
    if (table === "events" || table === "fleet_session_followups") {
      if (table === "events") {
        assert.equal(params.limit, "200");
        assert.doesNotMatch(params.select, /latitude|longitude/i);
        eventScopes.push(params.session_id);
      } else followupScopes.push(params.session_id);
      return [];
    }
    throw new Error(`unexpected ordering fixture query: ${table}`);
  };
  const orderedSummary = loadHandler("../api/fleet-summary.js", fetchOrderedRows);
  const orderedFollowups = loadHandler("../api/fleet-followups.js", fetchOrderedRows);
  for (const rows of [[...ownedRows, ...foreignRows], [...foreignRows, ...ownedRows].reverse()]) {
    await orderingDb.exec("truncate sessions");
    await orderingDb.query(`insert into sessions (id,fleet_id,driver_id,started_at)
      select id,fleet_id,driver_id,started_at from jsonb_to_recordset($1::jsonb)
      as fixture(id uuid,fleet_id uuid,driver_id uuid,started_at timestamptz)`, [JSON.stringify(rows)]);
    const summary = await invoke(orderedSummary, request("GET"));
    const followups = await invoke(orderedFollowups, request("GET"));
    assert.equal(summary.status, 200);
    assert.equal(followups.status, 200);
    assert.deepEqual(summary.body.sessions.map(row => row.id), expectedIds);
    assert.deepEqual(followups.body.sessions.map(row => row.id), expectedIds);
    assert.equal(summary.body.telemetry_trust, "unverified_client_report");
    assert.deepEqual(summary.body.privacy, fleetSummaryResult.body.privacy);
    assert.equal(summary.headers["cache-control"], "no-store");
  }
  const expectedScopes = Array(2).fill(`in.(${expectedIds.join(",")})`);
  assert.deepEqual(eventScopes, expectedScopes, "events must use exactly the selected 50 sessions in both insertion orders");
  assert.deepEqual(followupScopes, expectedScopes, "follow-ups must use the same bounded session selection");
} finally {
  await orderingDb.close();
}

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
const pilotRateCounts = new Map();
const pilotLeads = loadHandler("../api/pilot-leads.js", async (table, options = {}) => {
  if (table === "rpc/check_pilot_lead_rate_limit") {
    const key = options.body.p_rate_key;
    const count = (pilotRateCounts.get(key) || 0) + 1;
    pilotRateCounts.set(key, count);
    return [{ allowed: count <= 5, retry_after_seconds: 900 }];
  }
  assert.equal(table, "pilot_leads");
  storedLead = options.body;
  return [{ id: "lead-1", ...options.body }];
});

const validLead = {
  name: "Test Driver",
  company: "Test Fleet",
  email: "driver@example.com",
  source: "browser-controlled-source",
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
assert.equal(storedLead.source, "pilot-signup-page", "browser callers must not choose arbitrary lead sources");
const paidRollout = await invoke(pilotLeads, request("POST", {
  ...validLead,
  interest: "paid_rollout",
  plan: "starter",
  timeline: "within-30-days",
  goal: "manager-workflow",
  message: "We want a small-fleet rollout.",
}, "203.0.113.24"));
assert.equal(paidRollout.status, 200);
assert.equal(storedLead.source, "paid-rollout-page", "the server must preserve the allowlisted paid-rollout conversion path");
assert.match(storedLead.message, /Starter — \$9 \/ month/);
assert.match(storedLead.message, /Desired start: Within 30 days/);
assert.match(storedLead.message, /Primary goal: Reduce manager review time/);
assert.match(storedLead.message, /We want a small-fleet rollout\./);

const freeTrial = await invoke(pilotLeads, request("POST", {
  ...validLead,
  interest: "free_trial",
  plan: "free-trial",
  timeline: "one-to-three-months",
  goal: "participation",
}, "203.0.113.25"));
assert.equal(freeTrial.status, 200);
assert.equal(storedLead.source, "free-trial-page");
assert.match(storedLead.message, /Free Fleet Trial — \$0 \/ 30 days/);

const inheritedQualification = Object.assign(Object.create({
  plan: "constructor",
  timeline: "__proto__",
  goal: "toString",
}), validLead, { message: "Customer note only." });
const genericPilot = await invoke(pilotLeads, request("POST", inheritedQualification, "203.0.113.26"));
assert.equal(genericPilot.status, 200, "generic pilot requests must not coerce inherited qualification keys");
assert.equal(storedLead.message, "Customer note only.");

for (const [index, invalidFields] of [
  { plan: "enterprise", timeline: "within-30-days", goal: "manager-workflow" },
  { plan: "constructor", timeline: "within-30-days", goal: "manager-workflow" },
  { plan: "starter", timeline: "__proto__", goal: "manager-workflow" },
  { plan: "starter", timeline: "within-30-days", goal: "toString" },
  { plan: ["starter"], timeline: "within-30-days", goal: "manager-workflow" },
  { plan: { toString: () => "starter" }, timeline: "within-30-days", goal: "manager-workflow" },
  { plan: "starter", timeline: "", goal: "manager-workflow" },
  { interest: "free_trial", plan: "starter", timeline: "within-30-days", goal: "manager-workflow" },
  { interest: "paid_rollout", plan: "free-trial", timeline: "within-30-days", goal: "manager-workflow" },
].entries()) {
  const invalidCommercialLead = await invoke(pilotLeads, request("POST", {
    ...validLead,
    interest: "paid_rollout",
    ...invalidFields,
  }, `203.0.113.${40 + index}`));
  assert.equal(invalidCommercialLead.status, 400, `commercial qualification case ${index + 1} must be rejected`);
}

const unavailableRateLimit = loadHandler("../api/pilot-leads.js", async (table) => {
  assert.equal(table, "rpc/check_pilot_lead_rate_limit");
  throw new Error("rate store offline");
});
const unavailableRateResult = await invoke(unavailableRateLimit, request("POST", validLead, "203.0.113.23"));
assert.equal(unavailableRateResult.status, 503, "pilot contact writes must fail closed if durable throttling is unavailable");
assert.equal(unavailableRateResult.body.error, "rate_limit_unavailable");

// A failed or uncertain configured-store write must not send contact data to
// a second destination. Also cover an empty success response (not saved).
const originalFetch = globalThis.fetch;
process.env.PILOT_LEADS_WEBHOOK_URL = "https://webhook.example.invalid/fixture";
const webhookRequests = [];
globalThis.fetch = async (...args) => { webhookRequests.push(args); return { ok: true }; };
try {
  for (const outcome of ["reject", "empty"]) {
    const failedStore = loadHandler("../api/pilot-leads.js", async (table) => {
      if (table === "rpc/check_pilot_lead_rate_limit") return [{ allowed: true }];
      assert.equal(table, "pilot_leads");
      if (outcome === "reject") throw new Error("fixture uncertain insert result");
      return [];
    });
    const result = await invoke(failedStore, request("POST", validLead, "203.0.113.99"));
    assert.equal(result.status, 502); assert.equal(result.body.error, "storage_unavailable");
  }
  assert.deepEqual(webhookRequests, [], "contact PII must stay with the configured primary store even if its outcome is uncertain");
} finally { globalThis.fetch = originalFetch; delete process.env.PILOT_LEADS_WEBHOOK_URL; }

let rateLimited;
for (let i = 0; i < 6; i += 1) {
  rateLimited = await invoke(pilotLeads, request("POST", { ...validLead, startedAt: "" }, "203.0.113.30"));
}
assert.equal(rateLimited.status, 429, "submission bursts must be rate limited");
assert.ok(Number(rateLimited.headers["retry-after"]) > 0);

console.log("Occulert API security tests passed.");
