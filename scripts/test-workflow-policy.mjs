import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { auditWorkflowPolicy } from './lib/workflow-policy.mjs';

const sha = '1234567890abcdef1234567890abcdef12345678';
const fixture = (checkout = '6.1.0', setup = '6.5.0', input = '.nvmrc') => `
jobs:
  checks:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@${sha} # v${checkout}
      - name: Set Node version
        uses: actions/setup-node@${sha} # v${setup}
        with:
          node-version-file: ${input}
      - run: npm ci
`;
const check = source => auditWorkflowPolicy(source, { requireNodeSetup: true });

test('current and newer semantic action versions accept .nvmrc including v7 documented quoting', () => {
  assert.deepEqual(check(fixture()), []);
  assert.deepEqual(check(fixture('7.0.1', '7.0.0', "'.nvmrc'")), []);
  assert.deepEqual(check(fixture('7.0.1', '7.0.0', '".nvmrc" # project runtime')), []);
});

test('mutable action refs, shortened SHAs, incomplete versions and older majors are rejected', () => {
  for (const source of [
    fixture().replace(`checkout@${sha}`, 'checkout@v7'),
    fixture().replace(`setup-node@${sha}`, 'setup-node@1234567'),
    fixture('6', '6.5.0'), fixture('6.1.0', '7.0'), fixture('5.1.0'),
    fixture('6.1.0', '5.0.0'), fixture('6.1.0', '6.5.0 prerelease'),
    fixture().replace('# v6.1.0', '# v6.1.0 extra text'),
  ]) assert.notDeepEqual(check(source), [], source);
});

test('one valid setup cannot hide another setup with a missing or incorrect Node input', () => {
  const second = `      - uses: actions/setup-node@${sha} # v7.0.0\n        with:\n          cache: npm\n`;
  assert.match(check(fixture() + second).join('\n'), /every setup-node step/);
  assert.match(check(fixture('6.1.0', '6.5.0', '.node-version')).join('\n'), /every setup-node step/);
  const misplaced = fixture().replace('          node-version-file: .nvmrc\n', '') + '      - name: Other step\n        with:\n          node-version-file: .nvmrc\n';
  assert.match(check(misplaced).join('\n'), /every setup-node step/);
  assert.match(check(fixture().replace('        with:', '        env:')).join('\n'), /every setup-node step/);
  assert.match(check(fixture().replace('          node-version-file:', '            node-version-file:')).join('\n'), /every setup-node step/);
  const duplicateInput = fixture().replace('          node-version-file: .nvmrc', '          node-version-file: .nvmrc\n          node-version-file: .node-version');
  assert.match(check(duplicateInput).join('\n'), /every setup-node step/);
  const duplicateWith = fixture().replace('      - run: npm ci', '        with:\n          node-version-file: .node-version\n      - run: npm ci');
  assert.match(check(duplicateWith).join('\n'), /every setup-node step/);
  const override = fixture().replace('          node-version-file: .nvmrc', '          node-version-file: .nvmrc\n          node-version: 26');
  assert.match(check(override).join('\n'), /without a node-version override/);
});

test('all remote actions remain immutable and required actions and OS pins cannot disappear', () => {
  assert.match(check(fixture() + '      - uses: actions/upload-artifact@v8\n').join('\n'), /40-character/);
  assert.match(check(fixture().replace(/.*uses: actions\/checkout.*\n/, '')).join('\n'), /required checkout/);
  assert.match(check(fixture().replace('ubuntu-24.04', 'ubuntu-latest')).join('\n'), /explicit OS/);
  assert.match(check(fixture().replace('ubuntu-24.04', 'macos-latest')).join('\n'), /explicit OS/);
  assert.match(check(fixture().replace('ubuntu-24.04', "'macos-latest'")).join('\n'), /explicit OS/);
});

test('checked-in workflow actions retain full SHAs and version-compatible Node inputs', () => {
  const directory = new URL('../.github/workflows/', import.meta.url);
  for (const file of readdirSync(directory).filter(name => /\.ya?ml$/.test(name))) {
    assert.deepEqual(auditWorkflowPolicy(readFileSync(new URL(file, directory), 'utf8')), [], file);
  }
});
