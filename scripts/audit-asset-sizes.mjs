import { readFileSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function measureAssets(root, budgets) {
  const versions = JSON.parse(readFileSync(resolve(root, 'asset-versions.json'), 'utf8'));
  return Object.entries(budgets).map(([logical, maxBytes]) => {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw Error(`Invalid budget: ${logical}`);
    const file = versions[logical] || logical;
    if (file.includes('..') || file.includes('/') || !/\.(js|css|html)$/.test(file)) throw Error(`Invalid asset path: ${file}`);
    const bytes = readFileSync(resolve(root, file));
    return { logical, file, raw: bytes.length, gzip: gzipSync(bytes).length, brotli: brotliCompressSync(bytes).length, maxBytes, passed: bytes.length <= maxBytes };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const budgets = JSON.parse(readFileSync(resolve(root, 'asset-size-budgets.json'), 'utf8'));
  const measurements = measureAssets(root, budgets);
  console.table(measurements);
  if (measurements.some(asset => !asset.passed)) process.exitCode = 1;
}
