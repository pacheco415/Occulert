const { randomBytes } = require('node:crypto');
const { pgFetch, verifyAccessToken, bearerToken } = require('../supabase');
const { json } = require('../responses');
const { isUuid, validJsonBody } = require('../validation');
const { allowAccountWrite } = require('../account-write-quota');
const { hasNoQuery, tokenHash, digestError } = require('../fleet-digest');
const { withProviderBudget } = require('../provider-budget');

module.exports = withProviderBudget(async function handler(request, response) {
  response.setHeader('Vary', 'Authorization');
  const reading = request.method === 'GET';
  if (!reading && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return json(response, 405, { ok: false, error: 'method_not_allowed' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(response, 501, { ok: false, error: 'backend_not_configured' });
  }
  if (!hasNoQuery(request)) return json(response, 400, { ok: false, error: 'invalid_query' });
  try {
    const actor = await verifyAccessToken(bearerToken(request), { cachedIdentity: reading });
    if (!actor) return json(response, 401, { ok: false, error: 'unauthorized' });
    if (!isUuid(actor.id)) throw new Error('invalid_identity');
    if (!reading) {
      if (!validJsonBody(request, 256)) return json(response, 415, { ok: false, error: 'invalid_json_body' });
      const body = request.body;
      if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'weekly_enabled') || typeof body.weekly_enabled !== 'boolean') {
        return json(response, 400, { ok: false, error: 'invalid_preference' });
      }
    }
    const fleets = await pgFetch('fleets', { params: { select: 'id,fleet_digest_preferences(weekly_enabled)',
      owner_user_id: 'eq.' + actor.id, limit: '1' } });
    if (!Array.isArray(fleets) || fleets.length > 1) throw new Error('invalid_fleets');
    if (!fleets.length) return json(response, 403, { ok: false, error: 'fleet_not_found' });
    const { id, fleet_digest_preferences: preference } = fleets[0];
    if (!isUuid(id) || (preference !== null && typeof preference?.weekly_enabled !== 'boolean')) {
      throw new Error('invalid_preference');
    }
    if (reading) return json(response, 200, { ok: true, weekly_enabled: preference?.weekly_enabled ?? false });
    if (!await allowAccountWrite(pgFetch, response, actor.id, 'fleet')) return;
    const enabled = request.body.weekly_enabled;
    const token = enabled ? randomBytes(32).toString('base64url') : null;
    const saved = await pgFetch('rpc/set_fleet_digest_preference', { method: 'POST', body: {
      p_actor_id: actor.id, p_fleet_id: id, p_enabled: enabled, p_token_hash: enabled ? tokenHash(token) : null,
    } });
    if (saved === null) return json(response, 403, { ok: false, error: 'fleet_not_found' });
    if (saved !== enabled) throw new Error('invalid_write_result');
    const result = { ok: true, weekly_enabled: enabled };
    if (enabled) result.unsubscribe_token = token;
    return json(response, 200, result);
  } catch (error) { return digestError(response, error); }
});
