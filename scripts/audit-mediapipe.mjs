import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = 'vendor/mediapipe/face-mesh-0.4.1633559619-occulert.1/';
const manifest = JSON.parse(readFileSync(root + 'runtime-manifest.json', 'utf8'));
const upstream = JSON.parse(readFileSync('scripts/mediapipe/upstream.json', 'utf8'));
const sw = readFileSync('sw.js', 'utf8');
for (const [file, digest] of Object.entries(manifest.files)) {
  const bytes = readFileSync(root + file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, `${file}: vendored digest mismatch`);
  assert.ok(sw.includes('/' + root + file), `${file}: absent from offline install`);
  assert.ok(sw.includes('sha256-' + Buffer.from(digest, 'hex').toString('base64')), `${file}: absent offline integrity pin`);
  if (!/face_mesh_solution_(simd_)?wasm_bin\.js$/.test(file)) assert.equal(digest, upstream.files[file], `${file}: upstream bytes changed`);
  if (file.endsWith('.js')) assert.doesNotMatch(bytes.toString(), /new Function\(|new_\(Function|\beval\s*\(/, `${file}: dynamic JavaScript execution`);
}
assert.deepEqual(Object.keys(manifest.files).sort(), Object.keys(upstream.files).sort());
const cspRules = JSON.parse(readFileSync('vercel.json', 'utf8')).headers;
for (const rule of cspRules) {
  for (const header of rule.headers) {
    if (header.key === 'Content-Security-Policy') assert.ok(!header.value.includes("'unsafe-eval'"), 'JavaScript eval permission must stay removed');
  }
}
const appCsp = cspRules.find(rule => rule.source === '/app.html' && rule.headers.some(h => h.key === 'Content-Security-Policy'));
assert.ok(appCsp && !JSON.stringify(appCsp).includes('cdn.jsdelivr.net'), 'Monitor policy must not depend on the detector CDN');
assert.ok(readFileSync('driver-app.v59.js', 'utf8').includes("FACE_MESH_ASSET_BASE='/vendor/mediapipe/"));
assert.equal(createHash('sha384').update(readFileSync(root + 'face_mesh.js')).digest('base64'), readFileSync('driver-app.v59.js', 'utf8').match(/FACE_MESH_SCRIPT_INTEGRITY='sha384-([^']+)'/)[1]);
assert.equal(createHash('sha256').update(readFileSync('driver-app.v47.js')).digest('hex'), '51827e0997c51078958ac6ef7b85f4311b67a3e3523134e118b4d171b3beb56b', 'Previously published driver bytes must remain immutable');
console.log('Self-hosted MediaPipe integrity, offline asset set and CSP checks passed.');
