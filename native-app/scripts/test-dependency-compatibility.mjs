import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import test from 'node:test';
import { patchQueryDecoder } from './patch-query-decoder.mjs';

const require = createRequire(new URL('../package.json', import.meta.url));
test('query-string keeps named parse/stringify and route options with the patched decoder', () => {
  const query = require('query-string');
  assert.deepEqual({ ...query.parse('name=Caf%C3%A9+driver&name=Second&key=a%26b', { arrayFormat: 'none' }) }, { name: ['Café driver', 'Second'], key: 'a&b' });
  assert.equal(query.stringify({ route: 'a/b', name: 'Café driver', empty: null }), 'empty&name=Caf%C3%A9%20driver&route=a%2Fb');
  assert.deepEqual({ ...query.parse('driver[]=one&driver[]=two', { arrayFormat: 'bracket' }) }, { driver: ['one', 'two'] });
  assert.equal(query.parseUrl('occulert://accept-invite?code=a%2Bb#details').query.code, 'a+b');
  const source = readFileSync(require.resolve('query-string'), 'utf8');
  assert.equal(patchQueryDecoder(source).changed, false, 'clean installs must apply the patch idempotently');
  assert.throws(() => patchQueryDecoder('unrecognized upstream source'), /Cannot safely patch/);
});

test('malformed URL input is decoded without an unbounded CPU wait', async () => {
  const worker = new Worker(`const {parentPort}=require('node:worker_threads');const query=require(${JSON.stringify(require.resolve('query-string'))});parentPort.postMessage(typeof query.parse('value='+ '%FF'.repeat(12000)).value);`, { eval: true });
  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Malformed query decoding stalled')), 3000);
      worker.once('message', message => { clearTimeout(timer); resolve(message); });
      worker.once('error', error => { clearTimeout(timer); reject(error); });
    });
    assert.equal(result, 'string');
  } finally { await worker.terminate(); }
});

test('Watch build plist parser and UUID generation retain their supported APIs', () => {
  const baconsRequire = createRequire(require.resolve('@bacons/xcode'));
  const plistModule = baconsRequire('@expo/plist');
  const plist = plistModule.default || plistModule;
  const value = { CFBundleIdentifier: 'com.occulert.fixture.watch', nested: { enabled: true }, array: ['a', 42] };
  assert.deepEqual(plist.parse(plist.build(value)), value);
  const plistRequire = createRequire(baconsRequire.resolve('@expo/plist'));
  const { DOMImplementation } = plistRequire('@xmldom/xmldom');
  assert.throws(() => new DOMImplementation().createDocument(null, 'root', null).createEntityReference('bad name'));
  for (const consumer of ['xcode', '@bacons/xcode']) {
    const consumerRequire = createRequire(require.resolve(consumer));
    const uuid = consumerRequire('uuid');
    assert.match(uuid.v4(), /^[0-9a-f-]{36}$/);
    assert.throws(() => uuid.v5('fixture', uuid.v5.DNS, new Uint8Array(1)), /buffer|bounds|length/i);
  }
  const project = require('xcode').project('fixture.pbxproj');
  project.hash = { project: { objects: {} } };
  assert.match(project.generateUuid(), /^[A-F0-9]{24}$/);
});
