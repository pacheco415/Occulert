import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import { assetByStem } from './lib/current-assets.mjs';

function workerFetchHarness() {
  const origin = 'https://www.occulert.com', events = new Map(), entries = new Map();
  const activity = { interceptions: 0, lifetimes: 0, fetches: 0, cacheReads: 0, cacheOpens: 0, cacheWrites: 0 };
  const key = request => new URL(typeof request === 'string' ? request : request.url, origin).href;
  let network = async () => new Response('fresh network bytes');
  vm.runInNewContext(readFileSync('sw.js', 'utf8'), {
    Request, URL, Headers, Response, AbortController, Uint8Array, setTimeout, clearTimeout, crypto: webcrypto, btoa,
    self: { location: { origin }, addEventListener: (name, handler) => events.set(name, handler) },
    fetch: async request => { activity.fetches++; return network(request); },
    caches: {
      match: async request => { activity.cacheReads++; return entries.get(key(request))?.clone(); },
      open: async () => {
        activity.cacheOpens++;
        return { put: async (request, response) => { activity.cacheWrites++; entries.set(key(request), response.clone()); },
          delete: async request => entries.delete(key(request)) };
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
        request: options.request || { method: 'GET', mode: 'no-cors', destination: 'script', url, ...options },
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

test('installed static assets with query variants reuse the canonical offline cache', async () => {
  for (const path of ['/' + assetByStem('driver-app.js'), '/' + assetByStem('driver-app.css')]) {
    const worker = workerFetchHarness();
    worker.entries.set('https://www.occulert.com' + path, new Response('installed static asset'));
    worker.setNetwork(async () => { throw Error('Offline'); });
    const response = await worker.dispatch('https://www.occulert.com' + path + '?diagnostic=1');
    assert.equal(await response.text(), 'installed static asset');
    assert.equal(worker.entries.size, 1, 'query variants must not add cache entries');
  }
});

test('offline driver navigation with a query opens the installed driver, not the homepage', async () => {
  const worker = workerFetchHarness();
  worker.entries.set('https://www.occulert.com/app.html', new Response('installed driver shell'));
  worker.entries.set('https://www.occulert.com/index.html', new Response('installed homepage'));
  worker.setNetwork(async () => { throw Error('Offline'); });
  const response = await worker.dispatch('https://www.occulert.com/app.html?lang=es', { mode: 'navigate', destination: 'document' });
  assert.equal(await response.text(), 'installed driver shell');
});

test('queried documents never persist login-link values or replace canonical installed bytes', async () => {
  for (const path of ['/login.html?code=private-fixture', '/app.html?lang=es']) {
    const worker = workerFetchHarness();
    worker.entries.set('https://www.occulert.com/app.html', new Response('installed driver shell'));
    const response = await worker.dispatch('https://www.occulert.com' + path, { mode: 'navigate', destination: 'document' });
    assert.equal(await response.text(), 'fresh network bytes');
    assert.equal(worker.activity.cacheWrites, 0);
    assert.deepEqual([...worker.entries.keys()], ['https://www.occulert.com/app.html']);
    assert.equal(await worker.entries.get('https://www.occulert.com/app.html').text(), 'installed driver shell');
  }
});

test('unlisted query variants ignore previously stored query-bearing cache entries', async () => {
  const worker = workerFetchHarness(), url = 'https://www.occulert.com/login.html?code=private-fixture';
  worker.entries.set(url, new Response('obsolete query-bearing page'));
  worker.entries.set('https://www.occulert.com/index.html', new Response('installed homepage'));
  worker.setNetwork(async () => { throw Error('Offline'); });
  const response = await worker.dispatch(url, { mode: 'navigate', destination: 'document' });
  assert.equal(await response.text(), 'installed homepage');
});

test('credentialed and partial requests bypass the offline cache', async () => {
  for (const headers of [new Headers({ Authorization: 'Bearer fixture' }), new Headers({ Range: 'bytes=0-7' })]) {
    const worker = workerFetchHarness();
    assert.equal(await worker.dispatch('https://www.occulert.com/fixture.json', { headers }), undefined);
    assert.deepEqual(worker.activity, { interceptions: 0, lifetimes: 0, fetches: 0, cacheReads: 0, cacheOpens: 0, cacheWrites: 0 });
  }
});

test('optional runtime query variants verify canonical cached bytes and ignore query-bearing poison', async () => {
  for (const logical of ['driver-i18n.js', 'detection-experiments.js']) {
    const worker = workerFetchHarness(), path = assetByStem(logical);
    const canonical = 'https://www.occulert.com/' + path, queried = canonical + '?diagnostic=1';
    const source = readFileSync(path, 'utf8');
    worker.entries.set(canonical, new Response(source));
    worker.entries.set(queried, new Response('unverified query response'));
    worker.setNetwork(async () => { throw Error('Offline'); });
    const response = await worker.dispatch(queried, { request: new Request(queried) });
    assert.equal(await response.text(), source);
    assert.equal(worker.activity.fetches, 0);
    assert.equal(worker.activity.cacheWrites, 0);
  }
});

test('corrupt optional canonical cache is discarded and queried recovery retains exact network SRI', async () => {
  const worker = workerFetchHarness(), path = assetByStem('driver-i18n.js');
  const canonical = 'https://www.occulert.com/' + path, queried = canonical + '?diagnostic=1';
  const source = readFileSync(path, 'utf8');
  const pin = 'sha256-' + createHash('sha256').update(source).digest('base64');
  worker.entries.set(canonical, new Response('corrupt canonical response'));
  worker.entries.set(queried, new Response('unverified query response'));
  worker.setNetwork(async request => {
    assert.equal(request.url, queried); assert.equal(request.integrity, pin);
    return new Response(source);
  });
  const response = await worker.dispatch(queried, { request: new Request(queried) });
  assert.equal(await response.text(), source);
  assert.equal(worker.entries.has(canonical), false);
  assert.equal(worker.activity.cacheWrites, 0, 'queried network bytes cannot replace the canonical asset');
  worker.setNetwork(async () => { throw Error('Offline'); });
  const unavailable = await worker.dispatch(queried, { request: new Request(queried) });
  assert.equal(unavailable.type, 'error', 'an obsolete query-bearing entry cannot bypass verification');
});

for (const failure of ['none', 'dispatcher', 'guard-missing', 'guard-integrity', 'http-error', 'partial-response']) {
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
      fetch: async request => {
        const path = typeof request === 'string' ? request : new URL(request.url).pathname;
        added.push({path, integrity:request.integrity});
        if (failure === 'dispatcher' && path === actionPath) throw Error('Fixture unavailable dispatcher');
        if (failure.startsWith('guard-') && path === guardPath) throw Error('Fixture unavailable or invalid integrity guard');
        return new Response('fixture bytes', { status: path === actionPath && failure === 'http-error' ? 503 : path === actionPath && failure === 'partial-response' ? 206 : 200 });
      },
      caches: {
        open: async () => ({
          put: async request => cached.add(new URL(request.url).pathname),
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

function stalledInstall(stalledPath, phase) {
  const events = new Map(), timers = new Map(), requests = [], currentEntries = new Set();
  const oldEntries = new Set(['/app.html', '/known-good-driver.js']);
  const currentName = readFileSync('sw.js', 'utf8').match(/const CACHE = '([^']+)'/)[1];
  const stored = new Map([['occulert-old-fixture', oldEntries], [currentName, currentEntries]]);
  let installation, skipWaitingCalled = false, claimed = false, release;
  const context = {
    Request, URL, Headers, Response, AbortController, Uint8Array,
    setTimeout: (callback, delay) => { const id = {}; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    WebAssembly: { validate: () => false },
    self: { location: { origin: 'https://fixture.invalid' },
      addEventListener: (name, handler) => events.set(name, handler),
      skipWaiting: async () => { skipWaitingCalled = true; },
      clients: { claim: async () => { claimed = true; } } },
    fetch: async request => {
      const path = typeof request === 'string' ? request : new URL(request.url).pathname;
      requests.push({ path, request });
      if (path === stalledPath && phase === 'headers') await new Promise(resolve => { release = resolve; });
      const response = new Response('verified bytes');
      if (path === stalledPath && phase === 'body') response.clone = () => ({
        arrayBuffer: () => new Promise(resolve => { release = resolve; }),
      });
      return response;
    },
    caches: {
      open: async () => ({
        // Compatibility path exercises the actual original worker in fail-before runs.
        add: async input => {
          const request = typeof input === 'string' ? new Request(new URL(input, context.self.location.origin)) : input;
          const response = await context.fetch(request);
          await response.clone().arrayBuffer();
          const cache = await context.caches.open();
          await cache.put(request, response);
        },
        put: async request => {
          const path = new URL(request.url).pathname;
          if (path === stalledPath && phase === 'write') await new Promise(resolve => { release = resolve; });
          currentEntries.add(path);
        },
        match: async path => currentEntries.has(path) ? new Response('verified bytes') : undefined,
      }),
      keys: async () => [...stored.keys()],
      delete: async name => stored.delete(name),
    },
  };
  vm.runInNewContext(readFileSync('sw.js', 'utf8'), context);
  events.get('install')({ waitUntil: promise => { installation = promise; } });
  // Observe rejections immediately, before the manually advanced deadline.
  const outcome = installation.then(() => 'installed', () => 'rejected');
  return { timers, requests, stored, currentName, currentEntries, oldEntries, outcome,
    skipWaitingCalled: () => skipWaitingCalled, release: () => release(),
    async activate() {
      let activation;
      events.get('activate')({ waitUntil: promise => { activation = promise; } });
      await activation;
      return claimed;
    } };
}
const flushInstallTasks = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

for (const phase of ['headers', 'body', 'write']) {
for (const critical of [false, true]) {
  test(`stalled ${critical ? 'critical' : 'noncritical'} install ${phase} is bounded and aborted without losing the old cache`, async () => {
    const path = critical ? '/' + assetByStem('driver-app.js') : '/favicon.ico';
    const worker = stalledInstall(path, phase);
    await flushInstallTasks();
    assert.equal(worker.skipWaitingCalled(), false);
    assert.equal(worker.timers.size, 1, 'only the stalled transfer must retain its deadline');
    const deadline = [...worker.timers.values()][0];
    assert.equal(deadline.delay, 30_000);
    deadline.callback();
    await flushInstallTasks();
    assert.equal(worker.requests.find(item => item.path === path).request.signal.aborted, true);
    assert.equal(await worker.outcome, critical ? 'rejected' : 'installed');
    assert.equal(worker.skipWaitingCalled(), !critical);
    assert.equal(worker.stored.has(worker.currentName), !critical);
    assert.deepEqual([...worker.oldEntries], ['/app.html', '/known-good-driver.js']);
    assert.equal(worker.stored.get('occulert-old-fixture'), worker.oldEntries);
    // A cancellation-ignoring operation cannot resurrect a discarded install.
    worker.release();
    await flushInstallTasks();
    assert.equal(worker.currentEntries.has(path), phase === 'write', 'late headers/body must not start a write; an already-pending write stays on its original Cache object');
    assert.equal(worker.stored.has(worker.currentName), !critical);
    assert.equal(worker.timers.size, 0);
    if (!critical) {
      assert.equal(await worker.activate(), true);
      assert.equal(worker.stored.has('occulert-old-fixture'), false);
      assert.equal(worker.stored.has(worker.currentName), true);
    }
  });
}
}
