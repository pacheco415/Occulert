import { test, expect } from '@playwright/test';

async function openProbe(page, query, audioState = 'running') {
  await page.clock.install({ time: new Date('2026-10-12T05:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-12T05:01:00Z'));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.addInitScript(state => {
    const probe = window.strongAudioProbe = { oscillators: [], players: [], session: { type: 'auto' } };
    Object.defineProperty(navigator, 'audioSession', { configurable: true, value: probe.session });
    class Context {
      constructor() { this.state = state; this.currentTime = 0; this.destination = {}; }
      resume() { return Promise.resolve(); }
      createOscillator() {
        const oscillator = { frequency: { value: 0, events: [], setValueAtTime(value, at) { this.events.push({ value, at }); } },
          connect(gain) { this.gain = gain.gain; }, start() { this.started = true; },
          stop(at) { if (at === undefined || at <= 0) this.stopped = true; else this.scheduledStop = at; }, disconnect() { this.disconnected = true; } };
        probe.oscillators.push(oscillator);
        return oscillator;
      }
      createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
    }
    class Media {
      constructor(src) { this.src = src; this.duration = .9; this.paused = true; this.currentTime = 0; this.plays = []; probe.players.push(this); }
      play() { this.paused = false; this.plays.push({ muted: this.muted, volume: this.volume, loop: this.loop }); return Promise.resolve(); }
      pause() { this.paused = true; }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: state === 'unavailable' ? undefined : Context });
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined });
    window.Audio = Media;
  }, audioState);
  await page.goto('/app.html' + query, { waitUntil: 'load' });
  await expect.poll(() => page.evaluate(() => window.OcculertStartup?.isReady())).toBe(true);
  await page.evaluate(() => {
    window.strongAudioProbe.accepted = [];
    const previous = acceptedAlertHook;
    registerAcceptedAlertHook(reason => {
      window.strongAudioProbe.accepted.push(reason);
      previous?.(reason);
    });
  });
}

async function snapshot(page) {
  return page.evaluate(() => ({
    oscillators: window.strongAudioProbe.oscillators.map(o => ({
      initial: o.frequency.value, events: o.frequency.events, gain: o.gain?.value, started: o.started, stopped: !!o.stopped, scheduledStop: o.scheduledStop,
    })),
    players: window.strongAudioProbe.players.map(p => ({ src: p.src, paused: p.paused, loop: p.loop, currentTime: p.currentTime, plays: p.plays })),
    visible: document.getElementById('alertScreen').classList.contains('show'),
    requested: _alertAudioRequested, routing: window.strongAudioProbe.session.type,
    alerts, headNods, microsleeps, alertEvents: _sessionLog.filter(event => event.type === 'alert').length,
    accepted: window.strongAudioProbe.accepted, experimental: experimentFlags.any,
  }));
}

for (const query of ['', '?alert-pattern=Strong', '?alert-pattern=strong&alert-pattern=strong']) {
  test(`ordinary parked alert remains unchanged for query ${query || '(empty)'}`, async ({ page }) => {
    await openProbe(page, query);
    await page.getByText('Parked diagnostics', { exact: true }).click();
    await page.locator('#demoBtn').click();
    const output = await snapshot(page);
    expect(output.oscillators).toHaveLength(1);
    expect(output.oscillators[0]).toMatchObject({ initial: 880, gain: .25, events: [] });
    await page.clock.fastForward(450);
    expect((await snapshot(page)).oscillators[0].stopped).toBe(true);
    await page.clock.fastForward(1350);
    expect(await snapshot(page)).toMatchObject({ requested: false, visible: false, routing: 'auto', alerts: 0, headNods: 0, microsleeps: 0, alertEvents: 0, accepted: [], experimental: false });
  });
}

for (const level of [1, 2, 3, 4]) {
  test(`strong alert level ${level} has bounded alternating output and matching flash`, async ({ page }) => {
    await openProbe(page, '?alert-pattern=strong');
    await page.evaluate(level => {
      running = true; calibrating = false; confidence = 70; lastAlert = 0;
      lastEscalation = Date.now(); escalationLevel = level - 1;
      beginAlertAudioScope(); trigger('Fatigue');
    }, level);
    const output = await snapshot(page), duration = level >= 3 ? 4000 : 2500;
    expect(output.oscillators).toHaveLength(1);
    expect(output.oscillators[0].gain).toBe(level >= 3 ? 1 : .6);
    expect(output.oscillators[0].scheduledStop).toBe(duration / 1000);
    const frequencies = output.oscillators[0].events.map(event => event.value);
    expect(frequencies).toEqual(Array.from({ length: duration / 250 }, (_, index) => index % 2 ? 1100 : 880));
    expect(output).toMatchObject({ visible: true, alerts: 1, experimental: false });
    await page.clock.fastForward(duration - 1);
    expect((await snapshot(page)).visible).toBe(true);
    await page.clock.fastForward(1);
    expect(await snapshot(page)).toMatchObject({ visible: false, oscillators: [{ ...output.oscillators[0], stopped: true }] });
  });
}

for (const state of ['unavailable', 'interrupted']) {
  test(`strong parked fallback repeats one bundled WAV with WebAudio ${state}`, async ({ page }) => {
    await openProbe(page, '?alert-pattern=strong', state);
    await page.getByText('Parked diagnostics', { exact: true }).click();
    await page.locator('#demoBtn').click();
    let output = await snapshot(page);
    expect(output.oscillators).toEqual([]);
    expect(output.players).toHaveLength(1);
    expect(output.players[0]).toMatchObject({ src: '/audio/alert.v1.wav', paused: false, loop: true });
    expect(output.players[0].plays.at(-1)).toEqual({ muted: false, volume: .6, loop: true });
    await page.clock.fastForward(2499);
    expect((await snapshot(page)).players[0].paused).toBe(false);
    await page.clock.fastForward(1);
    output = await snapshot(page);
    expect(output).toMatchObject({ visible: false, requested: false, routing: 'auto', alerts: 0, headNods: 0, microsleeps: 0, alertEvents: 0, accepted: [] });
    expect(output.players[0]).toMatchObject({ paused: true, loop: false, currentTime: 0 });
  });
}

for (const state of ['running', 'unavailable']) {
  for (const cancellation of ['Stop', 'hidden']) {
    test(`strong ${state} output cancels immediately on ${cancellation}`, async ({ page }) => {
      await openProbe(page, '?alert-pattern=strong', state);
      await page.evaluate(() => {
        running = true; calibrating = false; confidence = 70; lastAlert = 0;
        beginAlertAudioScope(); trigger('Fatigue');
      });
      if (cancellation === 'Stop') await page.locator('#startBtn').click();
      else await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      const output = await snapshot(page);
      expect(output.visible).toBe(false);
      expect(output.oscillators.every(o => o.stopped)).toBe(true);
      expect(output.players.every(p => p.paused && !p.loop && p.currentTime === 0)).toBe(true);
      await page.clock.fastForward(5000);
      expect((await snapshot(page)).visible).toBe(false);
      expect((await snapshot(page)).oscillators.length).toBe(output.oscillators.length);
      if (cancellation === 'hidden') {
        const audiblePlays = output.players.reduce((count, player) => count + player.plays.filter(play => !play.muted).length, 0);
        await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, value: false });
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
          document.dispatchEvent(new Event('visibilitychange'));
          document.dispatchEvent(new Event('pointerdown'));
        });
        const resumed = await snapshot(page);
        expect(resumed.visible).toBe(false);
        expect(resumed.oscillators.length).toBe(output.oscillators.length);
        expect(resumed.players.reduce((count, player) => count + player.plays.filter(play => !play.muted).length, 0)).toBe(audiblePlays);
      }
    });
  }
}
