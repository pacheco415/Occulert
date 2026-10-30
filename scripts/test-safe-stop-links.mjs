import { readNativeMonitorSourceOwners } from '../native-app/scripts/lib/monitor-source-owners.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  SAFE_STOP_OPTIONS,
  buildSafeStopSearchUrls,
  safeStopSearchQuery,
} from '../native-app/lib/safeStopLinks.ts';

test('safe-stop choices cover the requested destination types', () => {
  assert.deepEqual(
    SAFE_STOP_OPTIONS.map(({ kind }) => kind),
    ['rest-area', 'gas-station', 'food-coffee'],
  );
  assert.equal(safeStopSearchQuery('rest-area'), 'rest area');
  assert.equal(safeStopSearchQuery('gas-station'), 'gas station');
  assert.equal(safeStopSearchQuery('food-coffee'), 'food or coffee');
});

test('iOS uses Apple Maps with a Google Maps web fallback', () => {
  assert.deepEqual(buildSafeStopSearchUrls('ios', 'rest-area'), [
    'http://maps.apple.com/?q=rest%20area',
    'https://www.google.com/maps/search/?api=1&query=rest%20area',
  ]);
});

test('Android uses a geo search with a Google Maps web fallback', () => {
  assert.deepEqual(buildSafeStopSearchUrls('android', 'gas-station'), [
    'geo:0,0?q=gas%20station',
    'https://www.google.com/maps/search/?api=1&query=gas%20station',
  ]);
});

test('other platforms use a portable web search URL', () => {
  assert.deepEqual(buildSafeStopSearchUrls('web', 'food-coffee'), [
    'https://www.google.com/maps/search/?api=1&query=food%20or%20coffee',
  ]);
});

test('the monitor stops and saves before handing off to Maps', () => {
  const owners = readNativeMonitorSourceOwners(), monitor = owners.screen, presentation = owners.view;
  const liveMetrics = readFileSync(new URL('../native-app/components/LiveMetrics.tsx', import.meta.url), 'utf8');
  assert.match(presentation, /alertCount > 0/);
  assert.match(presentation, /Only use this after you are safely parked/);
  assert.match(monitor, /await handleStop\(\{ deferCloudFinalization: true \}\)/);
  const completion = readFileSync(new URL('../native-app/lib/sessionCompletion.ts', import.meta.url), 'utf8');
  assert.match(monitor, /await completeNativeSessionStop/);
  assert.match(monitor, /deferCloudFinalization: Boolean\(options\.deferCloudFinalization\)/);
  assert.match(completion, /void services\.finalize\(localId\)\.catch\(\(\) => \{\}\)/);
  assert.match(monitor, /buildSafeStopSearchUrls\(Platform\.OS, kind\)/);
  assert.match(monitor, /Linking\.openURL\(url\)/);
  assert.match(presentation, /does not read, store, or upload your location/i);

  const controlsStart = presentation.indexOf('<MonitorLayout');
  const metricsStart = presentation.indexOf('<LiveMetrics');
  const safeStopStart = presentation.indexOf('style={s.safeStopBtn}', controlsStart);
  assert.ok(controlsStart >= 0 && controlsStart < metricsStart && metricsStart < safeStopStart);
  const primaryStart = presentation.indexOf('primaryAction={', controlsStart);
  const stopStart = presentation.indexOf('accessibilityLabel="Stop monitoring and save this drive"', primaryStart);
  assert.ok(primaryStart > controlsStart && stopStart > primaryStart && stopStart < metricsStart);
  assert.doesNotMatch(liveMetrics, /metrics:\s*\{\s*position:\s*'absolute'/);
});
