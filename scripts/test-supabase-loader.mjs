import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../supabase-loader.js', import.meta.url), 'utf8');

function boot({ existing = false, outcomes = [] } = {}) {
  const appended = [];
  const active = [];
  const sdk = { createClient() {} };
  const window = { supabase: existing ? sdk : undefined };
  const head = {
    appendChild(script) {
      script.parentNode = head;
      active.push(script);
      appended.push(script.src);
      const outcome = outcomes.shift() || 'error';
      queueMicrotask(() => {
        if (outcome === 'load') {
          window.supabase = sdk;
          script.onload?.();
        } else {
          script.onerror?.();
        }
      });
    },
    removeChild(script) {
      const index = active.indexOf(script);
      if (index >= 0) active.splice(index, 1);
      script.parentNode = null;
    },
  };
  const document = {
    head,
    createElement() { return { dataset: {}, parentNode: null, onload: null, onerror: null }; },
    querySelectorAll() { return active.slice(); },
  };
  const context = { window, document, Error, Promise, Boolean, Array, setTimeout, clearTimeout, queueMicrotask };
  window.window = window;
  vm.runInNewContext(source, context);
  return { loader: window.OcculertSupabaseLoader, appended, outcomes };
}

test('the pinned same-origin SDK proxy is attempted before the verified CDN fallback', async () => {
  const { loader, appended } = boot({ outcomes: ['error', 'load'] });
  await loader.load();

  assert.deepEqual(appended, [
    '/vendor/supabase-2.112.3.min.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/dist/umd/supabase.min.js',
  ]);
  assert.equal(loader.state().ready, true);
  assert.equal(loader.state().error, null);
  assert.match(loader.integrity, /^sha384-/);
});

test('a failed Safari SDK load can be retried from the same-origin source', async () => {
  const { loader, appended, outcomes } = boot({ outcomes: ['error', 'error'] });
  await assert.rejects(loader.load(), (error) => error.code === 'sdk_load_failed');
  assert.equal(loader.state().error, 'sdk_load_failed');

  outcomes.push('load');
  await loader.retry();
  assert.equal(appended.at(-1), '/vendor/supabase-2.112.3.min.js');
  assert.equal(loader.state().ready, true);
});

test('an already loaded compatible SDK is reused without injecting another script', async () => {
  const { loader, appended } = boot({ existing: true });
  await loader.load();
  assert.deepEqual(appended, []);
  assert.equal(loader.state().ready, true);
});
