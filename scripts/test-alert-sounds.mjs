import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ALERT_SOUND_OPTIONS,
  alertSoundProfile,
  configureAlertSound,
  parseAlertSound,
} from '../native-app/lib/alertSound.ts';
import { strings } from '../native-app/lib/strings.ts';

test('alert sound choices have a safe default and distinct audible profiles', () => {
  assert.equal(parseAlertSound(null), 'classic');
  assert.equal(parseAlertSound('unknown'), 'classic');
  assert.deepEqual(ALERT_SOUND_OPTIONS.map(([value]) => value), ['classic', 'lower', 'higher']);
  assert.equal(alertSoundProfile('classic').shouldCorrectPitch, true);
  assert.ok(alertSoundProfile('lower').playbackRate < 1);
  assert.ok(alertSoundProfile('higher').playbackRate > 1);
});

test('the selected sound is wired through Settings and phone alert playback', () => {
  const settings = readFileSync(new URL('../native-app/app/settings.tsx', import.meta.url), 'utf8');
  const alertSystem = readFileSync(new URL('../native-app/components/AlertSystem.tsx', import.meta.url), 'utf8');
  const soundModule = readFileSync(new URL('../native-app/lib/alertSound.ts', import.meta.url), 'utf8');
  assert.match(settings, /ALERT_SOUND_PREFERENCE_KEY/);
  assert.match(settings, /strings\.settings\.alerts\.soundTitle/);
  assert.equal(strings.settings.alerts.soundTitle, 'Alert sound');
  assert.match(settings, /ALERT_SOUND_OPTIONS/);
  for (const [value, label] of [['classic', 'Classic'], ['lower', 'Lower'], ['higher', 'Higher']]) {
    assert.ok(soundModule.includes(`label: strings.settings.alertSounds.${value}.label`));
    assert.equal(alertSoundProfile(value).label, label);
  }
  assert.match(settings, /configureAlertSound\(audioTestPlayer, alertSound\)/);
  assert.match(alertSystem, /preferences\.alertSound/);
  assert.match(alertSystem, /configureAlertSound\(player, preferences.alertSound\)/);
  assert.match(settings, /strings\.settings\.audioTest\.parkedDetail/);
  assert.match(strings.settings.audioTest.parkedDetail, /centered three-tone critical sequence/);
});

test('native pitch algorithm is selected before rate changes, including return to Classic', () => {
  const applied = [];
  const player = {
    shouldCorrectPitch: true,
    setPlaybackRate(rate) { applied.push([rate, this.shouldCorrectPitch]); },
  };
  for (const sound of ['lower', 'higher', 'classic']) configureAlertSound(player, sound);
  assert.deepEqual(applied, [[0.84, false], [1.18, false], [1, true]]);
});

// Browser delivery regressions share this existing verification entry.
import './test-browser-alert-audio.mjs';
