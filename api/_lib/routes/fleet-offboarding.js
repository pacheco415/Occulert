const { pgFetch, verifyAccessToken, bearerToken } = require('../supabase');
const { supabaseErrorStatus } = require('../supabase-errors');
const { json } = require('../responses');
const { isUuid, validJsonBody } = require('../validation');

module.exports = async function handler(request, response) {
  const url = new URL(request.url, 'https://occulert.invalid');
  const membership = url.pathname === '/api/fleet-membership';
  const allowed = membership ? ['GET', 'POST'] : ['DELETE'];
  if (!allowed.includes(request.method)) {
    response.setHeader('Allow', allowed.join(', '));
    return json(response, 405, { ok: false, error: 'method_not_allowed' });
  }
  if ([...url.searchParams.keys()].length || Object.keys(request.query || {}).length) {
    return json(response, 400, { ok: false, error: 'invalid_query' });
  }
  if (process.env.OCCULERT_FLEET_OFFBOARDING_ENABLED !== 'true') {
    return json(response, 501, { ok: false, error: 'offboarding_not_enabled' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(response, 501, { ok: false, error: 'backend_not_configured' });
  }
  try {
    // Membership changes use fresh identity verification, never a client actor.
    const user = await verifyAccessToken(bearerToken(request));
    if (!user) return json(response, 401, { ok: false, error: 'unauthorized' });
    if (!isUuid(user.id)) throw new Error('invalid_user');
    if (request.method === 'GET') {
      const drivers = await pgFetch('drivers', {
        params: { select: 'id,fleet_id', user_id: 'eq.' + user.id, limit: '1' },
      });
      if (!Array.isArray(drivers) || drivers.length > 1 || drivers.some(driver =>
        !driver || !isUuid(driver.id) || driver.fleet_id !== null && !isUuid(driver.fleet_id))) {
        throw new Error('invalid_membership');
      }
      return json(response, 200, { ok: true, membership: drivers[0] || null });
    }
    if (!validJsonBody(request, 2048)) return json(response, 415, { ok: false, error: 'invalid_json_body' });
    const body = request.body;
    if (body.confirm !== true) return json(response, 400, { ok: false, error: 'confirmation_required' });
    const id = membership ? body.fleet_id : body.driver_id;
    if (!isUuid(id)) return json(response, 400, { ok: false, error: membership ? 'invalid_fleet_id' : 'invalid_driver_id' });
    if (!membership && !isUuid(body.fleet_id)) return json(response, 400, { ok: false, error: 'invalid_fleet_id' });
    const result = await pgFetch(membership ? 'rpc/leave_fleet' : 'rpc/remove_fleet_driver', {
      method: 'POST',
      body: membership ? { p_user_id: user.id, p_expected_fleet_id: id } : { p_owner_user_id: user.id, p_driver_id: id, p_expected_fleet_id: body.fleet_id },
    });
    const errors = { fleet_not_found: 404, driver_not_found: 404, driver_profile_not_found: 404, membership_changed: 409 };
    if (result && Object.hasOwn(errors, result.error)) return json(response, errors[result.error], { ok: false, error: result.error });
    if (!result || (membership ? typeof result.left !== 'boolean' : result.removed !== true)
      || (result.left !== false && (!isUuid(result.driver_id) || !membership && result.driver_id.toLowerCase() !== id.toLowerCase()))) {
      return json(response, 502, { ok: false, error: 'offboarding_not_saved' });
    }
    return json(response, 200, membership
      ? { ok: true, left: result.left, ...(result.left ? { driver_id: result.driver_id } : {}) }
      : { ok: true, removed: true, driver_id: result.driver_id });
  } catch (error) {
    return json(response, supabaseErrorStatus(error), { ok: false, error: 'supabase_error' });
  }
};

module.exports = require('../provider-budget').withProviderBudget(module.exports);
