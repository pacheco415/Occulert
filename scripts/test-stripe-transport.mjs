import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(new URL('../api/_lib/stripe-test.js', import.meta.url));
const source = readFileSync(new URL('../api/_lib/stripe-test.js', import.meta.url), 'utf8');
const LIMIT = 256 * 1024;
function fixture(response) {
  const calls = [], module = { exports: {} };
  vm.runInNewContext(source, {
    module, require, Buffer, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    process: { env: { STRIPE_TEST_SECRET_KEY: 'sk_test_fixture', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_fixture',
      STRIPE_TEST_PRICE_STARTER: 'price_start', STRIPE_TEST_PRICE_GROWTH: 'price_grow' } },
    fetch: async (url, options) => { calls.push({ url, options }); return response; },
  });
  return { request: () => module.exports.stripeRequest('/v1/prices/price_start'), calls };
}

function streamed(chunks, headers = {}) {
  let pulls = 0, canceled = 0;
  const body = new ReadableStream({
    pull(controller) {
      const value = chunks[pulls++];
      if (value === undefined) controller.close(); else controller.enqueue(Buffer.from(value));
    },
    cancel() { canceled++; },
  }, { highWaterMark: 0 });
  return { response: new Response(body, { headers }), pulls: () => pulls, canceled: () => canceled };
}

test('Stripe rejects an oversized advertised body before consuming it', async () => {
  const stream = streamed(['never read'], { 'content-length': String(LIMIT + 1) });
  const f = fixture(stream.response);
  await assert.rejects(f.request(), /stripe_response_too_large/);
  assert.equal(stream.pulls(), 0);
  assert.equal(stream.canceled(), 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.signal.aborted, true);
});

for (const headers of [{}, { 'content-length': '12' }]) {
  test(`Stripe cancels chunked overflow with ${headers['content-length'] ? 'understated' : 'absent'} Content-Length`, async () => {
    const stream = streamed([Buffer.alloc(LIMIT), 'x', 'must not be read'], headers);
    const f = fixture(stream.response);
    await assert.rejects(f.request(), /stripe_response_too_large/);
    assert.equal(stream.pulls(), 2, 'stop at the first overflowing chunk');
    assert.equal(stream.canceled(), 1);
    assert.equal(f.calls[0].options.signal.aborted, true);
    assert.equal(f.calls.length, 1, 'provider requests must never be retried automatically');
  });
}

test('Stripe accepts an exact-limit JSON body with UTF-8 split across chunks', async () => {
  const value = { livemode: false, description: 'é'.repeat(1000) };
  value.description += 'x'.repeat(LIMIT - Buffer.byteLength(JSON.stringify(value)));
  const bytes = Buffer.from(JSON.stringify(value));
  assert.equal(bytes.length, LIMIT);
  const split = bytes.indexOf(Buffer.from('é')) + 1;
  const stream = streamed([bytes.subarray(0, split), bytes.subarray(split)]);
  const f = fixture(stream.response);
  assert.equal((await f.request()).description, value.description);
  assert.equal(stream.canceled(), 0);
  assert.equal(f.calls[0].options.redirect, 'error', 'billing credentials and mutations must not follow redirects');
});

test('Stripe preserves malformed-body and provider-error handling after bounded reads', async () => {
  await assert.rejects(fixture(new Response('not JSON')).request(), /stripe_invalid_response/);
  const f = fixture(Response.json({ error: { code: 'resource_missing' } }, { status: 404 }));
  await assert.rejects(f.request(), error => error.status === 502 && error.providerStatus === 404 && error.stripeCode === 'resource_missing');
});
