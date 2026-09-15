// Run after extracting the pinned, integrity-verified npm tarball into a scratch directory.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/vendor-mediapipe.mjs <extracted-package-directory>');
const metadata = JSON.parse(readFileSync('scripts/mediapipe/upstream.json', 'utf8'));
const helpers = JSON.parse(readFileSync('scripts/mediapipe/upstream-helpers.json', 'utf8'));
const output = 'vendor/mediapipe/face-mesh-0.4.1633559619-occulert.1';
const hashes = {};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
mkdirSync(output, { recursive: true });
for (const [file, expected] of Object.entries(metadata.files)) {
  let bytes = readFileSync(join(source, file));
  assert.equal(digest(bytes), expected, `Unexpected upstream bytes: ${file}`);
  if (/face_mesh_solution_(simd_)?wasm_bin\.js$/.test(file)) {
    let text = bytes.toString('utf8');
    for (const [name, original] of Object.entries(helpers)) {
      assert.equal(text.split(original).length, 2, `Expected one ${name} in ${file}`);
      text = text.replace(original, () => readFileSync(`scripts/mediapipe/${name}.js`, 'utf8'));
    }
    assert.doesNotMatch(text, /new Function\(|new_\(Function|\beval\s*\(/);
    bytes = Buffer.from('/* Modified by Occulert: replace three Emscripten dynamic-code helpers with closures. See NOTICE.txt. */\n' + text);
  }
  writeFileSync(join(output, file), bytes);
  hashes[file] = digest(bytes);
}
writeFileSync(join(output, 'runtime-manifest.json'), JSON.stringify({ ...metadata, patchRevision: 1, files: hashes }, null, 2) + '\n');
console.log(`Vendored ${Object.keys(hashes).length} pinned runtime files into ${output}`);
