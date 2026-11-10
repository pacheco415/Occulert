// A driver reports only the outcome of the existing parked output check.
// The verified actor selects current driver/fleet membership inside the RPC.
// Owners can read aggregate counts; this never attests fitness to drive.
const { pgFetch, verifyAccessToken, bearerToken } = require('../supabase');
const { supabaseErrorStatus } = require('../supabase-errors');
const { isUuid, isJsonObject, validJsonBody } = require('../validation');
const { validTimestamp } = require('../fleet-history-cursor');
const { json: sendJson } = require('../responses');

const PLATFORMS = new Set(['web', 'ios', 'android']);
const FIELDS = ['completed_at', 'platform', 'confirmed'];

function json(response, status, body) {
  response.setHeader('Vary', 'Authorization');
  return sendJson(response, status, body);
}

function noQuery(request) {
  try {
    if (request.url && new URL(request.url, 'https://www.occulert.com').searchParams.size) return false;
  } catch { return false; }
  return request.query === undefined || isJsonObject(request.query) && Object.keys(request.query).length === 0;
}

function validCheck(value) {
  return isJsonObject(value) && Object.keys(value).length === FIELDS.length &&
    FIELDS.every(key => Object.hasOwn(value, key)) && validTimestamp(value.completed_at) &&
    PLATFORMS.has(value.platform) && typeof value.confirmed === 'boolean';
}

module.exports = async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST');
    return json(response, 405, { ok: false, error: 'method_not_allowed' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(response, 501, { ok: false, error: 'backend_not_configured' });
  }
  if (!noQuery(request)) return json(response, 400, { ok: false, error: 'invalid_query' });
  try {
    const user = await verifyAccessToken(bearerToken(request), { cachedIdentity: request.method === 'GET' });
    if (!user) return json(response, 401, { ok: false, error: 'unauthorized' });
    if (!isUuid(user.id)) throw new Error('invalid_user');

    if (request.method === 'GET') {
      const counts = await pgFetch('rpc/fleet_parked_alert_check_counts', {
        method: 'POST', body: { p_actor_id: user.id },
      });
      if (counts === null) return json(response, 403, { ok: false, error: 'fleet_not_found' });
      if (!isJsonObject(counts) || !isUuid(counts.fleet_id) || !Number.isSafeInteger(counts.active_driver_count) ||
          !Number.isSafeInteger(counts.confirmed_driver_count) || counts.active_driver_count < 0 ||
          counts.confirmed_driver_count < 0 || counts.confirmed_driver_count > counts.active_driver_count) {
        throw new Error('invalid_counts');
      }
      return json(response, 200, {
        ok: true, fleet_id: counts.fleet_id, active_driver_count: counts.active_driver_count,
        confirmed_driver_count: counts.confirmed_driver_count, telemetry_trust: 'unverified_client_report',
      });
    }

    if (!validJsonBody(request, 512)) return json(response, 415, { ok: false, error: 'invalid_json_body' });
    const body = request.body;
    if (!validCheck(body)) return json(response, 400, { ok: false, error: 'invalid_parked_alert_check' });
    const completed = Date.parse(body.completed_at), now = Date.now();
    if (completed < now - 86400000 || completed > now + 300000) {
      return json(response, 400, { ok: false, error: 'invalid_parked_alert_check' });
    }
    const result = await pgFetch('rpc/record_parked_alert_check', {
      method: 'POST', body: {
        p_actor_id: user.id, p_completed_at: body.completed_at,
        p_platform: body.platform, p_confirmed: body.confirmed,
      },
    });
    if (result?.error === 'driver_not_in_active_fleet') {
      return json(response, 403, { ok: false, error: result.error });
    }
    if (result?.error === 'invalid_parked_alert_check') {
      return json(response, 400, { ok: false, error: result.error });
    }
    if (['membership_changed', 'stale_parked_alert_check'].includes(result?.error)) {
      return json(response, 409, { ok: false, error: result.error });
    }
    if (!validCheck(result?.check) || Date.parse(result.check.completed_at) !== completed ||
        result.check.platform !== body.platform || result.check.confirmed !== body.confirmed) {
      throw new Error('invalid_check_response');
    }
    return json(response, 200, { ok: true, check: {
      completed_at: new Date(completed).toISOString(), platform: result.check.platform, confirmed: result.check.confirmed,
    }, telemetry_trust: 'unverified_client_report' });
  } catch (error) {
    if (['42883', 'PGRST202', 'PGRST205'].includes(error?.details?.code)) {
      return json(response, 503, { ok: false, error: 'parked_alert_checks_not_enabled' });
    }
    return json(response, supabaseErrorStatus(error), { ok: false, error: 'parked_alert_checks_unavailable' });
  }
};

module.exports = require('../provider-budget').withProviderBudget(module.exports);
