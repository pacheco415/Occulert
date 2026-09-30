// GET /api/fleet-session-history: bounded owner-only session pagination.
// Cursors exclude newer ordering tuples but are not transactional snapshots:
// concurrent edits/deletions can still change the visible history.
const { pgFetch, verifyAccessToken, bearerToken } = require('./_lib/supabase');
const { requestHistoryQuery, encodeCursor, validTimestamp, validTuple, compareTuples, compareTimestamps, isUuid } = require('./_lib/fleet-history-cursor');
const PAGE_SIZE = 50;
const SESSION_SELECT = 'id,driver_id,started_at,ended_at,average_fatigue,max_fatigue,safety_score,alert_count,head_nod_count,detector_pipeline,detector_version,app_version';
const PIPELINES = new Set(['web_mediapipe_ear', 'ios_mlkit_eye_probability', 'android_mlkit_eye_probability']);

function safeVersion(value) {
  return typeof value === 'string' && value.length <= 80 && /^[a-zA-Z0-9._() -]+$/.test(value) ? value : null;
}

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Vary', 'Authorization');
  response.end(JSON.stringify(body));
}

function invalidResponse() {
  const error = new Error('fleet_history_invalid_response');
  error.code = 'fleet_history_invalid_response';
  return error;
}

function tuple(session) {
  return { started_at: session.started_at, id: session.id };
}

function upperBoundary(snapshot) {
  // Timestamp values contain PostgREST-reserved punctuation. The validated
  // grammar excludes quotes/backslashes, so literal quoting preserves the
  // database text exactly; pgFetch encodes the complete parameter once.
  const timestamp = '"' + snapshot.started_at + '"';
  return 'or(started_at.lt.' + timestamp
    + ',and(started_at.eq.' + timestamp + ',id.lte.' + snapshot.id + '))';
}

function beforeBoundary(before) {
  const timestamp = '"' + before.started_at + '"';
  return 'or(started_at.lt.' + timestamp
    + ',and(started_at.eq.' + timestamp + ',id.lt.' + before.id + '))';
}

function validateSessionRows(rows, cursor, filters) {
  if (!Array.isArray(rows) || rows.length > PAGE_SIZE + 1) throw invalidResponse();
  const seen = new Set();
  let previous;
  for (const session of rows) {
    if (!session || typeof session !== 'object' || !validTuple(tuple(session))
        || (session.driver_id !== null && !isUuid(session.driver_id))
        || (session.ended_at !== null && !validTimestamp(session.ended_at))) throw invalidResponse();
    const key = session.id.toLowerCase(), boundary = tuple(session);
    if (seen.has(key) || (previous && compareTuples(boundary, previous) >= 0)
        || (filters.driver_id && (!session.driver_id || session.driver_id.toLowerCase() !== filters.driver_id.toLowerCase()))
        || (filters.from && compareTimestamps(session.started_at, filters.from) < 0)
        || (filters.to && compareTimestamps(session.started_at, filters.to) >= 0)
        || (cursor && (compareTuples(boundary, cursor.snapshot) > 0
          || compareTuples(boundary, cursor.before) >= 0))) throw invalidResponse();
    seen.add(key);
    previous = boundary;
  }
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return json(response, 405, { ok: false, error: 'method_not_allowed' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(response, 501, { ok: false, error: 'backend_not_configured' });
  }
  try {
    const user = await verifyAccessToken(bearerToken(request));
    if (!user) return json(response, 401, { ok: false, error: 'unauthorized' });
    if (!isUuid(user.id)) throw invalidResponse();
    const query = requestHistoryQuery(request), cursor = query.cursor, filters = query.filters;
    // Derive ownership afresh for every page. No fleet/driver scope is accepted
    // from the request or cursor, even though the query uses a service-role key.
    const fleets = await pgFetch('fleets', {
      params: { select: 'id,company_name', owner_user_id: 'eq.' + user.id, limit: '1' },
    });
    if (!Array.isArray(fleets) || fleets.length > 1) throw invalidResponse();
    const fleet = fleets[0];
    if (!fleet) return json(response, 403, { ok: false, error: 'fleet_not_found' });
    if (!isUuid(fleet.id) || typeof fleet.company_name !== 'string') throw invalidResponse();

    // The selector is populated only from this owner's roster. Keep it in the
    // response so users can filter before loading hundreds of session rows.
    const roster = await pgFetch('drivers', {
      params: { select: 'id,name', fleet_id: 'eq.' + fleet.id, order: 'name.asc,id.asc', limit: '1001' },
    });
    if (!Array.isArray(roster) || roster.length > 1001 ||
        roster.some(driver => !driver || !isUuid(driver.id) || typeof driver.name !== 'string')) throw invalidResponse();
    let driverFilterComplete = roster.length <= 1000;
    const driverOptions = roster.slice(0, 1000).map(driver => ({ id: driver.id, name: driver.name.slice(0, 80) }));
    if (filters.driver_id && !roster.some(driver => driver.id.toLowerCase() === filters.driver_id.toLowerCase())) {
      // A capped selector is not proof that a driver is outside this fleet.
      const exact = await pgFetch('drivers', { params: { select: 'id,name', fleet_id: 'eq.' + fleet.id,
        id: 'eq.' + filters.driver_id, limit: '1' } });
      if (!Array.isArray(exact) || exact.length > 1) throw invalidResponse();
      if (!exact.length) return json(response, 400, { ok: false, error: 'invalid_driver' });
      if (!isUuid(exact[0].id) || exact[0].id.toLowerCase() !== filters.driver_id.toLowerCase() ||
          typeof exact[0].name !== 'string') throw invalidResponse();
      // Keep the selected driver present without exceeding the bounded list.
      const selectedDriver = { id: exact[0].id, name: exact[0].name.slice(0, 80) };
      if (driverOptions.length < 1000) driverOptions.push(selectedDriver);
      else driverOptions[driverOptions.length - 1] = selectedDriver;
      driverFilterComplete = false;
    }

    const params = {
      select: SESSION_SELECT,
      fleet_id: 'eq.' + fleet.id,
      order: 'started_at.desc,id.desc',
      limit: String(PAGE_SIZE + 1),
    };
    if (filters.driver_id) params.driver_id = 'eq.' + filters.driver_id;
    const conditions = [];
    if (filters.from) conditions.push('started_at.gte."' + filters.from + '"');
    if (filters.to) conditions.push('started_at.lt."' + filters.to + '"');
    // The initial page establishes the newest tuple. Every following page
    // includes both its inclusive upper bound and exclusive last-seen tuple.
    if (cursor) conditions.push(upperBoundary(cursor.snapshot), beforeBoundary(cursor.before));
    if (conditions.length) params.and = '(' + conditions.join(',') + ')';
    const rows = await pgFetch('sessions', { params });
    validateSessionRows(rows, cursor, filters);
    const selected = rows.slice(0, PAGE_SIZE);
    let hasMore = rows.length > PAGE_SIZE;
    const snapshot = cursor ? cursor.snapshot : selected.length ? tuple(selected[0]) : null;
    if (!hasMore && selected.length) {
      // PostgREST may cap a response below the requested 51 rows. A short
      // page alone therefore cannot establish the end of history. Probe only
      // one older tuple, within this same authorized fleet and upper boundary.
      const before = tuple(selected[selected.length - 1]);
      const probeParams = { select: 'id,started_at', fleet_id: 'eq.' + fleet.id,
        order: 'started_at.desc,id.desc', limit: '1' };
      if (filters.driver_id) probeParams.driver_id = 'eq.' + filters.driver_id;
      probeParams.and = '(' + [...conditions.filter(condition => !condition.startsWith('or(')),
        upperBoundary(snapshot), beforeBoundary(before)].join(',') + ')';
      const probe = await pgFetch('sessions', { params: probeParams });
      if (!Array.isArray(probe) || probe.length > 1) throw invalidResponse();
      if (probe.length) {
        if (!probe[0] || !validTuple(tuple(probe[0]))
            || compareTuples(tuple(probe[0]), snapshot) > 0
            || compareTuples(tuple(probe[0]), before) >= 0 ||
            filters.from && compareTimestamps(probe[0].started_at, filters.from) < 0 ||
            filters.to && compareTimestamps(probe[0].started_at, filters.to) >= 0) throw invalidResponse();
        hasMore = true;
      }
    }

    // Resolve only names referenced by the displayed page, in the same fleet.
    // The look-ahead row and unrelated roster records are never requested.
    const driverIds = [...new Set(selected.map(session => session.driver_id)
      .filter(isUuid).map(id => id.toLowerCase()))];
    const names = new Map();
    if (driverIds.length) {
      const drivers = await pgFetch('drivers', {
        params: { select: 'id,name', fleet_id: 'eq.' + fleet.id,
          id: 'in.(' + driverIds.join(',') + ')', limit: String(PAGE_SIZE) },
      });
      if (!Array.isArray(drivers) || drivers.length > PAGE_SIZE) throw invalidResponse();
      const requested = new Set(driverIds);
      for (const driver of drivers) {
        if (!driver || !isUuid(driver.id) || !requested.has(driver.id.toLowerCase())) throw invalidResponse();
        if (names.has(driver.id.toLowerCase())) throw invalidResponse();
        names.set(driver.id.toLowerCase(), typeof driver.name === 'string' && driver.name ? driver.name.slice(0, 80) : 'Driver');
      }
    }
    const sessions = selected.map(session => ({
      id: session.id,
      driver_id: session.driver_id,
      driver_name: session.driver_id ? names.get(session.driver_id.toLowerCase()) || 'Driver' : 'Driver',
      started_at: session.started_at,
      ended_at: session.ended_at,
      average_fatigue: session.average_fatigue,
      max_fatigue: session.max_fatigue,
      safety_score: session.safety_score,
      alert_count: session.alert_count,
      head_nod_count: session.head_nod_count,
      detector_pipeline: PIPELINES.has(session.detector_pipeline) ? session.detector_pipeline : null,
      detector_version: safeVersion(session.detector_version),
      app_version: safeVersion(session.app_version),
    }));
    return json(response, 200, {
      ok: true,
      fleet: { id: fleet.id, company_name: fleet.company_name.slice(0, 160) },
      drivers: driverOptions,
      driver_filter_complete: driverFilterComplete,
      filters,
      sessions,
      has_more: hasMore,
      next_cursor: hasMore ? encodeCursor(snapshot, tuple(selected[selected.length - 1]), filters) : null,
      telemetry_trust: 'unverified_client_report',
      detector_provenance_trust: 'client_declared',
      privacy: { includes_location: false, includes_personal_media: false, includes_raw_motion: false },
    });
  } catch (error) {
    if (error && ['invalid_query', 'invalid_cursor'].includes(error.code)) {
      return json(response, 400, { ok: false, error: error.code });
    }
    return json(response, 502, { ok: false,
      error: error && error.code === 'fleet_history_invalid_response'
        ? 'fleet_history_invalid_response' : 'fleet_history_unavailable' });
  }
};
