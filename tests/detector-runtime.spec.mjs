import { test, expect } from '@playwright/test';
import { prepareDetectorPage, detectBlankFrame } from './helpers/detector-runtime.mjs';

for (const scalar of [false, true]) {
  test(`self-hosted detector produces a real result without JavaScript eval (${scalar ? 'scalar fallback' : 'automatic SIMD'})`, async ({ page }) => {
    test.setTimeout(120_000);
    const diagnostics = [];
    const requested = [];
    page.on('pageerror', error => diagnostics.push(error.message));
    page.on('request', request => {
      if (request.url().includes('face_mesh')) requested.push(request.url());
    });
    // A CDN outage must not affect monitoring.
    await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
    await prepareDetectorPage(page, scalar);
    const response = await page.goto('/app.html', { waitUntil: 'domcontentloaded' });
    const policy = response.headers()['content-security-policy'];
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain('cdn.jsdelivr.net');
    expect(policy).toContain("'wasm-unsafe-eval'");
    const result = await detectBlankFrame(page);
    expect(result.generation).toBeGreaterThan(0);
    expect(result.lastResultAt).toBeGreaterThan(0);
    expect(requested.length).toBeGreaterThanOrEqual(5);
    for (const url of requested) expect(url).toContain('/vendor/mediapipe/face-mesh-0.4.1633559619-occulert.1/');
    if (scalar) {
      expect(requested.some(url => url.endsWith('/face_mesh_solution_wasm_bin.wasm'))).toBe(true);
      expect(requested.some(url => url.endsWith('/face_mesh_solution_simd_wasm_bin.wasm'))).toBe(false);
    }
    expect(await page.evaluate(() => window.detectorCspViolations)).toEqual([]);
    expect(diagnostics).toEqual([]);
    // Use an ordinary loaded script: DevTools page.evaluate can bypass CSP.
    await page.evaluate(() => {
      const script = document.createElement('script');
      script.src = '/tests/fixtures/csp-eval-probe.js';
      document.body.appendChild(script);
    });
    await expect.poll(() => page.evaluate(() => window.cspEvalProbe)).toBe('EvalError');
  });
}
