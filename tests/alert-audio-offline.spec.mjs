import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AUDIO = '/audio/alert.v1.wav';

test('the pinned alert audio reaches canplaythrough after the origin connection is dropped', async ({ browser }, testInfo) => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const config = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));
  const cacheName = readFileSync(resolve(root, 'sw.js'), 'utf8').match(/const CACHE = '([^']+)'/)[1];
  const sound = readFileSync(resolve(root, AUDIO.slice(1)));
  const expectedHash = createHash('sha256').update(sound).digest('hex');
  const state = { offline: false, refused: [] };
  const evidence = { pageErrors: [], failedRequests: [], audioRequests: [] };
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.wasm': 'application/wasm', '.json': 'application/json', '.wav': 'audio/wav' };
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (state.offline) {
      state.refused.push(path);
      response.destroy();
      return;
    }
    for (const rule of config.headers) {
      if (new RegExp(`^${rule.source}$`).test(path)) {
        for (const { key, value } of rule.headers) response.setHeader(key, value);
      }
    }
    // Neither the fixture page nor a browser HTTP cache may supply offline bytes.
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/audio-range-fixture.html') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Offline alert audio fixture</title><body></body></html>');
      return;
    }
    const file = resolve(root, path === '/' ? 'index.html' : path.slice(1));
    if (!file.startsWith(root + '/') || !existsSync(file)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    response.end(readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext({ baseURL, serviceWorkers: 'allow' });
  let page;
  try {
    page = await context.newPage();
    page.on('pageerror', error => evidence.pageErrors.push(String(error)));
    page.on('request', request => {
      if (new URL(request.url()).pathname === AUDIO) {
        evidence.audioRequests.push({ method: request.method(), range: request.headers().range ?? null });
      }
    });
    page.on('requestfailed', request => {
      evidence.failedRequests.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText });
    });
    await page.goto('/audio-range-fixture.html');
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    // Inspect the real worker's installation; do not seed or mock its audio cache.
    evidence.cached = await page.evaluate(async ({ cacheName, path }) => {
      if (!(await caches.keys()).includes(cacheName)) return { present: false };
      const response = await (await caches.open(cacheName)).match(path);
      if (!response) return { present: false };
      const bytes = await response.arrayBuffer();
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return { present: true, status: response.status, type: response.headers.get('content-type'),
        length: bytes.byteLength, sha256: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
    }, { cacheName, path: AUDIO });
    expect(evidence.cached).toEqual({ present: true, status: 200, type: 'audio/wav',
      length: sound.length, sha256: expectedHash });

    // As in vendor-supabase.spec.mjs, cut the real local origin connection.
    // WebKit's emulated offline mode can reject before the service worker runs.
    state.offline = true;
    await page.evaluate(path => {
      const audio = new Audio();
      audio.preload = 'auto';
      window.__alertAudioProbe = { events: [], canplaythrough: false, error: null };
      for (const event of ['loadedmetadata', 'canplay', 'canplaythrough', 'stalled', 'error']) {
        audio.addEventListener(event, () => {
          window.__alertAudioProbe.events.push(event);
          if (event === 'canplaythrough') window.__alertAudioProbe.canplaythrough = true;
          if (event === 'error') window.__alertAudioProbe.error = audio.error?.code ?? 'unknown';
        });
      }
      document.body.append(audio);
      audio.src = path;
      audio.load();
    }, AUDIO);
    await expect.poll(() => page.evaluate(() => ({
      canplaythrough: window.__alertAudioProbe.canplaythrough,
      error: window.__alertAudioProbe.error,
      readyState: document.querySelector('audio').readyState,
    }))).toEqual({ canplaythrough: true, error: null, readyState: 4 });

    evidence.range = await page.evaluate(async path => {
      const response = await fetch(path, { headers: { Range: 'bytes=0-1' }, cache: 'no-store' });
      return { status: response.status, range: response.headers.get('content-range'),
        length: response.headers.get('content-length'), accepts: response.headers.get('accept-ranges'),
        type: response.headers.get('content-type'), bytes: [...new Uint8Array(await response.arrayBuffer())] };
    }, AUDIO);
    expect(evidence.range).toEqual({ status: 206, range: `bytes 0-1/${sound.length}`,
      length: '2', accepts: 'bytes', type: 'audio/wav', bytes: [...sound.subarray(0, 2)] });

    const networkUnavailable = await page.evaluate(async () => {
      try { await fetch('/api/offline-audio-probe', { cache: 'no-store' }); return false; }
      catch { return true; }
    });
    expect(networkUnavailable).toBe(true);
    expect(state.refused).toContain('/api/offline-audio-probe');
    expect(evidence.pageErrors).toEqual([]);
  } finally {
    try {
      if (page) {
        evidence.media = await page.evaluate(() => ({ ...window.__alertAudioProbe,
          readyState: document.querySelector('audio')?.readyState ?? null,
          controlled: Boolean(navigator.serviceWorker.controller) })).catch(error => ({ unavailable: String(error) }));
      }
      await testInfo.attach('offline-alert-audio-evidence', { contentType: 'application/json',
        body: JSON.stringify({ cacheName, expectedHash, offline: state.offline, refused: state.refused, ...evidence }, null, 2) });
    } finally {
      await context.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
});
