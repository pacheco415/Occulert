import { test, expect } from '@playwright/test';
import { SUPABASE_HOST } from '../scripts/lib/csp-policy.mjs';

const ownerA = '11111111-1111-4111-8111-111111111111';
const ownerB = '22222222-2222-4222-8222-222222222222';
const fleetId = owner => owner === ownerA ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const fixedTime = new Date('2026-11-10T08:00:00.000Z');
const aggregate = (active, confirmed, owner = ownerA) => ({
  ok: true, fleet_id: fleetId(owner), active_driver_count: active, confirmed_driver_count: confirmed,
  telemetry_trust: 'unverified_client_report',
});

function auth(owner = ownerA) {
  return {
    access_token: `parked-${owner}`, refresh_token: `refresh-${owner}`,
    expires_at: Math.floor(fixedTime.getTime() / 1000) + 3600,
    user: { id: owner, email: 'parked-fixture@example.invalid' },
  };
}

function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

async function network(page, { signedIn = true } = {}) {
  await page.clock.install({ time: fixedTime });
  await page.clock.pauseAt(fixedTime);
  // Keep all application scripts and the real auth lifecycle. Only transport
  // replies are fixtures; no request reaches a real account or fleet.
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.continue() : route.abort('blockedbyclient'));
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { ok: false, error: 'fixture_unavailable' } }));
  await page.route('**/api/public-config', route => route.fulfill({ json: {
    ok: true, supabase: { configured: true, url: `https://${SUPABASE_HOST}`, anonKey: 'public-test-key' },
  } }));
  await page.addInitScript(value => {
    localStorage.removeItem('occulert-auth');
    if (value) localStorage.setItem('occulert-auth', JSON.stringify(value));
  }, signedIn ? auth() : null);
}

async function driver(page, options = {}) {
  await network(page, options);
  const requests = [];
  await page.route('**/api/parked-alert-checks', async route => {
    const body = route.request().postDataJSON();
    requests.push({ method: route.request().method(), authorization: route.request().headers().authorization, body });
    await route.fulfill({ json: { ok: true, check: body, telemetry_trust: 'unverified_client_report' } });
  });
  await page.addInitScript(() => {
    // Exercise the existing output lifecycle without requiring an audio device.
    class Context {
      constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
      resume() { return Promise.resolve(); }
      createOscillator() {
        return { frequency: { value: 0, setValueAtTime() {} }, connect() {}, start() {}, stop() {}, disconnect() {} };
      }
      createGain() {
        return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} };
      }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: Context });
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined });
  });
  await page.goto('/app.html' + (options.query || ''), { waitUntil: 'load' });
  await expect.poll(() => page.evaluate(() => window.OcculertStartup?.isReady())).toBe(true);
  if (options.sharing !== false && !options.query) {
    await page.locator('#cloudConsent').check();
    if (options.signedIn !== false) await expect.poll(() => page.evaluate(() => cloudReady)).toBe(true);
  }
  await page.getByText('Parked diagnostics', { exact: true }).click();
  return requests;
}

async function completeCheck(page) {
  await page.locator('#demoBtn').click();
  await expect(page.locator('#parkedCheckConfirmation')).toBeHidden();
  await page.clock.runFor(1801);
  await expect(page.locator('#alertScreen')).not.toHaveClass(/show/);
}

async function switchAccount(page, owner) {
  await page.evaluate(value => {
    const oldValue = localStorage.getItem('occulert-auth');
    const newValue = value ? JSON.stringify(value) : null;
    if (newValue) localStorage.setItem('occulert-auth', newValue);
    else localStorage.removeItem('occulert-auth');
    window.dispatchEvent(new StorageEvent('storage', { key: 'occulert-auth', oldValue, newValue }));
  }, owner ? auth(owner) : null);
}

async function detectorTotals(page) {
  return page.evaluate(() => ({
    fatigue, alerts, headNods, microsleeps,
    detectionEvents: _sessionLog.filter(entry => entry.type === 'alert').length,
  }));
}

for (const confirmed of [true, false]) {
  test(`a consented parked check records an explicit ${confirmed ? 'Yes' : 'No'} without detector telemetry`, async ({ page }) => {
    const requests = await driver(page);
    const before = await detectorTotals(page);
    await completeCheck(page);
    await expect(page.locator('#parkedCheckConfirmation')).toBeVisible();
    await expect(page.locator('#parkedCheckConfirmation')).toContainText('Did you hear or feel it?');
    expect(requests).toEqual([]);
    await page.locator(confirmed ? '#parkedCheckYes' : '#parkedCheckNo').click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toEqual({
      method: 'POST', authorization: `Bearer parked-${ownerA}`,
      body: { completed_at: expect.any(String), platform: 'web', confirmed },
    });
    expect(new Date(requests[0].body.completed_at).toISOString()).toBe(requests[0].body.completed_at);
    expect(Date.parse(requests[0].body.completed_at)).toBeGreaterThanOrEqual(fixedTime.getTime());
    expect(Date.parse(requests[0].body.completed_at)).toBeLessThanOrEqual(fixedTime.getTime() + 1801);
    await expect(page.locator('#parkedCheckStatus')).toContainText(/saved|recorded/i);
    await expect(page.locator('#parkedCheckStatus')).not.toContainText(/could not|unable|unavailable/i);
    expect(await detectorTotals(page)).toEqual(before);
    // One response cannot silently create another request or queued upload.
    await page.clock.fastForward(60_000);
    expect(requests).toHaveLength(1);
    expect(await page.evaluate(() => localStorage.getItem('occulert-cloud-outbox'))).toBeNull();
  });
}

for (const options of [{ signedIn: true, sharing: false }, { signedIn: false, sharing: true }]) {
  test(`parked output stays local with ${options.signedIn ? 'cloud consent off' : 'no signed-in account'}`, async ({ page }) => {
    const requests = await driver(page, options);
    const before = await detectorTotals(page);
    await completeCheck(page);
    await expect(page.locator('#alertCheckResult')).toContainText('Test sent to this device');
    await expect(page.locator('#parkedCheckConfirmation')).toBeHidden();
    await page.evaluate(() => document.getElementById('parkedCheckYes').click());
    expect(requests).toEqual([]);
    expect(await detectorTotals(page)).toEqual(before);
  });
}

test('a parked detector experiment does not offer or send a cloud confirmation', async ({ page }) => {
  const requests = await driver(page, { query: '?calibration-min=12' });
  await page.evaluate(() => {
    document.getElementById('cloudConsent').checked = true;
    document.getElementById('cloudConsent').dispatchEvent(new Event('change'));
  });
  await expect(page.locator('#cloudConsent')).not.toBeChecked();
  await completeCheck(page);
  await expect(page.locator('#parkedCheckConfirmation')).toBeHidden();
  expect(requests).toEqual([]);
});

test('revoking consent during the cue invalidates that check even after consent is granted again', async ({ page }) => {
  const requests = await driver(page);
  await page.locator('#demoBtn').click();
  // The cue is still active; mutate the actual consent control and dispatch its
  // native change event without interacting through the full-screen cue.
  await page.evaluate(() => {
    const control = document.getElementById('cloudConsent');
    control.checked = false;
    control.dispatchEvent(new Event('change'));
  });
  await page.clock.runFor(1801);
  await expect(page.locator('#parkedCheckConfirmation')).toBeHidden();
  await page.locator('#cloudConsent').check();
  await expect(page.locator('#parkedCheckConfirmation')).toBeHidden();
  await page.evaluate(() => document.getElementById('parkedCheckYes').click());
  expect(requests).toEqual([]);
  await completeCheck(page);
  await expect(page.locator('#parkedCheckConfirmation')).toBeVisible();
});

test('an account switch clears an unanswered parked check and requires a fresh cue', async ({ page }) => {
  const requests = await driver(page);
  await completeCheck(page);
  await expect(page.locator('#parkedCheckConfirmation')).toBeVisible();
  await switchAccount(page, ownerB);
  await expect(page.locator('#parkedCheckConfirmation')).toBeHidden();
  await page.evaluate(() => document.getElementById('parkedCheckYes').click());
  expect(requests).toEqual([]);
  await completeCheck(page);
  await expect(page.locator('#parkedCheckConfirmation')).toBeVisible();
  await page.locator('#parkedCheckYes').click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].authorization).toBe(`Bearer parked-${ownerB}`);
});

test('starting monitoring invalidates an unanswered parked check even if the camera start fails', async ({ page }) => {
  const requests = await driver(page);
  await completeCheck(page);
  await expect(page.locator('#parkedCheckConfirmation')).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { async getUserMedia() { throw new DOMException('Synthetic camera denial', 'NotAllowedError'); }, async enumerateDevices() { return []; } },
  }));
  await page.locator('#startBtn').click();
  await expect(page.locator('#parkedCheckConfirmation')).toBeHidden();
  await page.evaluate(() => document.getElementById('parkedCheckYes').click());
  expect(requests).toEqual([]);
});

for (const interruption of ['consent revoked', 'account switched']) {
  test(`a parked answer waiting for token refresh is not dispatched after ${interruption}`, async ({ page }) => {
    const requests = await driver(page);
    await completeCheck(page);
    await expect(page.locator('#parkedCheckConfirmation')).toBeVisible();
    const refresh = gate();
    let refreshRequests = 0;
    await page.route(`https://${SUPABASE_HOST}/auth/v1/token?grant_type=refresh_token`, async route => {
      refreshRequests += 1;
      await refresh.promise;
      await route.fulfill({ json: { ...auth(), access_token: 'parked-refreshed', expires_in: 3600 } });
    });
    // Emulate expiry without an account lifecycle change; a routine refresh is
    // allowed, whereas a later account/consent change must cancel this intent.
    await page.evaluate(() => {
      const value = JSON.parse(localStorage.getItem('occulert-auth'));
      value.expires_at = 1;
      localStorage.setItem('occulert-auth', JSON.stringify(value));
    });
    try {
      await page.locator('#parkedCheckYes').click();
      await expect.poll(() => refreshRequests).toBe(1);
      // Capture the actual shared flight while this account is still current.
      // Calling getSession after a switch could return the new account at once.
      await page.evaluate(() => { window.parkedAuthFlight = window.OcculertBackend.getSession().catch(() => null); });
      if (interruption === 'consent revoked') await page.locator('#cloudConsent').uncheck();
      else await switchAccount(page, ownerB);
      await expect(page.locator('#parkedCheckConfirmation')).toBeHidden();
      refresh.release();
      // Join the shipped refresh flight, so the negative transport assertion
      // does not depend on an arbitrary delay or microtask count.
      await page.evaluate(() => window.parkedAuthFlight);
      expect(requests).toEqual([]);
      await expect(page.locator('#parkedCheckConfirmation')).toBeHidden();
    } finally {
      refresh.release();
    }
  });
}

test('a late parked save result cannot appear in the next signed-in account', async ({ page }) => {
  await driver(page);
  const save = gate();
  let posted = 0, replySent = false, cancelled = 0;
  page.on('requestfailed', request => { if (request.url().includes('/api/parked-alert-checks')) cancelled += 1; });
  await page.route('**/api/parked-alert-checks', async route => {
    posted += 1;
    const check = route.request().postDataJSON();
    await save.promise;
    try {
      await route.fulfill({ json: { ok: true, check, telemetry_trust: 'unverified_client_report' } });
    } catch (error) {
      if (!cancelled) throw error;
    } finally {
      replySent = true;
    }
  });
  try {
    await completeCheck(page);
    await page.locator('#parkedCheckYes').click();
    await expect.poll(() => posted).toBe(1);
    await switchAccount(page, ownerB);
    await expect(page.locator('#parkedCheckConfirmation')).toBeHidden();
    save.release();
    await expect.poll(() => replySent).toBe(true);
    await expect(page.locator('#parkedCheckStatus')).not.toContainText(/saved|recorded/i);
    await expect(page.locator('#parkedCheckConfirmation')).toBeHidden();
    expect(await page.evaluate(() => window.OcculertBackend.currentUser().id)).toBe(ownerB);
  } finally {
    save.release();
  }
});

test('an unavailable parked save is reported without a background retry or queued answer', async ({ page }) => {
  await driver(page);
  let requests = 0;
  await page.route('**/api/parked-alert-checks', route => {
    requests += 1;
    return route.fulfill({ status: 503, json: { ok: false, error: 'parked_alert_checks_not_enabled' } });
  });
  await completeCheck(page);
  await page.locator('#parkedCheckYes').click();
  await expect(page.locator('#parkedCheckStatus')).toContainText(/could not|unavailable|not saved|not recorded/i);
  await page.clock.fastForward(60_000);
  expect(requests).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('occulert-cloud-outbox'))).toBeNull();
});

function fleetSummary(owner = ownerA) {
  return {
    ok: true, fleet: { id: fleetId(owner), company_name: owner === ownerA ? 'First fleet' : 'Second fleet', plan: 'trial' },
    // Deliberately narrower than the complete server count, so the checklist
    // cannot silently substitute its bounded roster snapshot for the total.
    drivers: [{ id: 'driver-1', name: 'Private Driver', active: true }],
    sessions: [], events: [], events_included: false,
    telemetry_trust: 'unverified_client_report',
    privacy: { includes_location: false, includes_personal_media: false, includes_raw_motion: false },
  };
}

async function dashboard(page, handler, { signedIn = true } = {}) {
  await network(page, { signedIn });
  const requests = [];
  await page.route('**/api/fleet-summary*', route => route.fulfill({ json: fleetSummary(
    route.request().headers().authorization === `Bearer parked-${ownerB}` ? ownerB : ownerA,
  ) }));
  await page.route('**/api/fleet-followups*', route => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route('**/api/parked-alert-checks', route => {
    const request = route.request();
    requests.push({ method: request.method(), authorization: request.headers().authorization, url: new URL(request.url()).pathname + new URL(request.url()).search });
    return handler(route, requests.length);
  });
  await page.goto('/fleet-dashboard.html');
  await page.clock.runFor(101);
  return requests;
}

for (const [active, confirmed, state] of [[3, 0, 'pending'], [3, 1, 'available'], [3, 3, 'complete'], [0, 0, 'pending']]) {
  test(`fleet parked check step shows ${confirmed} of ${active} as ${state}`, async ({ page }) => {
    const requests = await dashboard(page, route => route.fulfill({ json: aggregate(active, confirmed) }));
    await expect(page.locator('#cloudStatus')).toContainText('Protected connection active');
    await expect(page.locator('#launchParkedStatus')).toHaveText(`${confirmed} of ${active} active drivers confirmed a parked alert check`);
    await expect(page.locator('#launchParkedStep')).toHaveAttribute('data-state', state);
    expect(requests).toEqual([{ method: 'GET', authorization: `Bearer parked-${ownerA}`, url: '/api/parked-alert-checks' }]);
    await expect(page.locator('#launchParkedStep')).toContainText(/does not|not.*fitness|not.*fit to drive/i);
  });
}

test('a missing parked-check migration stays unavailable rather than becoming zero or complete', async ({ page }) => {
  await dashboard(page, route => route.fulfill({ status: 503, json: { ok: false, error: 'parked_alert_checks_not_enabled' } }));
  await expect(page.locator('#cloudStatus')).toContainText('Protected connection active');
  await expect(page.locator('#launchParkedStatus')).toHaveText('Parked check confirmations unavailable');
  await expect(page.locator('#launchParkedStep')).toHaveAttribute('data-state', 'pending');
  await expect(page.locator('#launchParkedStatus')).not.toContainText('0 of');
});

test('counts from a replaced fleet cannot complete the same owner\'s earlier fleet snapshot', async ({ page }) => {
  await dashboard(page, route => route.fulfill({ json: aggregate(3, 3, ownerB) }));
  await expect(page.locator('#cloudStatus')).toContainText('Protected connection active for First fleet');
  await expect(page.locator('#launchParkedStatus')).toHaveText('Parked check confirmations unavailable');
  await expect(page.locator('#launchParkedStep')).toHaveAttribute('data-state', 'pending');
  await expect(page.locator('#launchParkedStatus')).not.toContainText('3 of 3');
});

test('signed-out local and demo records cannot advance the protected parked check step', async ({ page }) => {
  const requests = await dashboard(page, route => route.fulfill({ json: aggregate(3, 3) }), { signedIn: false });
  await page.getByRole('button', { name: 'Load Demo Data' }).click();
  await expect(page.locator('#launchParkedStep')).toHaveAttribute('data-state', 'pending');
  await expect(page.locator('#launchParkedStatus')).not.toContainText('3 of 3');
  expect(requests).toEqual([]);
});

test('a late first-owner count cannot replace the second owner\'s protected checklist', async ({ page }) => {
  const oldReply = gate();
  let oldReturned = false, cancelled = 0;
  page.on('requestfailed', request => { if (request.url().includes('/api/parked-alert-checks')) cancelled += 1; });
  const requests = await dashboard(page, async route => {
    if (route.request().headers().authorization === `Bearer parked-${ownerA}`) {
      await oldReply.promise;
      try {
        await route.fulfill({ json: aggregate(3, 3) });
      } catch (error) {
        if (!cancelled) throw error;
      } finally {
        oldReturned = true;
      }
      return;
    }
    return route.fulfill({ json: aggregate(2, 1, ownerB) });
  });
  try {
    await expect.poll(() => requests.length).toBe(1);
    await switchAccount(page, ownerB);
    await expect(page.locator('#launchParkedStatus')).not.toContainText('3 of 3');
    oldReply.release();
    await expect.poll(() => oldReturned).toBe(true);
    await expect(page.locator('#cloudStatus')).toContainText('Second fleet');
    await expect(page.locator('#launchParkedStatus')).toHaveText('1 of 2 active drivers confirmed a parked alert check');
    await expect(page.locator('#launchParkedStep')).toHaveAttribute('data-state', 'available');
    expect(requests.at(-1).authorization).toBe(`Bearer parked-${ownerB}`);
  } finally {
    oldReply.release();
  }
});
