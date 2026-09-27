// GET /api/fleet-session-history: bounded owner-only session pagination.
// Cursors exclude newer ordering tuples but are not transactional snapshots:
// concurrent edits/deletions can still change the visible history.
const { pgFetch, verifyAccessToken, bearerToken } = require('./_lib/supabase');
const { requestCursor, encodeCursor, validTimestamp, validTuple, compareTuples, isUuid } = require('./_lib/fleet-history-cursor');
const PAGE_SIZE = 50;
const SESSION_SELECT = 'id,driver_id,started_at,ended_at,average_fatigue,max_fatigue,safety_score,alert_count,head_nod_count';

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

function validateSessionRows(rows, cursor) {
  if (!Array.isArray(rows) || rows.length > PAGE_SIZE + 1) throw invalidResponse();
  const seen = new Set();
  let previous;
  for (const session of rows) {
    if (!session || typeof session !== 'object' || !validTuple(tuple(session))
        || (session.driver_id !== null && !isUuid(session.driver_id))
        || (session.ended_at !== null && !validTimestamp(session.ended_at))) throw invalidResponse();
    const key = session.id.toLowerCase(), boundary = tuple(session);
    if (seen.has(key) || (previous && compareTuples(boundary, previous) >= 0)
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
    const cursor = requestCursor(request);
    // Derive ownership afresh for every page. No fleet/driver scope is accepted
    // from the request or cursor, even though the query uses a service-role key.
    const fleets = await pgFetch('fleets', {
      params: { select: 'id,company_name', owner_user_id: 'eq.' + user.id, limit: '1' },
    });
    if (!Array.isArray(fleets) || fleets.length > 1) throw invalidResponse();
    const fleet = fleets[0];
    if (!fleet) return json(response, 403, { ok: false, error: 'fleet_not_found' });
    if (!isUuid(fleet.id) || typeof fleet.company_name !== 'string') throw invalidResponse();

    const params = {
      select: SESSION_SELECT,
      fleet_id: 'eq.' + fleet.id,
      order: 'started_at.desc,id.desc',
      limit: String(PAGE_SIZE + 1),
    };
    // The initial page establishes the newest tuple. Every following page
    // includes both its inclusive upper bound and exclusive last-seen tuple.
    if (cursor) params.and = '(' + upperBoundary(cursor.snapshot) + ',' + beforeBoundary(cursor.before) + ')';
    const rows = await pgFetch('sessions', { params });
    validateSessionRows(rows, cursor);
    const selected = rows.slice(0, PAGE_SIZE);
    let hasMore = rows.length > PAGE_SIZE;
    const snapshot = cursor ? cursor.snapshot : selected.length ? tuple(selected[0]) : null;
    if (!hasMore && selected.length) {
      // PostgREST may cap a response below the requested 51 rows. A short
      // page alone therefore cannot establish the end of history. Probe only
      // one older tuple, within this same authorized fleet and upper boundary.
      const before = tuple(selected[selected.length - 1]);
      const probe = await pgFetch('sessions', {
        params: { select: 'id,started_at', fleet_id: 'eq.' + fleet.id,
          order: 'started_at.desc,id.desc', limit: '1',
          and: '(' + upperBoundary(snapshot) + ',' + beforeBoundary(before) + ')' },
      });
      if (!Array.isArray(probe) || probe.length > 1) throw invalidResponse();
      if (probe.length) {
        if (!probe[0] || !validTuple(tuple(probe[0]))
            || compareTuples(tuple(probe[0]), snapshot) > 0
            || compareTuples(tuple(probe[0]), before) >= 0) throw invalidResponse();
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
    }));
    return json(response, 200, {
      ok: true,
      fleet: { id: fleet.id, company_name: fleet.company_name.slice(0, 160) },
      sessions,
      has_more: hasMore,
      next_cursor: hasMore ? encodeCursor(snapshot, tuple(selected[selected.length - 1])) : null,
      telemetry_trust: 'unverified_client_report',
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
