import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { assetByStem } from './lib/current-assets.mjs';

for (const missingDispatcher of [false, true]) {
  test(`actual service worker installation ${missingDispatcher ? 'fails' : 'completes'} when required page actions ${missingDispatcher ? 'are missing' : 'are cached'}`, async () => {
    const events = new Map(), cached = new Set(), deleted = [];
    const actionPath = '/' + assetByStem('page-actions.js');
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
            if (missingDispatcher && path === actionPath) throw Error('Fixture unavailable dispatcher');
            cached.add(path);
          },
          match: async path => cached.has(path) ? new Response('fixture bytes') : undefined,
        }),
        delete: async name => { deleted.push(name); return true; },
      },
    };
    vm.runInNewContext(readFileSync('sw.js', 'utf8'), context);
    events.get('install')({ waitUntil: promise => { installation = promise; } });
    if (missingDispatcher) {
      await assert.rejects(installation, /Critical offline assets were not cached/);
      assert.equal(skipWaiting, 0);
      assert.equal(deleted.length, 1);
    } else {
      await installation;
      assert.equal(cached.has(actionPath), true);
      assert.equal(skipWaiting, 1);
      assert.deepEqual(deleted, []);
    }
  });
}
