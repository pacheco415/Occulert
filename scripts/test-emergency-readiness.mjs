import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { EMERGENCY_READINESS_COPY, EMERGENCY_READINESS_GUIDES } from '../native-app/lib/emergencyReadiness.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const officialGuides = new Map([
  ['medical-id', 'https://support.apple.com/en-us/105072'],
  ['emergency-sos', 'https://support.apple.com/guide/iphone/iph3c99374c/ios'],
  ['crash-detection', 'https://support.apple.com/en-us/104959'],
  ['watch-siren', 'https://support.apple.com/guide/watch/apd49c8baf38/watchos'],
  ['watch-haptics', 'https://support.apple.com/en-us/108368'],
]);

// Guard affirmative product claims while allowing the explicit limitations the
// card must explain. Keep examples below so a broken guard cannot pass silently.
function assertsInformationalOnly(copy) {
  const affirmativeAction = /\b(?:Occulert|this app)\s+(?:(?:can|will|does|automatically|directly|always)\s+)*(?:trigger\w*|activat\w*|contact\w*|call\w*|dispatch\w*|guarantee\w*|ensure\w*)\b/i;
  assert.doesNotMatch(copy, affirmativeAction, 'Occulert must not claim to activate or guarantee emergency help');
}

test('the emergency-readiness copy guard rejects affirmative claims and accepts explicit limits', () => {
  for (const claim of [
    'Occulert triggers Emergency SOS.',
    'Occulert can activate Siren.',
    'Occulert automatically contacts emergency services.',
    'This app will call emergency contacts.',
    'Occulert guarantees emergency help.',
    'Occulert ensures that help arrives.',
  ]) assert.throws(() => assertsInformationalOnly(claim), assert.AssertionError, claim);
  for (const limit of [
    'Occulert does not trigger Siren, SOS, or Crash Detection.',
    'Occulert cannot contact emergency services.',
    'This app will not call emergency contacts.',
    'Occulert never guarantees emergency help.',
    'Occulert cannot guarantee that help will arrive.',
  ]) assert.doesNotThrow(() => assertsInformationalOnly(limit), limit);
});

test('the catalog contains only the five reviewed official Apple setup pages', () => {
  assert.equal(EMERGENCY_READINESS_GUIDES.length, officialGuides.size);
  assert.equal(new Set(EMERGENCY_READINESS_GUIDES.map(guide => guide.id)).size, officialGuides.size);
  for (const guide of EMERGENCY_READINESS_GUIDES) {
    assert.deepEqual(Object.keys(guide).sort(), ['detail', 'id', 'title', 'url']);
    assert.equal(guide.url, officialGuides.get(guide.id));
    const url = new URL(guide.url);
    assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, 'support.apple.com');
    assert.equal(url.username + url.password + url.hash, '');
    assert.ok(guide.title.trim()); assert.ok(guide.detail.trim());
  }
});

test('actual card copy states parked-only informational limits without emergency or device-readiness claims', () => {
  assert.deepEqual(Object.keys(EMERGENCY_READINESS_COPY).sort(), ['availability', 'limits', 'parked', 'privacy', 'title']);
  const copy = Object.values(EMERGENCY_READINESS_COPY).concat(EMERGENCY_READINESS_GUIDES.flatMap(guide => [guide.title, guide.detail])).join('\n');
  assertsInformationalOnly(copy);
  assertsInformationalOnly(read('native-app/components/EmergencyReadinessCard.tsx'));
  assert.match(EMERGENCY_READINESS_COPY.parked, /parked/i);
  assert.match(EMERGENCY_READINESS_COPY.limits, /Occulert/i);
  assert.match(EMERGENCY_READINESS_COPY.limits, /(?:cannot|does not|doesn't)/i);
  for (const required of [/(?:device|model)/i, /(?:OS|software|version)/i, /(?:region|country)/i]) assert.match(EMERGENCY_READINESS_COPY.availability, required);
  assert.match(EMERGENCY_READINESS_GUIDES.find(guide => guide.id === 'watch-siren').detail, /Ultra/i);
  assert.match(EMERGENCY_READINESS_GUIDES.find(guide => guide.id === 'watch-haptics').detail, /(?:hear|feel|notic|perce)/i);
  assert.doesNotMatch(copy, /(?:your|this) (?:iPhone|Watch|device) (?:is ready|is protected|has (?:SOS|Crash Detection|Siren) enabled)/i);
});

test('guidance stays in iOS parked preparation and preserves the four pre-drive safety confirmations', () => {
  const settings = read('native-app/app/settings.tsx');
  const preDrive = read('native-app/app/pre-drive.tsx');
  const monitor = read('native-app/app/monitor.tsx');
  const presentation = read('native-app/components/monitor/MonitorPresentation.tsx');
  assert.match(settings, /Platform\.OS === 'ios'\s*&&\s*<EmergencyReadinessCard\s*\/>/);
  assert.ok(settings.indexOf('<EmergencyReadinessCard') < settings.indexOf('<SensitivitySlider'), 'the optional compact card is near the Settings header');
  const readiness = preDrive.indexOf('<ParkedReadinessCard');
  const guidance = preDrive.indexOf('accessibilityLabel="Review Apple emergency-readiness guidance"');
  const health = preDrive.indexOf('<View style={styles.healthCard}>');
  assert.ok(readiness >= 0 && guidance > readiness, 'guidance follows the existing parked readiness card');
  assert.ok(health > guidance, 'guidance is before optional Health');
  const guidanceSection = preDrive.slice(readiness, health);
  assert.match(guidanceSection, /Platform\.OS === 'ios'/);
  assert.match(guidanceSection, /router\.push\('\/settings'\)/);
  assert.match(guidanceSection, /accessibilityRole="(?:link|button)"/);
  const checks = preDrive.slice(preDrive.indexOf('const CHECKS = ['), preDrive.indexOf('export default function'));
  assert.equal([...checks.matchAll(/title:/g)].length, 4);
  assert.match(preDrive, /checked\.every\(Boolean\)/);
  assert.match(preDrive, /disabled=\{!ready\}/);
  assert.match(preDrive, /confirmPreDriveSafety\(\);\s*router\.replace\('\/monitor'\)/);
  assert.doesNotMatch(monitor + presentation, /EmergencyReadinessCard|EMERGENCY_READINESS_GUIDES/);
  const leave = monitor.slice(monitor.indexOf('  const leaveMonitor'), monitor.indexOf('  const analysis = useMonitorAnalysis'));
  assert.match(leave, /stopBeforeNavigation\(\s*\(\) => handleStopRef\.current\(\{ deferCloudFinalization: true \}\),\s*navigate/);
  assert.match(monitor, /onSettings=\{\(\) => \{ void leaveMonitor\(\(\) => router\.push\('\/settings'\)\); \}\}/);
});
