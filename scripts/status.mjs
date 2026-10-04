import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, rmSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commitPattern = /^[a-f0-9]{40}$/;

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value;
}
function line(value, name, max = 180) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f\u2028\u2029]/.test(value)) {
    throw new Error(`${name} must be a non-empty single line of at most ${max} characters.`);
  }
  return value;
}
function date(value, name) {
  line(value, name, 40);
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2})))?$/.exec(value);
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = parts ? parts.slice(1).map(n => Number(n || 0)) : [];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!parts || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59 || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${name} must be a dated observation, in ISO format.`);
  }
  return value;
}
function commit(value, name) {
  if (typeof value !== 'string' || !commitPattern.test(value)) throw new Error(`${name} must be a complete Git commit hash.`);
  return value;
}
function escapeMarkdown(value) {
  return value.replace(/[\\`*_{}\[\]<>]/g, '\\$&');
}

export function validateObservations(input) {
  const facts = object(input, 'Observations');
  if (facts.schemaVersion !== 1) throw new Error('Unsupported observations schemaVersion.');
  if (facts.production) {
    const p = object(facts.production, 'Production observation');
    commit(p.sourceCommit, 'Production source');
    date(p.createdAt, 'Production deployment date');
    date(p.observedAt, 'Production observation date');
    if (p.state !== 'READY' || !/^dpl_[A-Za-z0-9]+$/.test(p.deploymentId)) throw new Error('Production requires an explicit READY deployment receipt.');
  }
  if (facts.testFlight) {
    const b = object(facts.testFlight, 'TestFlight observation');
    commit(b.sourceCommit, 'TestFlight source');
    date(b.completedAt, 'Native build completion date');
    date(b.observedAt, 'TestFlight observation date');
    if (!/^\d+\.\d+\.\d+$/.test(b.version) || !/^\d+$/.test(b.buildNumber)) throw new Error('TestFlight version and build number must be explicit strings.');
    if (b.processingState !== 'VALID' || b.internalState !== 'IN_BETA_TESTING') throw new Error('This snapshot must identify an observed valid internal TestFlight build.');
    // Availability is not a physical test; acceptance belongs in exact-build device receipts.
    if (b.physicalAcceptance !== 'not_recorded') throw new Error('Physical acceptance must be tracked in a separate device receipt.');
  }
  if (facts.migrations) {
    const m = object(facts.migrations, 'Migration observation');
    date(m.observedAt, 'Migration observation date');
    if (m.state !== 'unknown' && m.state !== 'pending' && m.state !== 'ledger_verified') throw new Error('Invalid migration observation state.');
    line(m.summary, 'Migration summary');
    if (m.state === 'pending' && (!Array.isArray(m.pendingVersions) || !m.pendingVersions.length || m.pendingVersions.some(v => !/^\d{14}$/.test(v)))) {
      throw new Error('Pending migrations require their recorded version strings.');
    }
  }
  return facts;
}

export function summarizePullRequests(input) {
  if (!input) return null;
  const snapshot = object(input, 'Pull request snapshot');
  date(snapshot.observedAt, 'Pull request observation date');
  if (snapshot.complete !== true || !Array.isArray(snapshot.pullRequests)) throw new Error('Pull request counts require a complete, explicitly dated snapshot.');
  const counts = { total: 0, codex: 0, dependabot: 0, other: 0, draft: 0 };
  const seen = new Set();
  for (const pr of snapshot.pullRequests) {
    object(pr, 'Pull request');
    if (!Number.isSafeInteger(pr.number) || pr.number < 1 || seen.has(pr.number) || typeof pr.isDraft !== 'boolean') throw new Error('Pull request numbers must be unique positive integers, with explicit draft state.');
    line(pr.headRefName, 'Pull request branch');
    seen.add(pr.number);
    counts.total++;
    counts[pr.headRefName.startsWith('codex/') ? 'codex' : pr.headRefName.startsWith('dependabot/') ? 'dependabot' : 'other']++;
    if (pr.isDraft) counts.draft++;
  }
  return { ...counts, observedAt: snapshot.observedAt };
}

export function collectGitFacts({ cwd = projectRoot, ref = 'origin/main', buildSource } = {}) {
  line(ref, 'Source ref');
  if (ref.startsWith('-')) throw new Error('Source ref cannot begin with a dash.');
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const sourceCommit = commit(git(['rev-parse', '--verify', `${ref}^{commit}`]), 'Source ref');
  const committedAt = date(git(['show', '-s', '--format=%cI', sourceCommit]), 'Source commit date');
  const facts = { ref, sourceCommit, committedAt, native: { state: 'unknown', reason: 'No TestFlight source receipt supplied.' } };
  if (buildSource) {
    commit(buildSource, 'TestFlight source');
    try {
      git(['cat-file', '-e', `${buildSource}^{commit}`]);
      const paths = git(['diff', '--name-only', buildSource, sourceCommit, '--', 'native-app']).split('\n').filter(path => path && !/^native-app\/(?:docs\/|.*\.md$)/i.test(path));
      facts.native = { state: paths.length ? 'changed' : 'unchanged', paths };
    } catch {
      facts.native = { state: 'unknown', reason: 'The TestFlight source is unavailable in this checkout; use a full-history checkout.' };
    }
  }
  return facts;
}

export function renderStatus({ git, observations = { schemaVersion: 1 }, pullRequests = null }) {
  const facts = validateObservations(observations);
  const prs = summarizePullRequests(pullRequests);
  const lines = ['# Occulert status', '', 'These are dated snapshots. Source, deployment, build availability and device tests are separate.', '',
    `- Inspected source (${escapeMarkdown(git.ref)}): \`${commit(git.sourceCommit, 'Inspected source')}\`.`,
    `- Source commit date: ${date(git.committedAt, 'Source commit date')}.`, ''];
  if (facts.production) {
    const p = facts.production;
    lines.push(`- Production website: \`${p.sourceCommit}\`.`, `- Deployment: ${p.deploymentId}, READY; created ${p.createdAt}.`, `- Production observation: ${p.observedAt}.`);
  } else lines.push('- Production website: Unknown; no deployment receipt supplied.');
  lines.push('');
  if (facts.testFlight) {
    const b = facts.testFlight;
    lines.push(`- TestFlight: ${b.version} (${b.buildNumber}); Apple VALID, internal beta available.`, `- TestFlight source: \`${b.sourceCommit}\`.`, `- Build completed: ${b.completedAt}; availability observed ${b.observedAt}.`, `- Physical acceptance for build ${b.buildNumber}: Not recorded.`);
  } else lines.push('- TestFlight: Unknown; no build receipt supplied.');
  if (git.native.state === 'unchanged') lines.push('- Native changes waiting for a build: None in the inspected source; pending PRs are separate.');
  else if (git.native.state === 'changed') {
    lines.push(`- Native changes waiting for a build: ${git.native.paths.length} files differ from the TestFlight source.`,
      ...git.native.paths.slice(0, 5).map(path => `  - ${escapeMarkdown(path)}`));
    if (git.native.paths.length > 5) lines.push(`  - ${git.native.paths.length - 5} more; inspect the source comparison before preparing a binary.`);
  } else lines.push(`- Native changes waiting for a build: Unknown. ${escapeMarkdown(line(git.native.reason, 'Native comparison reason'))}`);
  lines.push('');
  lines.push(prs ? `- Open PRs (${prs.observedAt}): ${prs.total} total; ${prs.codex} Codex, ${prs.dependabot} Dependabot, ${prs.other} other; ${prs.draft} draft.` : '- Open PRs: Unknown; no complete dated snapshot supplied.');
  if (facts.migrations) {
    const m = facts.migrations;
    lines.push(`- Production migrations (${m.observedAt}): ${m.state.replaceAll('_', ' ')}. ${escapeMarkdown(m.summary)}`);
    if (m.state === 'pending') lines.push(`- Recorded pending versions: ${m.pendingVersions.join(', ')}.`);
  } else lines.push('- Production migrations: Unknown; Git files do not establish a deployed schema.');
  lines.push('', 'Next steps:', '',
    '1. Finish current-source checks for the remaining reviewed PRs and compose them against current main.',
    '2. Prepare the next native release and checklist after selected native changes merge; do not start a build here.',
    '3. Record parked iPhone Silent-mode Safari/PWA alerts, Watch delivery and exact-build device checks.',
    '4. Read the production migration ledger and confirm definitions before enabling PRs #192 and #206.',
    '5. Review remaining security and consent changes, then benchmark parked detector flags before changing released alerts.', '',
    'Refresh the Git facts with `npm run status -- --write` in a current full-history checkout.',
    'Supply dated service receipts in `docs/status-observations.json` and a complete PR snapshot in',
    '`docs/status-pull-requests.json`; optional `--observations FILE`, `--pull-requests FILE` and `--ref REF` override them.',
    'The tool performs no network requests, deployments, builds, database changes or external writes.',
    'See [product scope and evidence rules](APP_ROADMAP.md) and [earlier records](archive/APP_ROADMAP_2026-09-28.md).');
  if (lines.length > 60) throw new Error('Status exceeds the 60-line limit.');
  return `${lines.join('\n')}\n`;
}

export function runStatus(argv, { cwd = projectRoot, write = console.log } = {}) {
  const options = { ref: 'origin/main', observations: 'docs/status-observations.json', pullRequests: 'docs/status-pull-requests.json', save: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write') options.save = true;
    else if (['--ref', '--observations', '--pull-requests'].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      options[{ '--ref': 'ref', '--observations': 'observations', '--pull-requests': 'pullRequests' }[arg]] = value;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  const read = path => JSON.parse(readFileSync(resolve(cwd, path), 'utf8'));
  const observations = validateObservations(read(options.observations));
  const pullRequests = read(options.pullRequests);
  const git = collectGitFacts({ cwd, ref: options.ref, buildSource: observations.testFlight?.sourceCommit });
  const content = renderStatus({ git, observations, pullRequests });
  if (options.save) {
    // Validate everything before touching the document; a malformed receipt cannot truncate it.
    const destination = resolve(cwd, 'docs/STATUS.md');
    const temporary = `${destination}.${process.pid}.tmp`;
    try { writeFileSync(temporary, content, { flag: 'wx' }); renameSync(temporary, destination); }
    finally { rmSync(temporary, { force: true }); }
    write('Updated docs/STATUS.md from local Git and explicitly dated snapshots.');
  } else write(content);
  return content;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try { runStatus(process.argv.slice(2)); }
  catch (error) { console.error(`Status refresh failed: ${error.message}`); process.exitCode = 1; }
}
