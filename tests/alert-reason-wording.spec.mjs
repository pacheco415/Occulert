import { test, expect } from '@playwright/test';

test.use({ locale: 'es-ES' });

const distractionCue = 'Eyes on the road. Pull over safely if you need to.';
const fatigueTitles = ['DROWSY ALERT', 'LOUD ALERT', 'STRONG ALERT', 'PULL OVER NOW'];
const fatigueSpeech = ['Pull over safely', 'Take a break, you are tired', 'Drowsiness detected, rest now', 'Danger! Pull over immediately'];

async function ready(page, transport) {
  await page.clock.install({ time: new Date('2026-11-08T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-08T12:01:00Z'));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('occulert_lang', 'es');
    localStorage.setItem('occulert-voice', 'true');
    window.alertWordingProbe = { notifications: [], speech: [], workerAttempts: 0 };
    Object.defineProperty(window, 'Notification', { configurable: true, value: class {
      static permission = 'granted';
      constructor(title, options) { window.alertWordingProbe.notifications.push({ title, options, via: 'constructor' }); }
    } });
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: () => true });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      paused: false, resume() {}, cancel() {},
      speak(utterance) { window.alertWordingProbe.speech.push({ text: utterance.text, lang: utterance.lang }); },
    } });
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; this.lang = navigator.language; } };
  });
  await page.goto('/app.html');
  await expect(page.locator('#startBtn')).toBeEnabled();
  await expect(page.locator('#driverLanguage')).toHaveValue('es');
  await expect(page.locator('#driverPanelTitle')).toHaveText('Monitoreo del conductor');
  await page.evaluate(mode => {
    // Exercise the released trigger and registered accepted-alert effects.
    // Substitute notification delivery only; no camera or cloud session is opened.
    calibrating = false;
    confidence = 70;
    const registration = { showNotification: async (title, options) => {
      window.alertWordingProbe.workerAttempts++;
      if (mode === 'worker-fallback') throw Error('Fixture notification delivery unavailable');
      window.alertWordingProbe.notifications.push({ title, options, via: 'service-worker' });
    } };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
      controller: mode === 'constructor' ? null : {},
      ready: Promise.resolve(registration),
    } });
  }, transport);
}

async function assertAlert(page, reason, level, transport) {
  const distracted = reason === 'Distraction';
  await page.evaluate(value => trigger(value), reason);
  await expect(page.locator('#alertScreen')).toBeVisible();
  await expect(page.locator('#alertTitle')).toHaveText(distracted ? 'EYES ON THE ROAD' : fatigueTitles[level - 1]);
  await expect(page.locator('#alertSub')).toHaveText(distracted ? 'Pull over safely if you need to.' : level >= 3 ? 'Pull over safely and rest' : 'Pull over safely');
  await expect.poll(() => page.evaluate(() => window.alertWordingProbe.notifications.length)).toBe(level);
  const state = await page.evaluate(() => ({
    alerts, escalationLevel, locale: navigator.language,
    notification: window.alertWordingProbe.notifications.at(-1),
    speech: window.alertWordingProbe.speech,
    workerAttempts: window.alertWordingProbe.workerAttempts,
    log: _sessionLog.filter(entry => entry.type === 'alert').map(({ value, extra }) => ({ value, extra })),
  }));
  expect(state.alerts).toBe(level);
  expect(state.escalationLevel).toBe(level);
  expect(state.locale).toBe('es-ES');
  expect(state.notification).toEqual({
    title: distracted ? 'Occulert ⚠️ Distraction Alert' : 'Occulert ⚠️ Drowsiness Alert',
    options: {
      body: distracted ? distractionCue : level >= 3 ? 'Pull over safely — confirm safety now' : 'Stay alert! Drowsiness detected.',
      icon: '/occulert-logo-main-192.png', badge: '/occulert-logo-main-96.png',
      tag: expect.stringMatching(/^occulert-alert-\d+$/), silent: false,
      vibrate: level >= 3 ? [700, 150, 700, 150, 700] : [500, 150, 500],
      requireInteraction: level >= 3,
    },
    via: transport === 'service-worker' ? 'service-worker' : 'constructor',
  });
  expect(state.speech).toHaveLength(level);
  expect(state.speech.at(-1)).toEqual({ text: distracted ? distractionCue : fatigueSpeech[level - 1], lang: 'en-US' });
  expect(state.workerAttempts).toBe(transport === 'constructor' ? 0 : level);
  expect(state.log).toHaveLength(level);
  expect(state.log.at(-1)).toEqual({ value: reason, extra: 'esc=' + level });
}

for (const transport of ['constructor', 'service-worker', 'worker-fallback']) {
  for (const reason of ['Distraction', 'Fatigue']) {
    test(`${reason} uses its own wording at every escalation via ${transport}`, async ({ page }) => {
      await ready(page, transport);
      for (let level = 1; level <= 4; level++) {
        if (level > 1) await page.clock.fastForward(12_001);
        await assertAlert(page, reason, level, transport);
      }
    });
  }
}

test('mixed reasons retain the shared escalation ladder and twelve-second cooldown', async ({ page }) => {
  await ready(page, 'constructor');
  await assertAlert(page, 'Distraction', 1, 'constructor');
  await page.clock.fastForward(11_999);
  await page.evaluate(() => trigger('Fatigue'));
  expect(await page.evaluate(() => ({ alerts, escalationLevel, notifications: window.alertWordingProbe.notifications.length, speech: window.alertWordingProbe.speech.length })))
    .toEqual({ alerts: 1, escalationLevel: 1, notifications: 1, speech: 1 });
  await page.clock.fastForward(1);
  await assertAlert(page, 'Fatigue', 2, 'constructor');
});
