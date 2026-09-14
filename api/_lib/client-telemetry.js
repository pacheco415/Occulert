// Client timestamps are unverified telemetry. Stable UUIDs make offline retries safe.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validId(value) { return typeof value === 'string' && UUID.test(value); }
function timestamp(value) {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time < Date.UTC(2020, 0, 1) || time > Date.now() + 300000) return null;
  return new Date(time).toISOString();
}
async function insertOnce(pgFetch, table, body, scope) {
  try { return await pgFetch(table, { method: 'POST', body }); }
  catch (error) {
    if (!body.id || error.status !== 409 || error.details?.code !== '23505') throw error;
    const existing = await pgFetch(table, { params: { select: '*', id: 'eq.' + body.id, ...scope, limit: '1' } });
    if (!existing.length) throw error;
    return existing;
  }
}
module.exports = { validId, timestamp, insertOnce };
