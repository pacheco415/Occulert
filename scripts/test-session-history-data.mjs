import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseSessionHistory, assignMissingSessionIds } from '../native-app/lib/sessionHistoryData.ts';

test('only a missing storage key means empty session history', () => {
  assert.deepEqual(parseSessionHistory(null), []);
  assert.deepEqual(parseSessionHistory('[{"sessionId":"saved"}]'), [{ sessionId: 'saved' }]);
});

test('malformed or unexpected saved history cannot become an empty list', () => {
  for (const raw of ['', '{', '{}', 'null', '"[]"', '[null]', '[false]', '[1]', '["saved"]', '[[]]', '[{"sessionId":"saved"},null]']) {
    assert.throws(() => parseSessionHistory(raw), /Saved session history/);
  }
});

test('legacy record objects and unknown fields remain intact', () => {
  const raw = '[{"savedAt":"old","unknown":{"keep":true}},{"sessionId":"new"}]';
  assert.deepEqual(parseSessionHistory(raw), JSON.parse(raw));
  assert.deepEqual(parseSessionHistory('[]'), []);
});

test('both history reads and ordered writes use the fail-closed parser', () => {
  const source = readFileSync(new URL('../native-app/lib/sessionHistory.ts', import.meta.url), 'utf8');
  assert.match(source, /const parsed = parseSessionHistory<T>\(await AsyncStorage\.getItem\(HISTORY_KEY\)\)/);
  assert.match(source, /const sessions = parseSessionHistory<T>\(await AsyncStorage\.getItem\(HISTORY_KEY\)\)/);
});


test('legacy duplicates get distinct stable IDs without changing unknown fields or original objects', () => {
  const original = [{savedAt:'same',unknown:{keep:true}}, {savedAt:'same'}, {sessionId:'existing'}];
  const ids=['existing','first','first','second'];
  const migrated=assignMissingSessionIds(original,()=>ids.shift());
  assert.equal(migrated.changed,true);
  assert.deepEqual(migrated.sessions.map(row=>row.sessionId),['first','second','existing']);
  assert.equal(original[0].sessionId,undefined);
  assert.deepEqual(migrated.sessions[0].unknown,{keep:true});
  assert.equal(assignMissingSessionIds(migrated.sessions,()=>{throw Error('unexpected')} ).sessions,migrated.sessions);
  assert.throws(()=>assignMissingSessionIds([{}],()=>''),/identity/);
});
