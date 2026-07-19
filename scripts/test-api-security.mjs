import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const libPath = require.resolve("../api/_lib/supabase.js");

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
delete process.env.PILOT_LEADS_WEBHOOK_URL;

function loadHandler(path, pgFetch) {
  const handlerPath = require.resolve(path);
  delete require.cache[handlerPath];
  require.cache[libPath] = {
    id: libPath,
    filename: libPath,
    loaded: true,
    exports: {
      pgFetch,
      verifyAccessToken: async () => ({ id: "user-1" }),
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
