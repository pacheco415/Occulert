// Cleanup-only endpoint for durable native revocation tombstones. The two
// per-session UUIDs plus the driver's stable cleanup UUID form a cancellation
// capability. The secrets are never returned by session, fleet, or reporting
// APIs; the driver capability comes only from the authenticated profile API.
const { pgFetch } = require('./_lib/supabase');
const { validId } = require('./_lib/client-telemetry');

const MAX_BODY_LENGTH = 1024;

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(body));
}

module.exports = async function sessionCancelV1(request, response) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(response, 501, { ok: false, error: 'backend_not_configured' });
  }
  if (request.method !== 'DELETE') {
    response.setHeader('Allow', 'DELETE');
    return json(response, 405, { ok: false, error: 'method_not_allowed' });
  }
  if (!String(request.headers['content-type'] || '').toLowerCase().includes('application/json')) {
    return json(response, 415, { ok: false, error: 'invalid_json_body' });
  }
  const body = typeof request.body === 'object' && request.body && !Array.isArray(request.body)
    ? request.body
    : {};
  if (
    JSON.stringify(body).length > MAX_BODY_LENGTH
    || !validId(body.session_id)
    || !validId(body.cancel_token)
    || !validId(body.cleanup_token)
  ) {
    return json(response, 400, { ok: false, error: 'invalid_cancellation' });
  }
  try {
    const rows = await pgFetch('rpc/cancel_session_sync_token_v1', {
      method: 'POST',
      body: {
        p_session_id: body.session_id,
        p_cancel_token: body.cancel_token,
        p_cleanup_token: body.cleanup_token,
      },
    });
    const result = Array.isArray(rows) ? rows[0] : rows;
    if (result?.invalid_capability === true) {
      return json(response, 410, { ok: false, error: 'cleanup_capability_expired' });
    }
    return json(response, 200, {
      ok: true,
      settled: result?.settled === true,
      deleted: result?.deleted === true,
    });
  } catch {
    return json(response, 502, { ok: false, error: 'supabase_error' });
  }
};
