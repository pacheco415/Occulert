import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ALERT_SOUND_OPTIONS,
  alertSoundProfile,
  parseAlertSound,
} from '../native-app/lib/alertSound.ts';

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
  assert.match(settings, /Alert sound/);
  assert.match(settings, /ALERT_SOUND_OPTIONS/);
  assert.match(soundModule, /Classic/);
  assert.match(soundModule, /Lower/);
  assert.match(soundModule, /Higher/);
  assert.match(settings, /audioTestPlayer\.playbackRate/);
  assert.match(alertSystem, /preferences\.alertSound/);
  assert.match(alertSystem, /player\.playbackRate/);
  assert.match(alertSystem, /player\.shouldCorrectPitch/);
  assert.match(settings, /centered three-tone critical sequence/);
});
