import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const assets = JSON.parse(readFileSync(new URL('../asset-versions.json', import.meta.url), 'utf8'));

test('versioned assets are immutable and entry documents revalidate', async ({ request }) => {
  for (const asset of Object.values(assets)) {
    const response = await request.get('/' + asset);
    expect(response.ok(), asset).toBeTruthy();
    expect(response.headers()['cache-control'], asset).toBe('public, max-age=31536000, immutable');
    expect(await response.body(), asset).toEqual(readFileSync(new URL('../' + asset, import.meta.url)));
  }
  for (const path of ['/index.html', '/app.html', '/sw.js', '/manifest.json']) {
    const response = await request.get(path);
    expect(response.headers()['cache-control'], path).toBe('public, max-age=0, must-revalidate');
  }
});
