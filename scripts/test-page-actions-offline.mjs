import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { assetByStem } from './lib/current-assets.mjs';

function workerFetchHarness() {
  const origin = 'https://www.occulert.com', events = new Map(), entries = new Map();
  const activity = { interceptions: 0, lifetimes: 0, fetches: 0, cacheReads: 0, cacheOpens: 0, cacheWrites: 0 };
  const key = request => new URL(typeof request === 'string' ? request : request.url, origin).href;
  let network = async () => new Response('fresh network bytes');
  vm.runInNewContext(readFileSync('sw.js', 'utf8'), {
    Request, URL, Headers, Response, AbortController, Uint8Array, setTimeout, clearTimeout,
    self: { location: { origin }, addEventListener: (name, handler) => events.set(name, handler) },
    fetch: async request => { activity.fetches++; return network(request); },
    caches: {
      match: async request => { activity.cacheReads++; return entries.get(key(request))?.clone(); },
      open: async () => {
        activity.cacheOpens++;
        return { put: async (request, response) => { activity.cacheWrites++; entries.set(key(request), response.clone()); } };
      },
    },
  });
  return {
    activity, entries,
    setNetwork: callback => { network = callback; },
    async dispatch(url, options = {}) {
      let response;
      const lifetimes = [];
      events.get('fetch')({
        request: { method: 'GET', mode: 'no-cors', destination: 'script', url, ...options },
        respondWith: promise => { activity.interceptions++; response = promise; },
        waitUntil: promise => { activity.lifetimes++; lifetimes.push(promise); },
      });
      const result = await response;
      await Promise.all(lifetimes);
      // The cache-first path schedules its cache write without waitUntil.
      await Promise.resolve();
      return result;
    },
  };
}

const foreignRequests = [
  ['look-alike script host', 'https://www.occulert.com.example.net/runtime.v1.js'],
  ['look-alike HTML host', 'https://www.occulert.com.example.net/page.html'],
  ['foreign script', 'https://example.net/runtime.v1.js'],
  ['foreign HTML subresource', 'https://example.net/page.html'],
  ['different scheme', 'http://www.occulert.com/runtime.v1.js'],
  ['different port', 'https://www.occulert.com:444/runtime.v1.js'],
  ['foreign optional helper path', 'https://example.net/' + assetByStem('detection-experiments.js')],
  ['foreign protected script path', 'https://example.net/' + assetByStem('occulert-backend.js')],
];

for (const [label, url] of foreignRequests) {
  test(`service worker leaves ${label} to the browser network without touching caches`, async () => {
    const worker = workerFetchHarness();
    const response = await worker.dispatch(url);
    assert.deepEqual(worker.activity, { interceptions: 0, lifetimes: 0, fetches: 0, cacheReads: 0, cacheOpens: 0, cacheWrites: 0 });
    assert.equal(response, undefined);
    assert.equal(worker.entries.size, 0);
  });
}

test('service worker ignores previously cached foreign responses', async () => {
  for (const url of [foreignRequests[0][1], foreignRequests[3][1]]) {
    const worker = workerFetchHarness();
    worker.entries.set(url, new Response('previously poisoned cache'));
    const response = await worker.dispatch(url);
    assert.deepEqual(worker.activity, { interceptions: 0, lifetimes: 0, fetches: 0, cacheReads: 0, cacheOpens: 0, cacheWrites: 0 });
    assert.equal(response, undefined);
    assert.equal(await worker.entries.get(url).text(), 'previously poisoned cache');
  }
});

test('same-origin cache-first assets still populate the cache and reuse it', async () => {
  const worker = workerFetchHarness(), url = 'https://www.occulert.com/runtime-fixture.v1.js';
  assert.equal(await (await worker.dispatch(url)).text(), 'fresh network bytes');
  assert.equal(worker.activity.cacheWrites, 1);
  assert.equal(await worker.entries.get(url).clone().text(), 'fresh network bytes');
  worker.setNetwork(async () => { throw Error('Offline'); });
  assert.equal(await (await worker.dispatch(url)).text(), 'fresh network bytes');
  assert.equal(worker.activity.fetches, 1, 'the cache hit must not send a second network request');
  assert.equal(worker.activity.cacheReads, 2);
});

test('same-origin HTML still caches online and falls back to its own page or index offline', async () => {
  const worker = workerFetchHarness(), url = 'https://www.occulert.com/fixture-page.html';
  assert.equal(await (await worker.dispatch(url)).text(), 'fresh network bytes');
  assert.equal(worker.activity.cacheWrites, 1);
  worker.setNetwork(async () => { throw Error('Offline'); });
  assert.equal(await (await worker.dispatch(url)).text(), 'fresh network bytes');
  worker.entries.delete(url);
  worker.entries.set('https://www.occulert.com/index.html', new Response('offline index'));
  assert.equal(await (await worker.dispatch(url + '?from=fixture', { mode: 'navigate', destination: 'document' })).text(), 'offline index');
  assert.equal(worker.activity.fetches, 3, 'HTML remains network-first');
  assert.equal(worker.activity.cacheWrites, 1, 'failed network attempts must not replace cached content');
});

test('service worker still bypasses non-GET requests', async () => {
  const worker = workerFetchHarness();
  for (const url of ['https://www.occulert.com/fixture-page.html', foreignRequests[0][1]]) {
    assert.equal(await worker.dispatch(url, { method: 'POST' }), undefined);
  }
  assert.deepEqual(worker.activity, { interceptions: 0, lifetimes: 0, fetches: 0, cacheReads: 0, cacheOpens: 0, cacheWrites: 0 });
});

for (const failure of ['none', 'dispatcher', 'guard-missing', 'guard-integrity']) {
  test(`actual service worker installation ${failure === 'none' ? 'completes' : 'fails'} for ${failure}`, async () => {
    const events = new Map(), cached = new Set(), deleted = [];
    const actionPath = '/' + assetByStem('page-actions.js');
    const guardPath = '/' + assetByStem('driver-startup-guard.js');
    const pin = 'sha256-' + (await import('node:crypto')).createHash('sha256').update(readFileSync(guardPath.slice(1))).digest('base64');
    const added = [];
    let installation, skipWaiting = 0;
    const context = {
      Request, URL, Headers, Response, AbortController, Uint8Array, setTimeout, clearTimeout,
      WebAssembly: { validate: () => false },
      self: {
        location: { origin: 'https://fixture.invalid' },
        addEventListener: (name, handler) => events.set(name, handler),
        skipWaiting: async () => { skipWaiting += 1; },
      },
      caches: {
        open: async () => ({
          add: async request => {
            const path = typeof request === 'string' ? request : new URL(request.url).pathname;
            added.push({path, integrity:request.integrity});
            if (failure === 'dispatcher' && path === actionPath) throw Error('Fixture unavailable dispatcher');
            if (failure.startsWith('guard-') && path === guardPath) throw Error('Fixture unavailable or invalid integrity guard');
            cached.add(path);
          },
          match: async path => cached.has(path) ? new Response('fixture bytes') : undefined,
        }),
        delete: async name => { deleted.push(name); return true; },
      },
    };
    vm.runInNewContext(readFileSync('sw.js', 'utf8'), context);
    events.get('install')({ waitUntil: promise => { installation = promise; } });
    if (failure !== 'none') {
      await assert.rejects(installation, /Critical offline assets were not cached/);
      assert.equal(skipWaiting, 0);
      assert.equal(deleted.length, 1);
    } else {
      await installation;
      assert.equal(cached.has(actionPath), true);
      assert.equal(cached.has(guardPath), true);
      assert.equal(added.find(item=>item.path===guardPath)?.integrity, pin);
      assert.equal(skipWaiting, 1);
      assert.deepEqual(deleted, []);
    }
  });
}
