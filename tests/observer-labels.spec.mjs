import { test, expect } from '@playwright/test';
import { adaptTrace } from '../benchmark/parked-detection-trace.mjs';
import { parseFile } from '../benchmark/run-event-benchmark.mjs';
import { prepareDetectorPage } from './helpers/detector-runtime.mjs';

test.beforeEach(async ({ page }) => { await prepareDetectorPage(page); });
const ready = page => expect.poll(() => page.evaluate(() => window.OcculertStartup?.isReady())).toBe(true);
async function begin(page) {
  await page.evaluate(() => {
    window.__observerNow = 0;
    const wall = Date.now();
    Date.now = () => wall + window.__observerNow;
    performance.now = () => window.__observerNow;
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 360 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
    canvas.width = 360; canvas.height = 480;
    running = true; starting = false; sessionStart = Date.now(); localSessionId = 'observer-browser-fixture';
    fatigue = 0; confidence = 100; alerts = 0; lastAlert = 0; lastEscalation = 0;
    calibrating = false; calibrated = true; calibrationUntil = 0; calibrationSamples = [];
    earHistory = []; perclosWindow = []; noseYHistory = []; noFaceSince = 0; lastFaceSeen = 0;
    eyesClosedSince = 0; turnedSince = 0; lastMicro = 0; microsleeps = 0;
    baselineEAR = .28; baseClosedThreshold = eyeClosedThreshold = .18; baseWatchThreshold = eyeWatchThreshold = .22;
    startBtn.textContent = 'STOP MONITORING'; startBtn.className = 'btn stop'; setMonitoringUi(true);
    experimentController.begin();
  });
}
async function frame(page, at) {
  await page.evaluate(at => {
    window.__observerNow = at;
    const landmarks = Array.from({ length: 468 }, () => ({ x: .5, y: .5 }));
    for (const [indices, center] of [[LEFT, .62], [RIGHT, .38]]) {
      const h = .3 * .05, points = [[center - .05, .5], [center - .02, .5 - h], [center + .02, .5 - h],
        [center + .05, .5], [center + .02, .5 + h], [center - .02, .5 + h]];
      indices.forEach((index, i) => { landmarks[index] = { x: points[i][0], y: points[i][1] }; });
    }
    landmarks[4] = { x: .5, y: .55 }; landmarks[234] = { x: .25, y: .6 }; landmarks[454] = { x: .75, y: .6 };
    experimentController.capture({ currentTime: at / 1000 });
    onResults({ multiFaceLandmarks: [landmarks] });
  }, at);
}
async function downloadText(page, id) {
  const pending = page.waitForEvent('download'); await page.locator(id).click();
  const download = await pending, stream = await download.createReadStream();
  let text = ''; for await (const chunk of stream) text += chunk;
  return text;
}

test('observer captures independent keyboard/button episodes and exports a matching benchmark pair', async ({ page }) => {
  const api = []; page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url()); });
  await page.goto('/app.html?observer=1&event-outbox=1'); await ready(page);
  await expect(page.locator('#observerLabels')).toBeVisible();
  await expect(page.locator('#cloudConsent')).toBeDisabled();
  expect(await page.evaluate(() => cloudConsent.checked)).toBe(false);
  await begin(page); await page.locator('#observerLabels').focus();
  await frame(page, 100); await page.keyboard.press('Space');
  await expect(page.locator('#observerDrowsy')).toHaveAttribute('aria-pressed', 'true');
  await frame(page, 250); await frame(page, 400); await page.keyboard.press('Space');
  await frame(page, 550); await page.locator('#observerHighFatigue').click();
  await frame(page, 700); await frame(page, 800);
  await page.locator('#startBtn').click(); await expect(page.locator('#exportObserverEpisodes')).toBeVisible();
  const csv = await downloadText(page, '#exportObserverEpisodes');
  expect(csv).toBe('session_id,start_ms,end_ms,label\nobserver-browser-fixture,100,400,drowsy\nobserver-browser-fixture,550,800,high_fatigue\n');
  const trace = JSON.parse(await downloadText(page, '#exportDetectionTrace'));
  const episodes = parseFile(csv, 'episodes');
  const result = adaptTrace(trace, { participant: 'ObserverFixture', split: 'test', episodes });
  expect(result.episodes).toHaveLength(2); expect(result.sessions[0].session_id).toBe('observer-browser-fixture');
  expect(result.summary.experimentFlags).toEqual(['observer']);
  expect(trace.samples.length).toBeGreaterThan(3); expect(trace.session.durationMs).toBe(800);
  expect(trace.samples.some(sample => sample.legacyUsable)).toBe(true);
  expect(trace.samples.every(sample => !sample.tasksUsable && sample.eyeBlinkLeft === null)).toBe(true);
  expect(api).toEqual([]);
});

test('observer hides detector cues while retaining decisions and visible lifecycle guidance', async ({ page }) => {
  await page.goto('/app.html?observer=1'); await ready(page); await begin(page);
  const decision = await page.evaluate(() => {
    window.__observerNow = 13_000; window.__observerStrokes = 0; window.__observerBuzzes = 0;
    ctx.stroke = () => { window.__observerStrokes++; };
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: () => { window.__observerBuzzes++; } });
    fatigue = 100; confidence = 100; trigger('Fatigue'); render(.1); drawEyes([], '#ff3344');
    return { alerts, strokes: window.__observerStrokes, buzzes: window.__observerBuzzes, at: experimentController.summary().retainedAlerts };
  });
  expect(decision).toEqual({ alerts: 1, strokes: 0, buzzes: 0, at: 1 });
  for (const id of ['fatigue', 'perclos', 'risk', 'alerts', 'escalation', 'yawnCountEl', 'marEl', 'calibration', 'alertScreen']) await expect(page.locator('#' + id)).toBeHidden();
  await expect(page.locator('#stateCard')).toBeVisible(); await expect(page.locator('#driveState')).toHaveText('PARKED OBSERVER SESSION');
  await expect(page.locator('#stateCard')).not.toHaveClass(/danger|watch|alert/);
  await page.evaluate(() => { running = false; experimentController.stop(); showStoppedReason('Camera stopped. Restart only while safely parked.'); });
  await expect(page.locator('#stateCard')).toBeVisible(); await expect(page.locator('#driveState')).toHaveText('MONITORING STOPPED');
  await expect(page.locator('#driveHint')).toContainText('Camera stopped');
});

test('observer shortcuts preserve text entry and the keyboard Stop action', async ({ page }) => {
  await page.goto('/app.html?observer=1&perclos=time'); await ready(page); await begin(page);
  await page.evaluate(() => {
    window.__observerNow = 100;
    const input = document.createElement('input'); input.id = 'observerTextEntry'; document.body.append(input);
  });
  await page.locator('#observerTextEntry').focus(); await page.keyboard.type('h h');
  await expect(page.locator('#observerTextEntry')).toHaveValue('h h');
  expect(await page.evaluate(() => experimentController.observerState().activeLabel)).toBeNull();
  await page.locator('#startBtn').focus(); await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => running)).toBe(false);
  expect(await page.evaluate(() => experimentController.observerState().episodes)).toBe(0);
});

test('ordinary and duplicate observer queries retain the existing monitor without optional labeling', async ({ page }) => {
  for (const query of ['', '?observer=1&observer=1', '?observer=true']) {
    const helper = []; const requested = request => { if (/detection-experiments/.test(request.url())) helper.push(request.url()); };
    page.on('request', requested); await page.goto('/app.html' + query); await ready(page);
    await expect(page.locator('#observerLabels')).toBeHidden(); expect(await page.evaluate(() => experimentFlags.any)).toBe(false);
    expect(helper).toEqual([]); page.off('request', requested);
  }
});
