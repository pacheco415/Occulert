import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDriverArtifact, inspectSourceGraph, readDriverContract } from './lib/driver-build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const contractPath = join(root, 'source-driver-contract.json');
const { contract } = readDriverContract(contractPath);
const args = process.argv.slice(2);
if (args.some(arg => !['--stdout', '--overrides'].includes(arg)) || new Set(args).size !== args.length) throw new Error('Use build-driver [--stdout]');
let sourceRoot = join(root, 'src'), temporary;
try {
  // Internal source-release staging: compile the actual module graph with only
  // reviewed resource-reference replacements before changing checkout files.
  if (args.includes('--overrides')) {
    const text = readFileSync(0, 'utf8');
    if (Buffer.byteLength(text) > 2_000_000) throw new Error('Source overrides exceed staging limit');
    const overrides = JSON.parse(text);
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) || Object.entries(overrides).some(([name, source]) => !contract.modules.includes(name) || typeof source !== 'string')) throw new Error('Unknown source override');
    inspectSourceGraph(sourceRoot, contract);
    temporary = mkdtempSync(join(tmpdir(), 'occulert-driver-build-'));
    for (const name of contract.modules) writeFileSync(join(temporary, name), overrides[name] ?? readFileSync(join(sourceRoot, name)));
    sourceRoot = temporary;
  }
  const result = await buildDriverArtifact({ sourceRoot, contractPath });
  if (args.includes('--stdout')) process.stdout.write(result.code);
  else {
    mkdirSync(join(root, 'build'), { recursive: true });
    writeFileSync(join(root, 'build/driver-app.js'), result.code);
    writeFileSync(join(root, 'build/driver-provenance.json'), JSON.stringify({ proof: result.proof, provenance: result.provenance }, null, 2) + '\n');
    console.log(`Driver compiled: ${result.proof.compiledBytes} bytes; ${result.proof.compiledSha256}`);
  }
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
