import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { readOfflineCacheSnapshot, recordOfflineCacheSnapshot } from '../tests/helpers/offline-cache-diagnostics.mjs';

function fixture(overrides = {}) {
  const active = { scriptURL: 'http://localhost/sw.js?secret=hidden', state: 'activated' };
  return { URL, location: { href: 'http://localhost/app.html?token=secret#fragment', origin: 'http://localhost', pathname: '/app.html' },
    navigator: { serviceWorker: { controller: active, getRegistration: async () => ({ active }) } },
    document: { readyState: 'complete', querySelectorAll: () => [
      { src: 'http://localhost/driver.js?token=secret' }, { href: 'http://localhost/style.css' },
      { src: 'https://external.example/code.js?secret=hidden' },
    ] },
    caches: { keys: async () => ['occulert-v1'], match: async url => url.includes('style.css') ? undefined : { status: 200, type: 'basic' } },
    ...overrides };
}
async function snapshot(context = fixture()) {
  return JSON.parse(JSON.stringify(await vm.runInNewContext(`(${readOfflineCacheSnapshot.toString()})()`, context)));
}

test('captures controller, missing resource and per-cache coverage without secrets or bodies', async () => {
  const result = await snapshot();
  assert.equal(result.controllerIsActive, true);
  assert.deepEqual(result.controller, { path: '/sw.js', state: 'activated' });
  assert.deepEqual(result.missingPaths, ['/style.css']);
  assert.equal(result.caches[0].checkedResources, 4);
  assert.ok(result.caches[0].matchedPaths.includes('/driver.js'));
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('external.example'), false);
});

test('bounds resource and cache inventory without opening or mutating caches', async () => {
  let matches = 0;
  const result = await snapshot(fixture({
    document: { readyState: 'loading', querySelectorAll: () => Array.from({ length: 300 }, (_, i) => ({ src: `http://localhost/${i}.js` })) },
    caches: { keys: async () => Array.from({ length: 10 }, (_, i) => `cache${i}`), match: async () => { matches++; return undefined; } },
  }));
  assert.equal(result.resources.length, 200);
  assert.equal(result.caches.length, 8);
  assert.equal(result.resourcesTruncated, true);
  assert.equal(result.cachesTruncated, true);
  assert.equal(matches, 1800);
});

test('absent registration and controller are reported, not repaired or awaited', async () => {
  const result = await snapshot(fixture({ navigator: {} }));
  assert.equal(result.controllerIsActive, false);
  assert.equal(result.active, null);
  assert.equal(result.controller, null);
});

test('snapshot rejection never replaces original assertion failure', async () => {
  const events = [];
  await recordOfflineCacheSnapshot({ evaluate: async () => { throw new Error('closed renderer private URL'); } },
    { record: (...args) => events.push(args) }, 'after-failure');
  assert.deepEqual(events, [['offline-cache-snapshot-unavailable', { phase: 'after-failure' }]]);
});

test('hung snapshot returns bounded unavailable evidence', async () => {
  const events = [];
  await recordOfflineCacheSnapshot({ evaluate: () => new Promise(() => {}) },
    { record: (...args) => events.push(args) }, 'before-offline', 5);
  assert.equal(events[0][0], 'offline-cache-snapshot-unavailable');
});

test('successful snapshot records phase and data', async () => {
  const events = [];
  await recordOfflineCacheSnapshot({ evaluate: async () => ({ controllerIsActive: true }) },
    { record: (...args) => events.push(args) }, 'before-offline');
  assert.deepEqual(events, [['offline-cache-snapshot', { phase: 'before-offline', snapshot: { controllerIsActive: true } }]]);
});

test('offline test retains assertions and timeout, records before transition and attaches failure', () => {
  const source = readFileSync(new URL('../tests/driver-startup-recovery.spec.mjs', import.meta.url), 'utf8');
  const section = source.slice(source.indexOf("test('the verified offline shell"), source.indexOf("test('a corrupted offline guard"));
  assert.match(section, /test\.setTimeout\(45_000\)/);
  assert.ok(section.indexOf("'before-offline'") < section.indexOf('state.offline = true'));
  assert.match(section, /diagnostics\.attach\(testInfo, 'offline-startup-diagnostics'\)/);
  assert.match(section, /throw error/);
  assert.match(section, /diagnostics\.stop\(\)/);
  assert.match(section, /await expectNoPermissionedWork\(page\)/);
  assert.equal((section.match(/toBeEnabled\(\)/g) || []).length, 2);
});


test('corrupted cached guard case also retains safeguards and records failure evidence', () => {
  const source = readFileSync(new URL('../tests/driver-startup-recovery.spec.mjs', import.meta.url), 'utf8');
  const section = source.slice(source.indexOf("test('a corrupted offline guard"));
  assert.match(section, /test\.setTimeout\(45_000\)/);
  assert.ok(section.indexOf("'before-offline-corrupted-guard'") < section.indexOf('state.offline = true'));
  assert.match(section, /diagnostics\.attach\(testInfo, 'offline-corrupted-guard-diagnostics'\)/);
  assert.match(section, /throw error/);
  assert.match(section, /diagnostics\.stop\(\)/);
  assert.match(section, /await expectCoreGuards\(page\)/);
  assert.match(section, /await expectNoPermissionedWork\(page\)/);
  assert.match(section, /toEqual\(\{guard:'undefined',corrupted:undefined,core:true\}\)/);
});
