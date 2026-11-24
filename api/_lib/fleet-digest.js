const { createHash } = require('node:crypto');
const { isJsonObject } = require('./validation');
const { json } = require('./responses');
const { supabaseErrorStatus } = require('./supabase-errors');

function hasNoQuery(request) {
  try {
    if (request.url && new URL(request.url, 'https://www.occulert.com').searchParams.size) return false;
  } catch { return false; }
  return request.query === undefined || isJsonObject(request.query) && Object.keys(request.query).length === 0;
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function digestError(response, error) {
  if (['42P01', '42883', 'PGRST200', 'PGRST202', 'PGRST205'].includes(error?.details?.code)) {
    return json(response, 503, { ok: false, error: 'digest_not_enabled' });
  }
  return json(response, supabaseErrorStatus(error), { ok: false, error: 'digest_unavailable' });
}

module.exports = { hasNoQuery, tokenHash, digestError };
