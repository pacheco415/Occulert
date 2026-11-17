const { timingSafeEqual } = require('node:crypto');
const { pgFetch } = require('../supabase');
const { json } = require('../responses');
const { isUuid, validJsonBody } = require('../validation');
const { hasNoQuery, tokenHash, digestError } = require('../fleet-digest');
const { withProviderBudget } = require('../provider-budget');

module.exports = withProviderBudget(async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return json(response, 405, { ok: false, error: 'method_not_allowed' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(response, 501, { ok: false, error: 'backend_not_configured' });
  }
  if (!hasNoQuery(request)) return json(response, 400, { ok: false, error: 'invalid_query' });
  if (!validJsonBody(request, 256)) return json(response, 415, { ok: false, error: 'invalid_json_body' });
  const { token } = request.body;
  if (Object.keys(request.body).length !== 1 || !Object.hasOwn(request.body, 'token') || typeof token !== 'string') {
    return json(response, 400, { ok: false, error: 'invalid_request' });
  }
  try {
    if (/^[A-Za-z0-9_-]{43}$/.test(token) && token.length === 43) {
      const hash = tokenHash(token);
      const params = { unsubscribe_token_hash: 'eq.' + hash, weekly_enabled: 'eq.true' };
      const rows = await pgFetch('fleet_digest_preferences', {
        params: { ...params, select: 'fleet_id,unsubscribe_token_hash', limit: '1' },
      });
      if (!Array.isArray(rows) || rows.length > 1) throw new Error('invalid_preference');
      const row = rows[0];
      if (rows.length && (!isUuid(row?.fleet_id) || typeof row.unsubscribe_token_hash !== 'string' ||
          !/^[0-9a-f]{64}$/.test(row.unsubscribe_token_hash) || row.unsubscribe_token_hash.length !== 64)) {
        throw new Error('invalid_preference');
      }
      const expected = row ? Buffer.from(row.unsubscribe_token_hash, 'hex') : Buffer.alloc(32);
      if (timingSafeEqual(Buffer.from(hash, 'hex'), expected) && row) {
        // Keep the hash in the update filter so an old link cannot cancel a newer opt-in.
        await pgFetch('fleet_digest_preferences', { method: 'PATCH', params: { ...params, fleet_id: 'eq.' + row.fleet_id,
          select: 'weekly_enabled' }, body: { weekly_enabled: false, unsubscribe_token_hash: null,
          updated_at: new Date().toISOString() } });
      }
    }
    return json(response, 200, { ok: true });
  } catch (error) { return digestError(response, error); }
});
