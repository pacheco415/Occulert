import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { catalogKeyPaths, compareCatalogKeys, en, strings, formatString, templatePlaceholders } from '../lib/strings.ts';
import { availableNativeLocales, nativeCatalogs, nativeCatalogCoverage, nativeLocaleCodes,
  nativeLocaleReviews, nativeTranslationDrafts, resolveNativeCatalog, validateNativeCatalog } from '../lib/strings/locales.ts';
import { hardCodedCopy } from './lib/hard-coded-copy.mjs';

// Screens whose user-facing copy lives in lib/strings.ts. Add a screen or
// component here when its copy moves; the guard then keeps it migrated.
const MIGRATED_FILES = [
  'app/index.tsx', 'app/_layout.tsx', 'app/monitor.tsx', 'app/history.tsx', 'app/settings.tsx', 'app/pre-drive.tsx',
  'components/SimulatorTraceBanner.tsx', 'components/AlertSystem.tsx', 'components/CameraSetupGuide.tsx',
  'components/LiveMetrics.tsx', 'components/CloudSyncCard.tsx', 'components/SensitivitySlider.tsx',
  'components/EmergencyReadinessCard.tsx', 'components/ParkedReadinessCard.tsx',
  'components/monitor/MonitorPresentation.tsx', 'components/history/FusionValidationPanel.tsx',
  'components/history/HistoryFilters.tsx', 'components/history/HistoryLoadState.tsx',
  'components/history/HistorySessionCard.tsx', 'components/history/HistorySessionDiagnostics.tsx',
  'components/history/HistorySessionReview.tsx', 'components/history/PilotProgressPanel.tsx',
  'hooks/useMonitorAnalysis.ts', 'hooks/useMonitorCameraIdentity.ts', 'hooks/useMonitorCameraLifecycle.ts',
  'constants/thresholds.ts', 'lib/alertSound.ts', 'lib/appBuildInfo.ts', 'lib/feedback.ts',
  'lib/cameraInterruptions.ts', 'lib/cameraSetup.ts',
  'lib/cloudSummaryPresentation.ts', 'lib/cloudSync.ts', 'lib/deviceReadiness.ts', 'lib/emergencyReadiness.ts',
  'lib/frontCameraSwitch.ts', 'lib/fusionValidationSummary.ts', 'lib/historyPreferences.ts',
  'lib/historyPresentation.ts', 'lib/historyReviewModel.ts', 'lib/historyShareMessage.ts', 'lib/historyViewModel.ts',
  'lib/monitorPresentationModel.ts', 'lib/pilotInsights.ts', 'lib/safeStopLinks.ts', 'lib/sessionAlertCount.ts',
  'lib/sessionReviewProgress.ts', 'lib/sessionSummaryValues.ts',
];
const leaf = (catalog, path) => path.split('.').reduce((node, key) => node?.[key], catalog);
// These released sentence fragments include a joiner intentionally. Trimming
// them would change existing output; all other English leaves remain trimmed.
const SPACE_FRAGMENTS = {
  'history.diagnostics.watchRoundTrip': ' · {average} ms average round trip',
  'history.diagnostics.watchQueued': ' · {count} queued backup',
  'settings.watch.test.roundTrip': ' in {milliseconds} ms',
  'preDrive.devices.roadCamera.costDetail': ' Hardware {hardwarePercent}%; pressure {pressurePercent}%.',
};

test('the guard detects hard-coded JSX text, copy props, ternary copy and Alert text', () => {
  const sample = `
    export function Sample({ ready }) {
      return (<View accessibilityRole="button" accessibilityLabel="Start the drive">
        <Ionicons name="warning" size={18} />
        <Text>Stay alert</Text>
        <Text>{ready ? 'Begin safely' : copy.waiting}</Text>
        <Text>{state === 'checking' ? copy.a : copy.b}</Text>
        <TouchableOpacity onPress={() => router.push('/history')} accessibilityHint={copy.hint} />
        <QuickLink label="Session history" href="/history" />
      </View>);
    }
    Alert.alert('Delete history?', copy.body);`;
  assert.deepEqual(hardCodedCopy('sample.tsx', sample).map(entry => entry.text),
    ['Start the drive', 'Stay alert', 'Begin safely', 'Session history', 'Delete history?']);
  assert.deepEqual(hardCodedCopy('clean.tsx', '<Text accessibilityLabel={copy.label}>{copy.title}{`\\n`}</Text>'), []);
  assert.deepEqual(hardCodedCopy('translated.tsx', '<Text>安全提示</Text><Text>تنبيه</Text>').map(entry => entry.text),
    ['安全提示', 'تنبيه']);
});

test('migrated screens read every user-facing string from the catalog', () => {
  for (const file of MIGRATED_FILES) {
    const code = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(code, /from ['"](?:\.\.\/|\.\/)+(?:lib\/)?strings(?:\.ts)?['"]/, `${file} must import the string catalog`);
    assert.deepEqual(hardCodedCopy(file, code), [], `${file} still hard-codes user-facing copy`);
  }
});

test('English leaves are non-empty and preserve only the four intentional joiner fragments', () => {
  assert.equal(strings, en);
  const paths = catalogKeyPaths(en);
  assert.ok(paths.length > 900);
  assert.equal(new Set(paths).size, paths.length);
  for (const path of paths) {
    const value = path.split('.').reduce((node, key) => node[key], en);
    assert.equal(typeof value, 'string', path);
    assert.ok(value.trim().length > 0, `${path} must be non-empty`);
    if (Object.hasOwn(SPACE_FRAGMENTS, path)) assert.equal(value, SPACE_FRAGMENTS[path], path);
    else assert.equal(value, value.trim(), `${path} must be trimmed`);
  }
});

test('the copy guard covers alert configurations, confirmation arrays and Alert buttons', () => {
  const sample = `const CONFIGS = { critical: { title: 'PULL OVER NOW', detail: 'Pull over safely.' } };
    const confirmations = [{ id: 'parked', label: 'I am safely parked', description: 'Set up before moving.' }];
    Alert.alert(copy.title, copy.detail, [{ text: 'Cancel', style: 'cancel' }]);
    const clean = { id: 'critical', style: { fontFamily: 'System' }, title: copy.title };
    const element = <Camera pixelFormat="yuv" key="front" />;`;
  assert.deepEqual(hardCodedCopy('configuration.tsx', sample).map(entry => entry.text),
    ['PULL OVER NOW', 'Pull over safely.', 'I am safely parked', 'Set up before moving.', 'Cancel']);
});

test('malformed catalog trees report missing and extra keys without throwing', () => {
  for (const candidate of [null, undefined, [], 'not a catalog', 5]) {
    assert.deepEqual(compareCatalogKeys(en, candidate).missing, catalogKeyPaths(en));
  }
  const candidate = structuredClone(en);
  candidate.monitor.alerts.critical.title = null;
  candidate.home.historyLink = [];
  candidate.unexpected = { empty: {} };
  const result = compareCatalogKeys(en, candidate);
  assert.ok(result.missing.includes('monitor.alerts.critical.title'));
  assert.ok(result.missing.includes('home.historyLink.label'));
  assert.deepEqual(result.extra, ['home.historyLink', 'unexpected.empty']);
});

test('named templates require exact values and substitute user text only once', () => {
  assert.deepEqual(templatePlaceholders('{count} {label}: {count}'), ['count', 'label']);
  assert.equal(formatString('{label}: {count}', { label: 'Saved {count} $&', count: 3 }), 'Saved {count} $&: 3');
  assert.equal(formatString('Value {value}', { value: 0 }), 'Value 0');
  for (const values of [{}, { value: undefined }, { value: {} }, { value: NaN }, { value: Infinity },
    { value: 1, extra: 2 }, [], null]) {
    assert.throws(() => formatString('Value {value}', values), /Invalid native string template values/);
  }
});

test('native drafts cover exactly the web language set, every native key and every placeholder', () => {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('../../src/driver-i18n.js', import.meta.url), 'utf8'), { module });
  assert.deepEqual([...nativeLocaleCodes], Object.keys(module.exports.locales));
  for (const locale of nativeLocaleCodes) {
    assert.deepEqual(validateNativeCatalog(nativeCatalogs[locale]), { missing: [], extra: [], placeholders: [], invalid: [] }, locale);
    const coverage = nativeCatalogCoverage(locale);
    assert.deepEqual(coverage.missingKeys, [], locale);
    assert.deepEqual(coverage.explicitKeys, catalogKeyPaths(en).sort(), locale);
    if (locale === 'en') continue;
    assert.equal(Object.keys(nativeTranslationDrafts[locale]).length, catalogKeyPaths(en).length, locale);
    // Complete draft sentences exist even for safety-sensitive domains; none
    // becomes released merely because a machine checks its key/placeholder shape.
    for (const path of ['home.parkedSetup', 'monitor.alerts.critical.detail', 'history.alerts.deleteConfirmDetail',
      'settings.cloud.consent.detail', 'preDrive.confirmations.limits.detail']) {
      assert.notEqual(leaf(nativeCatalogs[locale], path), leaf(en, path), `${locale}/${path}`);
    }
  }
});

test('translation validation rejects renamed placeholders, blank copy and malformed templates', () => {
  const candidate = structuredClone(en);
  candidate.monitor.status.accessibilityLabel = 'Status: {state}';
  candidate.settings.cloud.alertRetry.counts += ' {unexpected}';
  candidate.home.settingsLink.label = ' ';
  candidate.home.historyLink.label = 'History {bad-name}';
  const result = validateNativeCatalog(candidate);
  assert.deepEqual(result.placeholders, ['monitor.status.accessibilityLabel', 'settings.cloud.alertRetry.counts']);
  assert.deepEqual(result.invalid, ['home.historyLink.label', 'home.settingsLink.label']);
});

test('unreviewed or unknown languages stay hidden and cannot change released English', () => {
  assert.deepEqual(availableNativeLocales, ['en']);
  assert.equal(resolveNativeCatalog('en'), en);
  for (const locale of nativeLocaleCodes.filter(code => code !== 'en')) {
    assert.equal(nativeLocaleReviews[locale].status, 'unreviewed');
    assert.equal(nativeLocaleReviews[locale].reviewedBy, null);
    assert.equal(nativeLocaleReviews[locale].reviewedAt, null);
    assert.equal(resolveNativeCatalog(locale), en);
  }
  for (const value of [null, undefined, 42, {}, 'unknown', 'EN', 'en-US', 'ar-SA', '__proto__']) {
    assert.equal(resolveNativeCatalog(value), en);
  }
  assert.equal(nativeLocaleReviews.ar.direction, 'rtl');
  assert.equal(strings, en);
  const entry = readFileSync(new URL('../lib/strings.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(entry, /from ['"][^'"]*(?:locales|translations)/);
  for (const file of MIGRATED_FILES) {
    const code = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(code, /(?:I18nManager\.(?:forceRTL|allowRTL)|getLocales\(|resolveNativeCatalog\(|strings\/locales)/, file);
  }
});

test('Monitor alerts, cloud consent, recovery and all pre-drive acknowledgments retain released wording', () => {
  assert.equal(en.monitor.alerts.critical.title, 'PULL OVER NOW');
  assert.equal(en.monitor.alerts.critical.detail, 'High fatigue detected. Pull over safely and rest now.');
  assert.equal(en.monitor.faults.analysisStalled, 'Monitoring stopped: camera analysis stalled. Pull over safely before checking the phone or restarting.');
  assert.equal(en.monitor.safeStop.warning, 'Only use this after you are safely parked, or ask a passenger. Opening Maps ends monitoring and saves this drive first.');
  assert.equal(en.settings.cloud.consent.detail, 'Occulert will send timestamps, fatigue scores, and alert counts to your protected account. Camera images, video, audio, location, and alert ratings stay off the server.');
  assert.equal(en.settings.cloud.signOutIncompleteDetail, 'Sharing is off in this open app, but saved sign-in or sharing settings could not be fully cleared. They may return after restarting. Retry sign-out before closing the app.');
  assert.equal(en.history.alerts.deleteConfirmDetail, 'This permanently removes the local session summary from this iPhone. This cannot be undone.');
  assert.deepEqual(['parked', 'limits', 'foreground', 'rest'].map(key => en.preDrive.confirmations[key]), [
    { title: 'I am safely parked', detail: 'I will mount and position the phone before the vehicle moves.' },
    { title: 'I understand the limits', detail: 'Occulert is a supplemental prototype. It can miss drowsiness or issue false alerts and is not a certified safety, medical, emergency, or compliance device.' },
    { title: 'I will not touch the app while driving', detail: 'I will keep the screen on and Occulert in the foreground, and will only make changes after pulling over safely.' },
    { title: 'I will stop if I feel drowsy or unsafe', detail: 'An Occulert alert never makes it safe to continue driving. I will pull over and rest or arrange other transportation.' },
  ]);
});

test('key parity reports missing and extra keys for a future language', () => {
  assert.deepEqual(compareCatalogKeys(en, en), { missing: [], extra: [] });
  const candidate = structuredClone(en);
  delete candidate.home.recoveryError.retry;
  candidate.home.recoveryError.unexpected = 'Extra';
  candidate.home.historyLink = 'Not a group';
  assert.deepEqual(compareCatalogKeys(en, candidate), {
    missing: ['home.recoveryError.retry', 'home.historyLink.label', 'home.historyLink.detail'],
    extra: ['home.recoveryError.unexpected', 'home.historyLink'],
  });
});

test('moved Home safety and recovery copy keeps its released wording', () => {
  assert.equal(en.home.parkedSetup, 'Set up only while parked. Mount the phone facing you, then keep Occulert in the foreground.');
  assert.equal(en.home.footer, 'Supplemental prototype only. Pull over whenever you feel drowsy or unsafe.');
  assert.equal(en.home.recoveryRecovered.title, 'Previous drive recovered');
  assert.equal(en.home.recoveryError.retryAccessibilityLabel, 'Retry previous drive recovery');
  assert.equal(en.home.start.blockedAccessibilityLabel, 'Pre-drive safety check unavailable while previous drive recovery is unresolved');
});
