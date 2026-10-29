// POST /api/events -> log a single drowsiness/distraction event tied to a session.
// Requires a Supabase Auth access token in the Authorization: Bearer header.
// Validates session ownership and occurrence time before storing client-reported telemetry.
// Storage requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; see BACKEND_SETUP.md.

const supabaseLib = require("./_lib/supabase");
const { supabaseErrorStatus } = require("./_lib/supabase-errors");
const { validTimestamp, compareTimestamps } = require("./_lib/fleet-history-cursor");
const pgFetch = supabaseLib.pgFetch;
const verifyAccessToken = supabaseLib.verifyAccessToken;
const bearerToken = supabaseLib.bearerToken;
const { isUuid, numberOrNull, strictNumberOrNull, validJsonBody } = require("./_lib/validation");

const { json } = require("./_lib/responses");

const ALLOWED_TYPES = ["drowsy", "distracted", "head_nod", "yawn", "phone_use", "ok_check_in", "emergency"];

module.exports = async function handler(request, response) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(response, 501, {
      ok: false,
      error: "backend_not_configured",
      message: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable event storage. See BACKEND_SETUP.md.",
    });
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return json(response, 405, { ok: false, error: "method_not_allowed" });
  }

  let user;
  try {
    user = await verifyAccessToken(bearerToken(request), { cachedIdentity: true });
    if (!user) {
      return json(response, 401, { ok: false, error: "unauthorized" });
    }

    if (!validJsonBody(request)) {
      return json(response, 415, { ok: false, error: "invalid_json_body" });
    }

    const body = typeof request.body === "object" && request.body ? request.body : {};
    const type = typeof body.type === "string" ? body.type : "";
    if (!body.session_id || ALLOWED_TYPES.indexOf(type) === -1) {
      return json(response, 400, { ok: false, error: "invalid_event" });
    }
    if (!isUuid(body.session_id)) return json(response, 400, { ok: false, error: "invalid_session_id" });
    // Do not silently ignore an idempotency key while the migration gate is off:
    // that would let a retry-capable client create duplicates through legacy POST.
    const keyed = Object.hasOwn(body, "client_event_id");
    if (keyed && !isUuid(body.client_event_id)) {
      return json(response, 400, { ok: false, error: "invalid_client_event_id" });
    }
    if (keyed && process.env.OCCULERT_EVENT_IDEMPOTENCY_ENABLED !== "true") {
      return json(response, 503, { ok: false, error: "event_idempotency_not_enabled" });
    }
    if (process.env.OCCULERT_EVENT_IDEMPOTENCY_ENABLED === "true") {
      // Preserve timezone/microsecond precision; PostgreSQL canonicalizes the
      // accepted instant. Omitted time is a stable null intent, not retry time.
      const occurredAt = Object.hasOwn(body, "occurred_at") ? body.occurred_at : null;
      if (Object.hasOwn(body, "occurred_at") && !validTimestamp(occurredAt)) {
        return json(response, 400, { ok: false, error: "invalid_occurred_at" });
      }
      const result = await pgFetch("rpc/record_idempotent_event", {
        method: "POST",
        body: {
          p_user_id: user.id, p_session_id: body.session_id,
          p_client_event_id: keyed ? body.client_event_id : null,
          p_type: type, p_fatigue_score: numberOrNull(body.fatigue_score, 0, 100),
          p_confidence: numberOrNull(body.confidence, 0, 100),
          p_latitude: strictNumberOrNull(body.latitude, -90, 90),
          p_longitude: strictNumberOrNull(body.longitude, -180, 180),
          p_occurred_at: occurredAt,
        },
      });
      const statuses = { invalid_event: 400, invalid_occurred_at: 400,
        session_not_found: 404, session_ended: 409, event_id_conflict: 409,
        event_rate_limited: 429, session_event_limit: 429 };
      if (result && Object.hasOwn(statuses, result.error)) {
        if (result.error === "event_rate_limited") {
          response.setHeader("Retry-After", String(Math.max(1, Math.min(60, Number(result.retry_after) || 60))));
        }
        return json(response, statuses[result.error], { ok: false, error: result.error });
      }
      if (!result || !isUuid(result.event?.id)
        || result.event.session_id?.toLowerCase() !== body.session_id.toLowerCase()
        || typeof result.replayed !== "boolean"
        || (keyed ? result.client_event_id?.toLowerCase() !== body.client_event_id.toLowerCase() : result.client_event_id !== null)) {
        return json(response, 502, { ok: false, error: "event_not_saved" });
      }
      return json(response, 200, { ok: true, event: result.event,
        client_event_id: result.client_event_id, replayed: result.replayed,
        telemetry_trust: "unverified_client_report",
        message: "Client-reported telemetry is not independently measured or attested.",
      });
    }
    const drivers = await pgFetch("drivers", {
      params: { select: "id", user_id: "eq." + user.id, limit: "1" },
    });
    const driver = drivers[0];
    if (!driver) {
      return json(response, 403, { ok: false, error: "driver_profile_not_found" });
    }

    const sessions = await pgFetch("sessions", {
      params: { select: "id,started_at,ended_at", id: "eq." + body.session_id, driver_id: "eq." + driver.id, limit: "1" },
    });
    if (!sessions.length) {
      return json(response, 404, { ok: false, error: "session_not_found" });
    }

    const session = sessions[0];
    const now = Date.now();
    const nowTimestamp = new Date(now).toISOString();
    const startedAt = session.started_at;
    const endedAt = session.ended_at;
    if (!validTimestamp(startedAt) || (endedAt !== null && !validTimestamp(endedAt))) {
      throw new Error("invalid_session_time");
    }
    if (endedAt !== null && compareTimestamps(endedAt, new Date(now - 120000).toISOString()) < 0) {
      return json(response, 409, { ok: false, error: "session_ended" });
    }
    const upperBound = endedAt !== null && compareTimestamps(endedAt, nowTimestamp) < 0 ? endedAt : nowTimestamp;
    if (compareTimestamps(startedAt, upperBound) > 0) throw new Error("invalid_session_time");
    // Legacy clients omit occurrence time. During the delivery grace, never
    // stamp their event after the stored session end.
    let occurredAt = upperBound;
    if (Object.hasOwn(body, "occurred_at")) {
      const timestamp = body.occurred_at;
      if (!validTimestamp(timestamp) || compareTimestamps(timestamp, startedAt) < 0
        || compareTimestamps(timestamp, upperBound) > 0) {
        return json(response, 400, { ok: false, error: "invalid_occurred_at" });
      }
      // Keep accepted timezone and microsecond precision for Postgres.
      occurredAt = timestamp;
    }

    const created = await pgFetch("events", {
      method: "POST",
      body: {
        session_id: body.session_id,
        type: type,
        fatigue_score: numberOrNull(body.fatigue_score, 0, 100),
        confidence: numberOrNull(body.confidence, 0, 100),
        // GPS is opt-in only; omit lat/lng entirely unless the driver has
        // explicitly enabled location sharing on the client.
        latitude: strictNumberOrNull(body.latitude, -90, 90),
        longitude: strictNumberOrNull(body.longitude, -180, 180),
        created_at: occurredAt,
      },
    });
    return json(response, 200, {
      ok: true,
      event: created[0],
      telemetry_trust: "unverified_client_report",
      message: "Client-reported telemetry is not independently measured or attested.",
    });
  } catch (error) {
    return json(response, supabaseErrorStatus(error), { ok: false, error: "supabase_error" });
  }
};

module.exports = require("./_lib/provider-budget").withProviderBudget(module.exports);
