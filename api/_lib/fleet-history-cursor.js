// A cursor is a bounded pagination boundary, never an authorization token.
// Keep database timestamps verbatim; ISO round-tripping would drop microseconds.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;
const MAX_CURSOR_LENGTH = 1024;

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function exactKeys(value, expected) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === expected.length
    && expected.every(key => Object.hasOwn(value, key));
}

function isUuid(value) {
  return typeof value === 'string' && value.length === 36 && UUID_PATTERN.test(value);
}

function validTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match || match[0] !== value) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > days[month - 1]) return false;
  const zone = match[8];
  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3)), offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return false;
  }
  return true;
}

function validTuple(value) {
  return exactKeys(value, ['started_at', 'id']) && validTimestamp(value.started_at) && isUuid(value.id);
}

function microseconds(timestamp) {
  const match = TIMESTAMP_PATTERN.exec(timestamp);
  // Date parses only a validated whole-second instant for comparison. Preserve
  // the fractional component separately and never serialize a Date into a cursor.
  const wholeSecond = match[1] + '-' + match[2] + '-' + match[3]
    + 'T' + match[4] + ':' + match[5] + ':' + match[6] + match[8];
  return BigInt(Date.parse(wholeSecond)) * 1000n + BigInt((match[7] || '').padEnd(6, '0'));
}

function compareTuples(left, right) {
  const leftTime = microseconds(left.started_at), rightTime = microseconds(right.started_at);
  if (leftTime < rightTime) return -1;
  if (leftTime > rightTime) return 1;
  const leftId = left.id.toLowerCase(), rightId = right.id.toLowerCase();
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function compareTimestamps(left, right) {
  const a = microseconds(left), b = microseconds(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function validCursorShape(value) {
  const versionOne = exactKeys(value, ['v', 'snapshot', 'before']) && value.v === 1;
  const versionTwo = exactKeys(value, ['v', 'snapshot', 'before', 'filters']) && value.v === 2 &&
    validFilters(value.filters);
  return (versionOne || versionTwo) && validTuple(value.snapshot) && validTuple(value.before)
    && compareTuples(value.before, value.snapshot) <= 0;
}

function validFilters(value) {
  return exactKeys(value, ['driver_id', 'from', 'to']) &&
    (value.driver_id === null || isUuid(value.driver_id)) &&
    (value.from === null || validTimestamp(value.from)) &&
    (value.to === null || validTimestamp(value.to)) &&
    (value.from === null || value.to === null || compareTimestamps(value.from, value.to) < 0);
}

function decodeCursor(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_CURSOR_LENGTH
      || !/^[A-Za-z0-9_-]+$/.test(value)) throw failure('invalid_cursor');
  let decoded;
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.length > 768 || bytes.toString('base64url') !== value) throw failure('invalid_cursor');
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw failure('invalid_cursor');
    decoded = JSON.parse(text);
  } catch (error) {
    throw failure('invalid_cursor');
  }
  if (!validCursorShape(decoded)) throw failure('invalid_cursor');
  return decoded;
}

function encodeCursor(snapshot, before, filters) {
  const value = filters ? { v: 2, snapshot, before, filters } : { v: 1, snapshot, before };
  if (!validCursorShape(value)) throw failure('invalid_cursor');
  const encoded = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  if (encoded.length > MAX_CURSOR_LENGTH) throw failure('invalid_cursor');
  return encoded;
}

function requestHistoryQuery(request) {
  let fromUrl = {};
  if (request.url) {
    let params;
    try { params = new URL(request.url, 'https://www.occulert.com').searchParams; }
    catch (error) { throw failure('invalid_query'); }
    const allowed = new Set(['cursor', 'driver_id', 'from', 'to']);
    if ([...params.keys()].some(key => !allowed.has(key) || params.getAll(key).length > 1)) throw failure('invalid_query');
    for (const key of allowed) if (params.has(key)) fromUrl[key] = params.get(key);
  }
  let fromQuery = {};
  if (request.query !== undefined) {
    if (request.query === null || typeof request.query !== 'object' || Array.isArray(request.query) ||
        Object.keys(request.query).some(key => !['cursor', 'driver_id', 'from', 'to'].includes(key))) throw failure('invalid_query');
    for (const key of Object.keys(request.query)) {
      if (typeof request.query[key] !== 'string') throw failure('invalid_query');
      fromQuery[key] = request.query[key];
    }
  }
  for (const key of Object.keys(fromQuery)) {
    if (Object.hasOwn(fromUrl, key) && fromUrl[key] !== fromQuery[key]) throw failure('invalid_query');
  }
  const params = Object.assign({}, fromUrl, fromQuery);
  if (Object.hasOwn(params, 'cursor')) {
    if (Object.keys(params).length !== 1) throw failure('invalid_query');
    const cursor = decodeCursor(params.cursor);
    return { cursor, filters: cursor.v === 2 ? cursor.filters : { driver_id: null, from: null, to: null } };
  }
  const filters = { driver_id: params.driver_id || null, from: params.from || null, to: params.to || null };
  if (!validFilters(filters) || Object.keys(params).some(key => params[key] === '')) throw failure('invalid_query');
  return { cursor: null, filters };
}

function requestCursor(request) {
  let fromUrl;
  if (request.url) {
    let params;
    try { params = new URL(request.url, 'https://www.occulert.com').searchParams; }
    catch (error) { throw failure('invalid_query'); }
    if ([...params.keys()].some(key => key !== 'cursor') || params.getAll('cursor').length > 1) {
      throw failure('invalid_query');
    }
    if (params.has('cursor')) fromUrl = params.get('cursor');
  }
  let fromQuery;
  if (request.query !== undefined) {
    if (request.query === null || typeof request.query !== 'object' || Array.isArray(request.query)
        || Object.keys(request.query).some(key => key !== 'cursor')) throw failure('invalid_query');
    if (Object.hasOwn(request.query, 'cursor')) {
      if (typeof request.query.cursor !== 'string') throw failure('invalid_query');
      fromQuery = request.query.cursor;
    }
  }
  if (fromUrl !== undefined && fromQuery !== undefined && fromUrl !== fromQuery) throw failure('invalid_query');
  const value = fromUrl === undefined ? fromQuery : fromUrl;
  return value === undefined ? null : decodeCursor(value);
}

module.exports = { requestCursor, requestHistoryQuery, decodeCursor, encodeCursor, validTimestamp, validTuple, compareTuples, compareTimestamps, isUuid };
