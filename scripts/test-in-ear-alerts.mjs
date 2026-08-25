import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  nextAlertAudioChannel,
  parseInEarAlertPattern,
} from '../native-app/lib/inEarAlerts.ts';

function readPcmWave(url) {
  const buffer = readFileSync(url);
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buffer.toString('ascii', 8, 12), 'WAVE');

  let channels;
  let sampleRate;
  let bitsPerSample;
  let dataOffset;
  let dataSize;

  for (let offset = 12; offset + 8 <= buffer.length;) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;
    if (id === 'fmt ') {
      channels = buffer.readUInt16LE(payloadOffset + 2);
      sampleRate = buffer.readUInt32LE(payloadOffset + 4);
      bitsPerSample = buffer.readUInt16LE(payloadOffset + 14);
    } else if (id === 'data') {
      dataOffset = payloadOffset;
      dataSize = size;
    }
    offset = payloadOffset + size + (size % 2);
  }

  assert.ok(channels && sampleRate && bitsPerSample && dataOffset != null && dataSize != null);
  return { buffer, channels, sampleRate, bitsPerSample, dataOffset, dataSize };
}

function channelRms(wave, channel) {
  const bytesPerSample = wave.bitsPerSample / 8;
  const bytesPerFrame = bytesPerSample * wave.channels;
  const frameCount = wave.dataSize / bytesPerFrame;
  let sumSquares = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const sample = wave.buffer.readInt16LE(wave.dataOffset + frame * bytesPerFrame + channel * bytesPerSample);
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / frameCount);
}

test('unknown or missing preferences stay balanced', () => {
  assert.equal(parseInEarAlertPattern(null), 'balanced');
  assert.equal(parseInEarAlertPattern('left'), 'balanced');
  assert.equal(parseInEarAlertPattern('alternating'), 'alternating');
});

test('opt-in standard alerts alternate channels', () => {
  const first = nextAlertAudioChannel('alternating', 'watch', null);
  const second = nextAlertAudioChannel('alternating', 'alert', first);
  const third = nextAlertAudioChannel('alternating', 'watch', second);
  assert.deepEqual([first, second, third], ['left', 'right', 'left']);
});

test('critical and tracking-loss alerts always stay balanced', () => {
  assert.equal(nextAlertAudioChannel('alternating', 'critical', 'left'), 'balanced');
  assert.equal(nextAlertAudioChannel('alternating', 'tracking', 'right'), 'balanced');
  assert.equal(nextAlertAudioChannel('balanced', 'alert', null), 'balanced');
});

test('generated directional assets are stereo, audible in both ears, and correctly emphasized', () => {
  const source = readPcmWave(new URL('../native-app/assets/alert.wav', import.meta.url));
  const left = readPcmWave(new URL('../native-app/assets/alert-left.wav', import.meta.url));
  const right = readPcmWave(new URL('../native-app/assets/alert-right.wav', import.meta.url));

  assert.equal(source.channels, 1);
  for (const wave of [left, right]) {
    assert.equal(wave.channels, 2);
    assert.equal(wave.bitsPerSample, 16);
    assert.equal(wave.sampleRate, source.sampleRate);
    assert.equal(wave.dataSize / 4, source.dataSize / 2);
  }

  const leftLoud = channelRms(left, 0);
  const leftQuiet = channelRms(left, 1);
  const rightQuiet = channelRms(right, 0);
  const rightLoud = channelRms(right, 1);
  assert.ok(leftQuiet > 0 && rightQuiet > 0, 'both channels must remain audible');
  assert.ok(leftLoud / leftQuiet > 3, 'left asset must emphasize the left channel');
  assert.ok(rightLoud / rightQuiet > 3, 'right asset must emphasize the right channel');
});

test('the alert engine and Settings wire the preference without weakening urgent alerts', () => {
  const alertSystem = readFileSync(new URL('../native-app/components/AlertSystem.tsx', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../native-app/app/settings.tsx', import.meta.url), 'utf8');
  assert.match(alertSystem, /ALERT_SOUND_LEFT/);
  assert.match(alertSystem, /ALERT_SOUND_RIGHT/);
  assert.match(alertSystem, /nextAlertAudioChannel/);
  assert.match(settings, /Alternate L\/R/);
  assert.match(settings, /Critical and tracking-loss alerts stay centered/);
});

test('Settings can verify the current audio route and headphone-motion readiness while parked', () => {
  const settings = readFileSync(new URL('../native-app/app/settings.tsx', import.meta.url), 'utf8');
  assert.match(settings, /useAudioPlayer\(ALERT_SOUND/);
  assert.match(settings, /configureAlertAudioMode/);
  assert.match(settings, /TEST CURRENT AUDIO OUTPUT/);
  assert.match(settings, /Use only while parked/);
  assert.match(settings, /does not change your alert setting/);
  assert.match(settings, /getHeadphoneMotionStatus/);
  assert.match(settings, /Compatible headphone motion/);
  assert.match(settings, /starts automatically with monitoring/);
});
