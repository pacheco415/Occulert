import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseSessionHistory, assignMissingSessionIds, serializeSessionHistory, sessionHistoryNeedsMigration } from '../native-app/lib/sessionHistoryData.ts';

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
  assert.match(source, /const parsed = parseSessionHistory<T>\(raw\)/);
  assert.match(source, /const sessions = parseSessionHistory<T>\(raw\)/);
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


test('versioned history preserves unknown envelope and record fields through updates', () => {
 const raw=JSON.stringify({schemaVersion:1,sessions:[{sessionId:'saved',unknown:42}],futureMetadata:{keep:true}});
 assert.equal(sessionHistoryNeedsMigration(raw),false);
 const encoded=serializeSessionHistory([...parseSessionHistory(raw),{partial:true}],raw);
 assert.deepEqual(JSON.parse(encoded),{schemaVersion:1,sessions:[{sessionId:'saved',unknown:42},{partial:true}],futureMetadata:{keep:true}});
 assert.equal(sessionHistoryNeedsMigration('[{}]'),true);
 assert.equal(sessionHistoryNeedsMigration(null),false);
 assert.deepEqual(JSON.parse(serializeSessionHistory([{partial:true}],'[]')),{schemaVersion:1,sessions:[{partial:true}]});
});

test('future versions and malformed envelopes cannot be read, migrated or overwritten', () => {
 for(const raw of ['{"schemaVersion":2,"sessions":[]}','{"schemaVersion":"1","sessions":[]}','{"schemaVersion":1,"sessions":null}','{"schemaVersion":1,"sessions":[null]}']){
  assert.throws(()=>parseSessionHistory(raw),/Saved session history/);
  assert.throws(()=>sessionHistoryNeedsMigration(raw),/Saved session history/);
  assert.throws(()=>serializeSessionHistory([],raw),/Saved session history/);
 }
 assert.throws(()=>serializeSessionHistory([null],null),/Saved session history/);
});
