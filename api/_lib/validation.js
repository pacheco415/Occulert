'use strict';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value) { return typeof value === 'string' && UUID.test(value); }
function numberOrNull(value, min, max) {
  if (!['number','string'].includes(typeof value)) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : null;
}
function integerOrNull(value) {
  const count = numberOrNull(value, 0, 10000);
  return count === null ? null : Math.round(count);
}
function validJsonBody(request, maxLength = 4096) {
  const mediaType = String(request.headers?.['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') return false;
  const body = request.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  try { return JSON.stringify(body).length <= maxLength; }
  catch { return false; }
}
module.exports = { isUuid, numberOrNull, integerOrNull, validJsonBody };
