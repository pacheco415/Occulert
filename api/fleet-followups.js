const { pgFetch, verifyAccessToken, bearerToken } = require('./_lib/supabase');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['open', 'in_progress', 'reviewed']);
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(res, 501, { ok: false, error: 'backend_not_configured' });
  }
  try {
    const user = await verifyAccessToken(bearerToken(req));
    if (!user) return json(res, 401, { ok: false, error: 'unauthorized' });
    if (!user.email || !(user.email_confirmed_at || user.confirmed_at)) {
      return json(res, 403, { ok: false, error: 'email_not_verified' });
    }
    const [fleet] = await pgFetch('fleets', { params: { select: 'id', owner_user_id: 'eq.' + user.id, limit: '1' } });
    if (!fleet) return json(res, 403, { ok: false, error: 'fleet_not_found' });
    if (req.method === 'POST') {
      const body = req.body;
      if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json') ||
          !body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > 1024) {
        return json(res, 400, { ok: false, error: 'invalid_body' });
      }
      if (Object.keys(body).some(key => !['session_id', 'status', 'expected_version'].includes(key)) ||
          typeof body.session_id !== 'string' || !UUID.test(body.session_id) || !STATUSES.has(body.status) ||
          !Number.isInteger(body.expected_version) || body.expected_version < 0 || body.expected_version > 2147483646) {
        return json(res, 400, { ok: false, error: 'invalid_followup' });
      }
      const rows = await pgFetch('rpc/save_fleet_session_followup', {
        method: 'POST', body: { p_actor_id: user.id, p_session_id: body.session_id,
          p_status: body.status, p_expected_version: body.expected_version },
      });
      if (!rows.length) return json(res, 409, { ok: false, error: 'followup_changed' });
      const saved = rows[0];
      return json(res, 200, { ok: true, followup: { session_id: saved.session_id, status: saved.status, version: saved.version, updated_at: saved.updated_at } });
    }
    const [sessions, drivers] = await Promise.all([
      pgFetch('sessions', { params: { select: 'id,driver_id,started_at,ended_at,alert_count', fleet_id: 'eq.' + fleet.id, order: 'started_at.desc,id.desc', limit: '50' } }),
      pgFetch('drivers', { params: { select: 'id,name', fleet_id: 'eq.' + fleet.id } }),
    ]);
    const ids = sessions.map(session => session.id).filter(id => UUID.test(String(id)));
    const outcomes = ids.length ? await pgFetch('fleet_session_followups', {
      params: { select: 'session_id,status,version,updated_at', session_id: 'in.(' + ids.join(',') + ')' },
    }) : [];
    const names = new Map(drivers.map(driver => [driver.id, driver.name]));
    const saved = new Map(outcomes.map(outcome => [outcome.session_id, outcome]));
    return json(res, 200, { ok: true, limit: 50, sessions: sessions.map(session => ({
      id: session.id, driver_name: names.get(session.driver_id) || 'Driver', started_at: session.started_at,
      ended_at: session.ended_at, alert_count: session.alert_count,
      followup: saved.get(session.id) || { session_id: session.id, status: 'open', version: 0, updated_at: null },
    })) });
  } catch (error) {
    const code = error && error.details && error.details.code;
    if (code === 'P0002') return json(res, 404, { ok: false, error: 'session_not_found' });
    if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(code)) {
      return json(res, 503, { ok: false, error: 'followups_not_enabled' });
    }
    return json(res, 502, { ok: false, error: 'followups_unavailable' });
  }
};
