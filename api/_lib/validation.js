'use strict';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Canonical database session IDs have no version or variant restriction.
function isUuid(value) { return typeof value === 'string' && value.length === 36 && UUID.test(value); }
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
function isJsonMediaType(request) {
  const mediaType = String(request.headers?.['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  return mediaType === 'application/json';
}
function isJsonObject(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body);
}
// Parsed object routes historically limit serialized JS characters, not bytes.
// Billing string/byte parsing and raw webhook streams have separate limits.
function jsonObjectWithinLimit(body, maxLength) {
  if (!isJsonObject(body)) return false;
  try { return JSON.stringify(body).length <= maxLength; }
  catch { return false; }
}
function validJsonBody(request, maxLength = 4096) {
  return isJsonMediaType(request) && jsonObjectWithinLimit(request.body, maxLength);
}
module.exports = { isUuid, numberOrNull, integerOrNull, isJsonMediaType, isJsonObject, jsonObjectWithinLimit, validJsonBody };
