import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pngSize = path => {
  const image = readFileSync(new URL(`../${path}`, import.meta.url));
  assert.equal(image.subarray(1, 4).toString('ascii'), 'PNG');
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
};

test('spreadsheet exports neutralize formula cells', () => {
  const { csvCell } = require('../security-utils.js');
  for (const prefix of ['=', '+', '-', '@']) {
    assert.equal(csvCell(`${prefix}SUM(1,1)`), `'${prefix}SUM(1,1)`);
    assert.equal(csvCell(`  ${prefix}SUM(1,1)`), `  '${prefix}SUM(1,1)`);
  }
  assert.equal(csvCell('Driver One'), 'Driver One');
  assert.match(read('fleet-dashboard.html'), /OcculertSecurity\.csvCell/);
  assert.match(read('app.html'), /OcculertSecurity\.csvCell/);
});

test('native cloud writes recheck current consent', () => {
  const cloud = read('native-app/lib/cloudSync.ts');
  const alertWrite = cloud.slice(cloud.indexOf('export async function logCloudAlert'), cloud.indexOf('export async function finishCloudSession'));
  const finishWrite = cloud.slice(cloud.indexOf('export async function finishCloudSession'));
  assert.match(alertWrite, /if \(!await consentEnabled\(\)\) return false/);
  assert.match(finishWrite, /if \(!await consentEnabled\(\)\) return false/);
  assert.match(cloud, /consentOverride/);
});

test('monitoring fails visibly without overlapping the navigation or showing a duplicate modal', () => {
  const monitor = read('native-app/app/monitor.tsx');
  assert.match(monitor, /SENSOR_STARTUP_GRACE_MS = 10_000/);
  assert.match(monitor, /SENSOR_STALL_MS = 5_000/);
  assert.match(monitor, /hasCameraSampleRef\.current \? SENSOR_STALL_MS : SENSOR_STARTUP_GRACE_MS/);
  assert.match(monitor, /hasCameraSampleRef\.current = true/);
  assert.match(monitor, /lastSampleAtRef\.current = Date\.now\(\)/);
  assert.match(monitor, /Monitoring stopped: camera analysis stalled/);
  assert.doesNotMatch(monitor, /Alert\.alert\('Monitoring stopped'/);
  assert.match(monitor, /sensorFault: \{ position: 'absolute', top: 132/);
  assert.match(monitor, /sensitivityLoaded/);
  assert.match(monitor, /disabled=\{isStarting \|\| isStopping \|\| !sensitivityLoaded\}/);
  assert.match(monitor, /updateSessionHistory/);
});

test('native brand assets keep store-safe square dimensions', () => {
  assert.deepEqual(pngSize('native-app/assets/icon.png'), { width: 1024, height: 1024 });
  assert.deepEqual(pngSize('native-app/assets/adaptive-icon.png'), { width: 1024, height: 1024 });
  assert.deepEqual(pngSize('native-app/assets/splash.png'), { width: 2048, height: 2048 });
  assert.deepEqual(pngSize('occulert-logo-alt.png'), { width: 1024, height: 1024 });
  const appConfig = JSON.parse(read('native-app/app.json'));
  assert.equal(appConfig.expo.ios.icon, './assets/icon.png');
});

test('audio and haptic preferences are read when each alert fires', () => {
  const alertSystem = read('native-app/components/AlertSystem.tsx');
  const fire = alertSystem.slice(alertSystem.indexOf('const fire'), alertSystem.indexOf("React.useEffect(() => {\n    if (level"));
  assert.match(fire, /AsyncStorage\.getItem\('occulert-haptic'\)/);
  assert.match(fire, /AsyncStorage\.getItem\('occulert-audio'\)/);
});

test('web critical alerts cannot be snoozed and Watch delivery is conditional', () => {
  const app = read('app.html');
  assert.doesNotMatch(app, /Snooze 5m|function isSnoozed|Alert snoozed/);
  assert.doesNotMatch(app, /alerts will show on Apple Watch/i);
  assert.match(app, /Watch delivery depends on/i);
});

test('fleet telemetry is explicitly labeled client-reported and unverified', () => {
  assert.match(read('api/events.js'), /telemetry_trust: "unverified_client_report"/);
  assert.match(read('fleet-dashboard.html'), /client-reported and not independently verified/i);
});

test('pilot contacts are server-only and disclosed accurately', () => {
  const signup = read('pilot-signup.html');
  const viewer = read('pilot-leads.html');
  const privacy = read('privacy.html');
  assert.doesNotMatch(signup, /occulert-pilot-leads|savePilotLead|firebase/i);
  assert.doesNotMatch(viewer, /getPilotLeads|occulert-pilot-leads/);
  assert.match(viewer, /does not display contact records/i);
  assert.match(privacy, /Supabase/i);
  assert.match(privacy, /pilot request/i);
});

test('pilot-lead throttling is durable and fails closed', () => {
  const api = read('api/pilot-leads.js');
  const migration = read('db/migrations/20260731_durable_pilot_lead_rate_limit.sql');
  assert.doesNotMatch(api, /new Map\(/);
  assert.match(api, /rpc\/check_pilot_lead_rate_limit/);
  assert.match(api, /rate_limit_unavailable/);
  assert.match(migration, /create or replace function (?:public\.)?check_pilot_lead_rate_limit/i);
});

test('invitation replacement is created before the old link is revoked', () => {
  const api = read('api/fleet-invitations.js');
  const insertAt = api.indexOf('method: "POST"');
  const replacementRevokeAt = api.indexOf('replacement_not_revoked');
  assert.ok(insertAt >= 0 && replacementRevokeAt > insertAt);
});

test('legacy monitors are retired and stale auth helpers are never cached', () => {
  assert.match(read('app-v2.html'), /Legacy monitor retired/i);
  assert.match(read('app-ai-v3.html'), /Legacy monitor retired/i);
  const sw = read('sw.js');
  const assetList = sw.slice(sw.indexOf('const STATIC_ASSETS'), sw.indexOf('];') + 2);
  assert.doesNotMatch(assetList, /occulert-backend\.js|auth-helper\.js/);
  assert.match(sw, /NETWORK_ONLY_ASSETS/);
});

test('claims, outreach, offline wording, and localized safety copy are bounded', () => {
  const outreach = read('PILOT_OUTREACH.md');
  assert.doesNotMatch(outreach, /alert you before it becomes dangerous|before an incident occurs/i);
  assert.match(outreach, /may miss/i);
  assert.match(outreach, /pull over/i);
  assert.doesNotMatch(read('faq.html'), /core AI runs fully offline/i);
  assert.doesNotMatch(read('features.html'), /before they become dangerous/i);
  assert.doesNotMatch(read('about.html'), /Built to Save Lives/i);
  const lang = read('lang.js');
  assert.match(lang, /trust3: "Keine Daten verkauft"/);
  assert.match(lang, /English safety wording pending professional translation/);
});
