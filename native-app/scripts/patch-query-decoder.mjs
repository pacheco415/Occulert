import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const original = "const decodeComponent = require('decode-uri-component');";
const compatible = "const decoderModule = require('decode-uri-component');\nconst decodeComponent = decoderModule.default || decoderModule;";

// Expo Router uses query-string's named CommonJS exports. Keep that interface,
// while adopting the upstream decoder's bounded algorithm and ESM default export.
export function patchQueryDecoder(source) {
  if (source.includes(compatible)) return { source, changed: false };
  if (!source.includes(original)) throw Error('Cannot safely patch query-string: decoder import changed upstream.');
  return { source: source.replace(original, compatible), changed: true };
}

export function applyQueryDecoderPatch() {
  let packagePath;
  try {
    packagePath = require.resolve('query-string/package.json');
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    const router = JSON.parse(readFileSync(require.resolve('expo-router/package.json'), 'utf8'));
    // SDK 58 uses URLSearchParams instead. A missing legacy decoder is expected
    // only for this reviewed Router generation; a later upgrade needs review.
    if (router.version.startsWith('58.') && !router.dependencies?.['query-string']) return false;
    throw Error('Review query decoder compatibility: query-string is unexpectedly absent.');
  }
  const queryPackage = JSON.parse(readFileSync(packagePath, 'utf8'));
  if (queryPackage.version !== '7.1.3') throw Error('Review the decoder compatibility patch before changing query-string versions.');
  const sourcePath = require.resolve('query-string');
  const result = patchQueryDecoder(readFileSync(sourcePath, 'utf8'));
  if (result.changed) writeFileSync(sourcePath, result.source);
  return result.changed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(applyQueryDecoderPatch() ? 'Applied query decoder compatibility patch.' : 'Query decoder compatibility checked; no changes needed.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
