import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseSessionHistory } from '../native-app/lib/sessionHistoryData.ts';

test('only a missing storage key means empty session history', () => {
  assert.deepEqual(parseSessionHistory(null), []);
  assert.deepEqual(parseSessionHistory('[{"sessionId":"saved"}]'), [{ sessionId: 'saved' }]);
});

test('malformed or unexpected saved history cannot become an empty list', () => {
  for (const raw of ['', '{', '{}', 'null', '"[]"']) {
    assert.throws(() => parseSessionHistory(raw), /Saved session history/);
  }
});

test('both history reads and ordered writes use the fail-closed parser', () => {
  const source = readFileSync(new URL('../native-app/lib/sessionHistory.ts', import.meta.url), 'utf8');
  assert.match(source, /return parseSessionHistory<T>\(await AsyncStorage\.getItem\(HISTORY_KEY\)\)/);
  assert.match(source, /const sessions = parseSessionHistory<T>\(await AsyncStorage\.getItem\(HISTORY_KEY\)\)/);
});
