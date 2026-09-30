import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const routed = [
  'billing-checkout', 'billing-portal', 'billing-status', 'billing-webhook',
  'fleet-period-report', 'fleet-session-history',
];

test('API fits the Vercel Hobby twelve-function deployment limit', () => {
  const entries = readdirSync(new URL('../api/', import.meta.url), { withFileTypes: true });
  const functions = entries.filter(entry => entry.isFile() && entry.name.endsWith('.js'));
  assert.equal(functions.length, 12);
  assert.ok(functions.some(entry => entry.name === '[endpoint].js'));
  for (const route of routed) {
    assert.ok(!functions.some(entry => entry.name === route + '.js'));
    assert.equal(typeof require(`../api/_lib/routes/${route}.js`), 'function');
  }
});

test('dynamic API dispatch uses the path and ignores caller-supplied route queries', async () => {
  const called = [];
  for (const route of routed) {
    const file = require.resolve(`../api/_lib/routes/${route}.js`);
    require.cache[file] = { id: file, filename: file, loaded: true,
      exports: request => { called.push({ route, request }); } };
  }
  const dispatcherPath = require.resolve('../api/[endpoint].js');
  delete require.cache[dispatcherPath];
  const dispatch = require(dispatcherPath);

  for (const route of routed) {
    const response = { statusCode: 200, setHeader() {}, end() {} };
    const request = { url: `/api/${route}?days=7&endpoint=${route}`,
      query: { endpoint: route, days: '7' } };
    await dispatch(request, response);
    assert.equal(called.at(-1).route, route);
    assert.deepEqual(called.at(-1).request.query, route === 'billing-webhook'
      ? { endpoint: route, days: '7' } : { days: '7' });
    if (route === 'billing-webhook') assert.equal(called.at(-1).request, request);
    else {
      assert.notEqual(called.at(-1).request, request);
      assert.equal(called.at(-1).request.url, `/api/${route}?days=7`);
    }
    assert.equal(response.statusCode, 200);
  }
  assert.deepEqual(called.map(item => item.route), routed);

  const vercelRequest = { url: '/api/fleet-period-report?days=7&endpoint=fleet-period-report' };
  Object.defineProperty(vercelRequest, 'query', { get: () => ({
    endpoint: 'fleet-period-report', days: '7', vercel_internal: 'route-metadata',
  }) });
  await dispatch(vercelRequest, { statusCode: 200, setHeader() {}, end() {} });
  assert.equal(called.at(-1).route, 'fleet-period-report');
  assert.deepEqual(called.at(-1).request.query, { days: '7' });
  assert.equal(called.at(-1).request.url, '/api/fleet-period-report?days=7');
  assert.equal(Object.hasOwn(called.at(-1).request, 'query'), true);

  const response = { statusCode: 200, headers: {}, body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value; } };
  await dispatch({ url: '/api/fleet-period-report?days=7',
    query: { endpoint: 'billing-webhook', days: '7' } }, response);
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, 'invalid_query');
  assert.deepEqual(called.map(item => item.route), [...routed, 'fleet-period-report']);

  await dispatch({ url: '/api/unknown?endpoint=billing-webhook' }, response);
  assert.equal(response.statusCode, 404);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(JSON.parse(response.body).error, 'not_found');
  assert.deepEqual(called.map(item => item.route), [...routed, 'fleet-period-report']);
});

test('fleet query validators accept Vercel path metadata but reject caller endpoint queries', async () => {
  process.env.SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  const libPath = require.resolve('../api/_lib/supabase.js');
  require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: {
    verifyAccessToken: async () => ({ id: '11111111-1111-4111-8111-111111111111' }),
    bearerToken: () => 'fixture',
    pgFetch: async table => {
      assert.equal(table, 'fleets');
      return [];
    },
  } };
  for (const route of ['fleet-period-report', 'fleet-session-history']) {
    delete require.cache[require.resolve(`../api/_lib/routes/${route}.js`)];
  }
  const dispatcherPath = require.resolve('../api/[endpoint].js');
  delete require.cache[dispatcherPath];
  const dispatch = require(dispatcherPath);
  async function invoke(route, suffix = '', callerQuery = {}) {
    const response = { statusCode: 200, setHeader() {},
      end(value) { this.body = JSON.parse(value); } };
    const request = { method: 'GET',
      url: `/api/${route}${suffix}${suffix.includes('?') ? '&' : '?'}endpoint=${route}`,
      headers: { authorization: 'Bearer fixture' } };
    Object.defineProperty(request, 'query', { get: () => ({
      endpoint: route, vercel_internal: 'route-metadata', ...callerQuery,
    }) });
    await dispatch(request, response);
    return response;
  }
  assert.equal((await invoke('fleet-period-report', '?days=7', { days: '7' })).statusCode, 403);
  assert.equal((await invoke('fleet-session-history')).statusCode, 403);
  assert.equal((await invoke('fleet-period-report', '?days=7&endpoint=fleet-period-report',
    { days: '7' })).statusCode, 400);
  assert.equal((await invoke('fleet-period-report', '?days=7&endpoint=unexpected',
    { days: '7' })).statusCode, 400);
  assert.equal((await invoke('fleet-period-report', '?days=7&days=30',
    { days: '7' })).statusCode, 400);
  assert.equal((await invoke('fleet-period-report', '?days=7&unknown=1',
    { days: '7' })).statusCode, 400);
  assert.equal((await invoke('fleet-session-history', '?endpoint=fleet-session-history')).statusCode, 400);
});
