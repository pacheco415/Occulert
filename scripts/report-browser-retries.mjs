import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const failures = new Set(['failed', 'timedOut', 'interrupted']);

export function collectRetriedPasses(report) {
  if (!report || !Array.isArray(report.suites)) throw new Error('Invalid Playwright JSON report');
  const recovered = [];
  function visit(suites, parents = []) {
    for (const suite of suites) {
      if (!suite || !Array.isArray(suite.specs) || suite.suites !== undefined && !Array.isArray(suite.suites)) {
        throw new Error('Invalid Playwright JSON suite');
      }
      const titles = [...parents, suite.title].filter(Boolean);
      for (const spec of suite.specs) {
        if (!spec || !Array.isArray(spec.tests)) throw new Error('Invalid Playwright JSON spec');
        for (const test of spec.tests) {
          if (!test || !Array.isArray(test.results) || typeof test.expectedStatus !== 'string') {
            throw new Error('Invalid Playwright JSON test');
          }
          const last = test.results.at(-1);
          if (test.expectedStatus === 'passed' && last?.status === 'passed'
              && Number.isSafeInteger(last.retry) && last.retry > 0
              && test.results.slice(0, -1).some(result => failures.has(result?.status))) {
            recovered.push({
              project: test.projectName || 'default',
              title: [...titles, spec.title].filter(Boolean).join(' › '),
              file: spec.file || suite.file || 'unknown', line: spec.line,
              retry: last.retry,
            });
          }
        }
      }
      if (suite.suites) visit(suite.suites, titles);
    }
  }
  visit(report.suites);
  return recovered;
}

function cell(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\r\n]/g, ' ').replace(/[\\`*{}\[\]()#+\-.!_|~]/g, '\\$&');
}

export function formatRetrySummary(reports) {
  const rows = reports.flatMap(({ name, report }) => collectRetriedPasses(report).map(test => ({ name, ...test })));
  const lines = ['## Browser tests that passed after retry', '', `Reports checked: ${reports.map(({ name }) => cell(name)).join(', ')}.`, ''];
  if (!rows.length) lines.push('No tests passed after a retry.');
  else {
    lines.push(`${rows.length} test execution${rows.length === 1 ? '' : 's'} passed only after retry.`, '',
      '| Report | Browser | Test | Location | Retries |', '| --- | --- | --- | --- | ---: |');
    for (const test of rows) {
      const location = test.file + (Number.isSafeInteger(test.line) ? ':' + test.line : '');
      lines.push(`| ${cell(test.name)} | ${cell(test.project)} | ${cell(test.title)} | ${cell(location)} | ${test.retry} |`);
    }
  }
  return lines.join('\n') + '\n';
}

export function reportBrowserRetries(paths, { summaryFile = process.env.GITHUB_STEP_SUMMARY } = {}) {
  if (!paths.length) throw new Error('Expected one or more Playwright JSON report paths');
  const reports = paths.map(path => {
    try {
      const report = JSON.parse(readFileSync(path, 'utf8'));
      collectRetriedPasses(report);
      return { name: basename(path), report };
    } catch {
      // Avoid printing report contents, which can contain captured test output.
      throw new Error(`Cannot read a valid Playwright JSON report: ${basename(path)}`);
    }
  });
  const summary = formatRetrySummary(reports);
  if (summaryFile) appendFileSync(summaryFile, summary + '\n');
  return summary;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try { console.log(reportBrowserRetries(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
