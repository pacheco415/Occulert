import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { catalogKeyPaths, compareCatalogKeys, en, strings } from '../lib/strings.ts';
import { hardCodedCopy } from './lib/hard-coded-copy.mjs';

// Screens whose user-facing copy lives in lib/strings.ts. Add a screen or
// component here when its copy moves; the guard then keeps it migrated.
const MIGRATED_FILES = ['app/index.tsx'];

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
});

test('migrated screens read every user-facing string from the catalog', () => {
  for (const file of MIGRATED_FILES) {
    const code = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(code, /from '\.\.\/lib\/strings'/, `${file} must import the string catalog`);
    assert.deepEqual(hardCodedCopy(file, code), [], `${file} still hard-codes user-facing copy`);
  }
});

test('the English catalog has only non-empty, trimmed string leaves', () => {
  assert.equal(strings, en);
  const paths = catalogKeyPaths(en);
  assert.ok(paths.length > 30);
  assert.equal(new Set(paths).size, paths.length);
  for (const path of paths) {
    const value = path.split('.').reduce((node, key) => node[key], en);
    assert.equal(typeof value, 'string', path);
    assert.ok(value.length > 0 && value === value.trim(), `${path} must be non-empty and trimmed`);
  }
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
