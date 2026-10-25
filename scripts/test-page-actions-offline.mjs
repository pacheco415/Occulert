import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { assetByStem } from './lib/current-assets.mjs';

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

test('the runtime cache stores only exact same-origin responses, not look-alike hosts', async () => {
  const events = new Map(), stored = [];
  const context = {
    Request, URL, Headers, Response, AbortController, Uint8Array, setTimeout, clearTimeout,
    WebAssembly: { validate: () => false },
    self: { location: { origin: 'https://www.occulert.com' }, addEventListener: (name, handler) => events.set(name, handler) },
    fetch: async () => new Response('fixture bytes', { status: 200 }),
    caches: {
      match: async () => undefined,
      open: async () => ({ put: async request => { stored.push(new URL(request.url).href); } }),
    },
  };
  vm.runInNewContext(readFileSync('sw.js', 'utf8'), context);
  for (const href of [
    'https://www.occulert.com/fixture-runtime.png',
    'https://www.occulert.com.example.net/fixture-runtime.png',
    'https://cdn.example.net/fixture-runtime.png',
  ]) {
    let responded;
    events.get('fetch')({ request: new Request(href), respondWith: promise => { responded = promise; }, waitUntil() {} });
    assert.equal((await responded).status, 200, href);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(stored, ['https://www.occulert.com/fixture-runtime.png']);
});
