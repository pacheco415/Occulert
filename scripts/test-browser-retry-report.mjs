import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectRetriedPasses, formatRetrySummary, reportBrowserRetries } from './report-browser-retries.mjs';

const result = (status, retry = 0) => ({ status, retry });
const entry = (projectName, results, expectedStatus = 'passed') => ({ projectName, expectedStatus, results });
const report = (tests, title = 'a test') => ({ suites: [{ title: 'tests/example.spec.mjs', file: 'tests/example.spec.mjs', specs: [], suites: [
  { title: 'protected follow-ups', specs: [{ title, file: 'tests/example.spec.mjs', line: 12, tests }] },
] }] });

test('only actual recovered passing executions are listed across nested suites and browsers', () => {
  const rows = collectRetriedPasses(report([
    entry('chromium', [result('passed')]),
    entry('webkit', [result('failed'), result('passed', 1)]),
    entry('chromium', [result('timedOut'), result('failed', 1), result('passed', 2)]),
    entry('webkit', [result('interrupted'), result('passed', 1)]),
    entry('webkit', [result('failed'), result('failed', 1)]),
    entry('webkit', [result('skipped')]),
    entry('webkit', [result('failed')], 'failed'),
    entry('webkit', [result('passed'), result('failed', 1)], 'failed'),
    entry('webkit', [result('passed', 1)]),
  ]));
  assert.deepEqual(rows.map(row => [row.project, row.retry]), [['webkit', 1], ['chromium', 2], ['webkit', 1]]);
  assert.equal(rows[0].title, 'tests/example.spec.mjs › protected follow-ups › a test');
  assert.equal(rows[0].file, 'tests/example.spec.mjs');
  assert.equal(rows[0].line, 12);
});

test('a clean report is explicit, while absent or malformed report structures are not clean reports', () => {
  assert.match(formatRetrySummary([{ name: 'browser.json', report: report([entry('webkit', [result('passed')])]) }]), /No tests passed after a retry/);
  for (const value of [null, {}, { suites: [null] }, { suites: [{ specs: [] , suites: {} }] },
    { suites: [{ specs: [{ tests: [{}] }] }] }]) assert.throws(() => collectRetriedPasses(value), /Invalid Playwright/);
});

test('summary identifies the report, browser and source location and escapes Markdown/HTML in titles', () => {
  const summary = formatRetrySummary([{ name: 'onboarding.json', report: report([entry('webkit', [result('failed'), result('passed', 1)])], 'name | <tag>\n[x](url) `code`') }]);
  assert.match(summary, /onboarding\\\.json \| webkit/);
  assert.match(summary, /tests\/example\\\.spec\\\.mjs:12/);
  assert.ok(summary.includes('name \\| &lt;tag&gt; \\[x\\]\\(url\\) \\`code\\`'));
  assert.doesNotMatch(summary, /<tag>|\n\[x\]/);
});

test('CLI combines separate reports, writes the job summary and refuses missing or invalid inputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'occulert-retry-report-'));
  try {
    const first = join(directory, 'onboarding.json'), second = join(directory, 'browser.json'), summaryFile = join(directory, 'summary.md');
    writeFileSync(first, JSON.stringify(report([entry('webkit', [result('failed'), result('passed', 1)])])));
    writeFileSync(second, JSON.stringify(report([entry('chromium', [result('passed')])])));
    const script = fileURLToPath(new URL('./report-browser-retries.mjs', import.meta.url));
    const invoked = spawnSync(process.execPath, [script, first, second], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: summaryFile } });
    assert.equal(invoked.status, 0, invoked.stderr);
    assert.match(invoked.stdout, /1 test execution passed only after retry/);
    assert.equal(readFileSync(summaryFile, 'utf8'), invoked.stdout);
    assert.throws(() => reportBrowserRetries([], { summaryFile: null }), /Expected one or more/);
    writeFileSync(second, 'private captured content');
    const failed = spawnSync(process.execPath, [script, second], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: summaryFile } });
    assert.equal(failed.status, 1);
    assert.doesNotMatch(failed.stderr, /private captured content/);
    assert.match(failed.stderr, /Cannot read a valid Playwright JSON report: browser.json/);
    assert.throws(() => reportBrowserRetries([join(directory, 'missing.json')], { summaryFile: null }), /Cannot read a valid/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
