import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  RELEASE, REQUIRED_WORKFLOWS, SHA, DIGEST, UUID, parseInputs, validateContext,
  validateRun, newestRun, validateJobs, mergedPull, validateFlags,
  validateSourceConfig, validateResolvedConfig, validateEnvironmentList,
  validateProjectInfo, buildSummary, validateReceipt, validateArchiveReview,
} from './lib/testflight-policy.mjs';
import { inspectArchive } from './lib/testflight-archive.mjs';

const controlRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_JSON = 2 * 1024 * 1024;
const MAX_IPA = 1024 * 1024 * 1024;
let phase = 'initialization';

function git(args, cwd = controlRoot, options = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], env: publicEnvironment(), ...options }).trimEnd();
}

// Neither dependency installs nor Git subprocesses inherit either API token.
export function publicEnvironment(source = process.env) {
  const env = { ...source };
  for (const key of ['EXPO_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'NODE_OPTIONS', 'NODE_PATH']) delete env[key];
  return env;
}

export async function boundedBody(response, maximum) {
  const length = response.headers.get('content-length');
  assert.ok(length === null || (/^[0-9]+$/.test(length) && Number(length) <= maximum), 'Remote response is too large.');
  assert.ok(response.body, 'Empty remote response.');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    assert.ok(bytes <= maximum, 'Remote response is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function githubClient(token, fetchImpl = fetch) {
  assert.ok(typeof token === 'string' && token.length > 0, 'GitHub read token is missing.');
  const base = `https://api.github.com/repos/${RELEASE.repository}`;
  async function request(path, { binary = false } = {}) {
    assert.ok(path.startsWith('/') && !path.includes('..') && !path.includes('#'), 'Invalid GitHub API path.');
    const response = await fetchImpl(base + path, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'manual', signal: AbortSignal.timeout(30000),
    });
    if (binary) {
      assert.equal(response.status, 302, 'GitHub did not return a receipt download.');
      const location = new URL(response.headers.get('location'));
      assert.equal(location.protocol, 'https:', 'Receipt download must use HTTPS.');
      assert.ok(!location.username && !location.password && !location.port, 'Unexpected receipt download URL.');
      assert.ok(location.hostname.endsWith('.blob.core.windows.net') || location.hostname.endsWith('.actions.githubusercontent.com')
        || location.hostname === 'objects.githubusercontent.com', 'Unexpected GitHub artifact host.');
      // Never send the GitHub token to artifact storage or follow another redirect.
      const download = await fetchImpl(location, { redirect: 'error', signal: AbortSignal.timeout(30000) });
      assert.equal(download.status, 200, 'Receipt download failed.');
      return boundedBody(download, 128 * 1024);
    }
    assert.equal(response.status, 200, 'GitHub evidence request failed.');
    return JSON.parse((await boundedBody(response, MAX_JSON)).toString('utf8'));
  }
  async function pages(path, field) {
    const result = [];
    for (let page = 1; page <= 10; page++) {
      const body = await request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const items = field ? body[field] : body;
      assert.ok(Array.isArray(items) && items.length <= 100, 'Malformed GitHub evidence list.');
      result.push(...items);
      if (items.length < 100) return result;
    }
    throw new Error('GitHub evidence pagination exceeded its bound.');
  }
  return { request, pages };
}

export async function sourceProof({ client, context, input, isAncestor, readMergeMessage }) {
  phase = 'protected main and exact source checks';
  const main = await client.request('/branches/main');
  validateContext(context, main, input);
  assert.equal(await isAncestor(input.sourceSha, main.commit.sha), true, 'Source is not an ancestor of protected main.');
  assert.equal(/\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]|(?:^|\n)skip-checks:\s*true\s*(?:\n|$)/i.test(await readMergeMessage(input.sourceSha)), false, 'Source merge message contains a CI skip token.');
  const checks = [];
  for (const [workflow, names] of Object.entries(REQUIRED_WORKFLOWS)) {
    const runs = await client.pages(`/actions/workflows/${workflow}/runs?head_sha=${input.sourceSha}&event=push&branch=main`, 'workflow_runs');
    const run = newestRun(runs);
    const proof = validateRun(run, { sourceSha: input.sourceSha, workflow });
    const jobs = await client.pages(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs');
    validateJobs(jobs, run, names);
    checks.push(proof);
  }
  // pull_request_target checks belong to the PR head, not the resulting merge.
  const pull = mergedPull(await client.pages(`/commits/${input.sourceSha}/pulls`), input.sourceSha);
  const policyRuns = await client.pages(`/actions/workflows/ci-policy.yml/runs?head_sha=${pull.head.sha}&event=pull_request_target`, 'workflow_runs');
  const policy = newestRun(policyRuns);
  let mergedPolicyEvidence;
  if (Array.isArray(policy.pull_requests) && policy.pull_requests.length === 0) {
    const currentPull = await client.request(`/pulls/${pull.number}`);
    const commits = await client.pages(`/pulls/${pull.number}/commits`);
    mergedPolicyEvidence = { sourceSha: input.sourceSha, listedPull: pull, currentPull, commits };
  }
  checks.push(validateRun(policy, { sourceSha: pull.head.sha, workflow: 'ci-policy.yml', event: 'pull_request_target',
    pullNumber: pull.number, mergedPolicyEvidence }));
  validateJobs(await client.pages(`/actions/runs/${policy.id}/attempts/${policy.run_attempt}/jobs`, 'jobs'), policy, ['Reject CI skip tokens']);
  const currentMain = await client.request('/branches/main');
  validateContext(context, currentMain, input);
  assert.equal(currentMain.commit.sha, main.commit.sha, 'Main advanced while source checks were read.');
  return { mainSha: main.commit.sha, mergedPull: pull.number, checks };
}

function contextFromEnv(env = process.env) {
  return { repository: env.GITHUB_REPOSITORY, eventName: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF, runAttempt: env.GITHUB_RUN_ATTEMPT, runId: env.GITHUB_RUN_ID,
    workflowRef: env.GITHUB_WORKFLOW_REF, workflowSha: env.GITHUB_WORKFLOW_SHA, sha: env.GITHUB_SHA };
}

function inputsFromEnv(env = process.env) {
  return parseInputs({ mode: env.TF_MODE, sourceSha: env.TF_SOURCE_SHA,
    evidenceRunId: env.TF_EVIDENCE_RUN_ID, buildIdSha256: env.TF_BUILD_ID_SHA256,
    archiveSha256: env.TF_ARCHIVE_SHA256, archiveReviewed: env.TF_ARCHIVE_REVIEWED });
}

export function pathsFromEnv() {
  assert.ok(process.env.RUNNER_TEMP && process.env.GITHUB_WORKSPACE, 'Use a GitHub-hosted workflow runner.');
  assert.equal(resolve(process.env.GITHUB_WORKSPACE), controlRoot, 'Unexpected control checkout.');
  const root = resolve(process.env.RUNNER_TEMP, 'occulert-testflight-control');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return { root, source: resolve(root, 'source'), state: resolve(root, 'state.json'),
    receipt: resolve(root, 'receipt.json'), queued: resolve(root, 'queued.json') };
}

export function sourceIdentity(sourceSha, sourceRoot) {
  assert.match(sourceSha, SHA);
  assert.equal(git(['rev-parse', 'HEAD'], sourceRoot), sourceSha, 'Candidate checkout differs.');
  assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all'], sourceRoot), '', 'Candidate checkout is not clean.');
  return { sourceSha, sourceTree: git(['rev-parse', `${sourceSha}^{tree}`], sourceRoot),
    nativeTree: git(['rev-parse', `${sourceSha}:native-app`], sourceRoot),
    sharedBlob: git(['rev-parse', `${sourceSha}:lib/event-outbox.ts`], sourceRoot),
    easignoreBlob: git(['rev-parse', `${sourceSha}:.easignore`], sourceRoot) };
}

const excludedArchivePath = /(?:^|\/)(?:node_modules|\.git|\.expo|\.eas|\.cache|\.verification-receipts|dependency-reports|dist|web-build|build|test-results|playwright-report|\.idea|\.vscode)(?:\/|$)|(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|credentials\.json|\.DS_Store|Thumbs\.db)$|\.(?:log|jks|p8|p12|key|mobileprovision|swp)$|\.orig\.[^/]*$|^native-app\/(?:ios|android)\/|^native-app\/targets\/occulert-watch\/(?:Assets\.xcassets\/|Info\.plist$)/;

export function verifySourceArchive({ sourceSha, sourceRoot, archiveRoot }) {
  const entries = git(['ls-tree', '-rz', '--full-tree', sourceSha], sourceRoot).split('\0').filter(Boolean);
  const expected = new Map();
  for (const entry of entries) {
    const match = entry.match(/^(\d+) blob ([a-f0-9]{40})\t(.+)$/);
    assert.ok(match, 'Unsupported Git tree entry.');
    const [, mode, blob, name] = match;
    if ((name.startsWith('native-app/') || name === 'lib/event-outbox.ts') && !excludedArchivePath.test(name)) {
      assert.ok(mode === '100644' || mode === '100755', 'Archive source cannot contain symlinks.');
      expected.set(name, { blob, mode });
    }
  }
  const manifest = [];
  function visit(directory) {
    for (const item of readdirSync(directory)) {
      const path = resolve(directory, item), name = relative(archiveRoot, path).split(sep).join('/');
      const stat = lstatSync(path);
      assert.ok(!stat.isSymbolicLink(), 'Source archive contains a symlink.');
      assert.ok(!excludedArchivePath.test(name), 'Source archive contains excluded files.');
      assert.ok(name === 'native-app' || name.startsWith('native-app/') || name === 'lib' || name === 'lib/event-outbox.ts', 'Source archive exposes unrelated files.');
      if (stat.isDirectory()) visit(path);
      else {
        assert.ok(stat.isFile() && stat.size <= 128 * 1024 * 1024, 'Source archive file is unsupported.');
        const source = expected.get(name);
        assert.ok(source, 'Source archive contains an untracked or excluded file.');
        const bytes = readFileSync(path);
        const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        assert.equal(blob, source.blob, 'Source archive bytes differ from the reviewed commit.');
        assert.equal((stat.mode & 0o111) !== 0, source.mode === '100755', 'Source archive executable mode differs.');
        manifest.push({ path: name, blob, sha256: hash(bytes) });
      }
    }
  }
  visit(archiveRoot);
  assert.equal(manifest.length, expected.size, 'Source archive omitted reviewed native inputs.');
  assert.ok(expected.has('lib/event-outbox.ts') && expected.has('native-app/app.json'), 'Required native inputs are absent.');
  manifest.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return { files: manifest.length, sha256: hash(JSON.stringify(manifest)) };
}

function readSourceConfig(source) {
  const app = JSON.parse(readFileSync(resolve(source, 'native-app/app.json'), 'utf8')).expo;
  const eas = JSON.parse(readFileSync(resolve(source, 'native-app/eas.json'), 'utf8'));
  validateSourceConfig(app, eas);
  return { app, eas };
}

async function getReceipt(client, input, state, temporaryRoot) {
  const run = await client.request(`/actions/runs/${input.evidenceRunId}`);
  validateRun(run, { sourceSha: input.sourceSha, workflow: 'testflight-release.yml', event: 'workflow_dispatch', runId: input.evidenceRunId, attempt: 1 });
  const mode = input.mode === 'build' ? 'preflight' : 'build';
  const artifacts = await client.pages(`/actions/runs/${input.evidenceRunId}/artifacts`, 'artifacts');
  const matching = artifacts.filter(artifact => artifact.name === `testflight-${mode}-${input.evidenceRunId}`);
  assert.equal(matching.length, 1, 'The exact successful evidence artifact is required.');
  const artifact = matching[0];
  assert.equal(artifact.expired, false, 'Evidence artifact has expired.');
  assert.ok(Number.isSafeInteger(artifact.id) && artifact.id > 0 && artifact.size_in_bytes <= 128 * 1024, 'Invalid evidence artifact.');
  assert.equal(artifact.workflow_run?.id, run.id, 'Artifact belongs to another run.');
  assert.equal(artifact.workflow_run?.head_sha, input.sourceSha, 'Artifact source differs.');
  const zip = resolve(temporaryRoot, 'prior-receipt.zip');
  writeFileSync(zip, await client.request(`/actions/artifacts/${artifact.id}/zip`, { binary: true }), { mode: 0o600 });
  const members = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8', maxBuffer: 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  assert.equal(members, 'receipt.json', 'Evidence archive contains unexpected files.');
  const raw = execFileSync('unzip', ['-p', zip, 'receipt.json'], { encoding: 'utf8', maxBuffer: 32768, stdio: ['ignore', 'pipe', 'pipe'] });
  return validateReceipt(JSON.parse(raw), { mode, run, source: state });
}

export function runCaptured(command, args, { cwd, env, timeout = 120000, maxBytes = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    const output = [], errors = [];
    let bytes = 0, stopped = false;
    function stop(message) {
      if (stopped) return;
      stopped = true;
      child.kill('SIGKILL');
      clearTimeout(timer);
      reject(new Error(message));
    }
    const timer = setTimeout(() => stop('Command exceeded its time bound; do not automatically retry a release mutation.'), timeout);
    const read = list => chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) stop('Command exceeded its output bound.');
      else list.push(chunk);
    };
    child.stdout.on('data', read(output));
    child.stderr.on('data', read(errors));
    child.on('error', () => stop('Command could not start.'));
    child.on('close', code => {
      clearTimeout(timer);
      if (stopped) return;
      if (code !== 0) reject(new Error('EAS command failed; raw provider output is withheld. Inspect the exact run/build before any new dispatch.'));
      else resolveResult(Buffer.concat(output).toString('utf8'));
    });
  });
}

function easRunner(source, execute = runCaptured) {
  assert.ok(process.env.EXPO_TOKEN, 'Existing EXPO_TOKEN is unavailable.');
  const env = { ...publicEnvironment(), EXPO_TOKEN: process.env.EXPO_TOKEN,
    CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', EXPO_NO_TELEMETRY: '1', EAS_NO_TELEMETRY: '1' };
  validateFlags(env);
  for (const key of ['EAS_NO_VCS', 'EAS_BUILD_GIT_COMMIT_HASH', 'EAS_BUILD_PROFILE', 'EAS_BUILD_PLATFORM']) {
    assert.ok(!env[key], 'Unexpected EAS runner override.');
  }
  return (args, options = {}) => execute('eas', args, { cwd: resolve(source, 'native-app'), env, ...options });
}

export async function easPreflight({ run, source, sourceSha, archiveRoot, config, archiveCheck = verifySourceArchive }) {
  phase = 'EAS CLI version';
  assert.match((await run(['--version'])).trim(), new RegExp(`^eas-cli/${RELEASE.easVersion.replaceAll('.', '\\.')} `), 'Unexpected EAS CLI version.');
  phase = 'EAS authentication and project';
  const identity = (await run(['whoami'])).trim();
  assert.ok(identity.length > 0 && identity.length < 4096 && !/not logged in|log in to|error/i.test(identity), 'EAS authentication could not be established.');
  validateProjectInfo(await run(['project:info']));
  phase = 'production environment';
  const project = await run(['env:list', 'production', '--scope', 'project', '--format', 'long']);
  const account = await run(['env:list', 'production', '--scope', 'account', '--format', 'long']);
  validateEnvironmentList(project, 'project');
  validateEnvironmentList(account, 'account');
  phase = 'resolved production configuration';
  const resolved = JSON.parse(await run(['config', '--platform', 'ios', '--profile', 'production', '--json', '--non-interactive']));
  validateResolvedConfig(resolved, config.app, config.eas);
  phase = 'source archive identity';
  // In pinned EAS 27.10.0 this stage only copies VCS inputs. It does not enter
  // runBuildAndSubmit, gather signing credentials, or access/increment versions.
  await run(['build:inspect', '--platform', 'ios', '--profile', 'production', '--stage', 'archive', '--output', archiveRoot]);
  const sourceArchive = archiveCheck({ sourceSha, sourceRoot: source, archiveRoot });
  return { sourceArchive, productionEnvironmentVerified: true,
    productionEnvironmentSha256: hash(JSON.stringify({ project, account, resolved })) };
}

function writeJson(path, value) {
  const text = JSON.stringify(value, null, 2) + '\n';
  assert.ok(text.length <= 32768, 'Release receipt is too large.');
  writeFileSync(path, text, { mode: 0o600 });
}

export function publicReceipt(state, context, mode, detail = {}) {
  const receipt = { schema: 1, mode, repository: RELEASE.repository, runId: context.runId, runAttempt: 1,
    workflowSha: context.workflowSha, sourceSha: state.sourceSha, sourceTree: state.sourceTree,
    nativeTree: state.nativeTree, sharedBlob: state.sharedBlob, easignoreBlob: state.easignoreBlob,
    easVersion: RELEASE.easVersion, createdAt: new Date().toISOString(),
    sourceChecks: state.proof.checks.map(({ workflow, runId, attempt }) => ({ workflow, runId, attempt })),
    sourceArchive: { files: state.preflight.sourceArchive.files, sha256: state.preflight.sourceArchive.sha256 },
    productionEnvironmentVerified: state.preflight.productionEnvironmentVerified,
    productionEnvironmentSha256: state.preflight.productionEnvironmentSha256 };
  if (detail.build) {
    const build = detail.build;
    receipt.build = {
      idSha256: build.idSha256, sourceSha: build.sourceSha, platform: build.platform,
      distribution: build.distribution, profile: build.profile, simulator: build.simulator,
      status: build.status, appVersion: build.appVersion, appBuildVersion: build.appBuildVersion,
      createdAt: build.createdAt, ...(build.completedAt ? { completedAt: build.completedAt } : {}),
    };
  }
  if (detail.artifact) receipt.artifact = { sha256: detail.artifact.sha256, bytes: detail.artifact.bytes };
  if (mode === 'build' || mode === 'submit') receipt.archiveReview = validateArchiveReview(detail.archiveReview,
    { source: state, build: receipt.build, artifact: receipt.artifact });
  if (mode === 'build' || mode === 'build-queued') receipt.preflightRunId = detail.evidenceRunId;
  if (mode === 'submit') {
    receipt.buildRunId = detail.evidenceRunId;
    receipt.archiveReviewed = true;
    receipt.submissionCommandCompleted = true;
    receipt.appleProcessingAndTesterAvailability = 'not verified by this workflow';
  }
  return receipt;
}

export async function ipaDigest(build, fetchImpl = fetch, privatePath) {
  let url = new URL(build.artifacts?.applicationArchiveUrl ?? '');
  for (let redirect = 0; redirect <= 5; redirect++) {
    assert.equal(url.protocol, 'https:', 'IPA download must use HTTPS.');
    assert.ok(!url.username && !url.password && !url.port, 'Unexpected IPA artifact URL.');
    assert.ok(['expo.dev', 'artifacts.eascdn.net', 'storage.googleapis.com'].includes(url.hostname)
      || url.hostname.endsWith('.storage.googleapis.com'), 'Unexpected Expo artifact host.');
    // Artifact storage never receives EXPO_TOKEN or GITHUB_TOKEN.
    const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(300000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      url = new URL(response.headers.get('location'), url);
      continue;
    }
    assert.equal(response.status, 200, 'IPA download failed.');
    const length = response.headers.get('content-length');
    assert.ok(length === null || (/^[0-9]+$/.test(length) && Number(length) > 0 && Number(length) <= MAX_IPA), 'IPA exceeds the download bound.');
    assert.ok(response.body, 'IPA download was empty.');
    const digest = createHash('sha256');
    let bytes = 0, signature = Buffer.alloc(0), descriptor;
    try {
      if (privatePath) descriptor = openSync(privatePath, 'wx', 0o600);
      for await (const chunk of response.body) {
        bytes += chunk.length;
        assert.ok(bytes <= MAX_IPA, 'IPA exceeds the download bound.');
        if (signature.length < 4) signature = Buffer.concat([signature, chunk]).subarray(0, 4);
        digest.update(chunk);
        if (descriptor !== undefined) {
          let offset = 0;
          while (offset < chunk.length) {
            const written = writeSync(descriptor, chunk, offset, chunk.length - offset);
            assert.ok(written > 0, 'Private IPA write did not progress.');
            offset += written;
          }
        }
      }
      assert.ok(bytes > 0 && signature.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'Artifact is not an IPA ZIP archive.');
      if (length !== null) assert.equal(bytes, Number(length), 'IPA download is incomplete.');
      return { bytes, sha256: digest.digest('hex') };
    } catch (error) {
      if (descriptor !== undefined) rmSync(privatePath, { force: true });
      throw error;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
  throw new Error('Too many IPA artifact redirects.');
}

export async function queueBuild({ run, input, context, recheck }) {
  assert.equal(input.mode, 'build', 'Queue is only available in build mode.');
  await recheck();
  phase = 'queue production build once';
  const output = JSON.parse(await run(['build', '--platform', 'ios', '--profile', 'production',
    '--non-interactive', '--no-wait', '--json', '--freeze-credentials',
    '--message', `Occulert TestFlight source ${input.sourceSha}; GitHub run ${context.runId}`], { timeout: 900000 }));
  assert.ok(Array.isArray(output) && output.length === 1, 'EAS did not return exactly one build.');
  return { privateBuildId: output[0].id, build: buildSummary(output[0], { sourceSha: input.sourceSha, finished: false }) };
}

export async function resolveBuildId({ run, sourceSha, build }) {
  assert.match(build.idSha256 ?? '', DIGEST, 'Build fingerprint is missing.');
  assert.match(build.appBuildVersion ?? '', /^[1-9][0-9]{0,8}$/, 'Recorded build number is invalid.');
  const matches = [], seen = new Set();
  // Read all bounded pages before accepting a unique match; never pick the
  // latest result or return early from an incomplete provider response.
  for (let page = 0; page < 10; page++) {
    const values = JSON.parse(await run(['build:list', '--platform', 'ios', '--status', 'finished',
      '--distribution', 'store', '--build-profile', 'production', '--git-commit-hash', sourceSha,
      '--app-version', RELEASE.appVersion, '--app-build-version', build.appBuildVersion,
      '--app-identifier', RELEASE.bundleIdentifier, '--limit', '50', '--offset', String(page * 50),
      '--json', '--non-interactive']));
    assert.ok(Array.isArray(values) && values.length <= 50, 'Malformed EAS build inventory.');
    for (const value of values) {
      assert.match(value?.id ?? '', UUID, 'Malformed EAS build inventory identity.');
      assert.ok(!seen.has(value.id), 'Repeated build identity makes pagination ambiguous.');
      seen.add(value.id);
      if (hash(value.id) === build.idSha256) {
        assert.deepEqual(buildSummary(value, { sourceSha }), build, 'Resolved build differs from the trusted receipt.');
        matches.push(value.id);
      }
    }
    if (values.length < 50) {
      assert.equal(matches.length, 1, 'The exact build fingerprint did not resolve uniquely.');
      return matches[0];
    }
  }
  throw new Error('EAS build inventory exceeded its pagination bound.');
}

export async function submitBuild({ run, input, prior, recheck, inspect, digest = ipaDigest }) {
  assert.equal(input.mode, 'submit', 'Submission is only available in submit mode.');
  assert.equal(input.archiveReviewed, true, 'Archive inspection is required.');
  assert.equal(prior.build.idSha256, input.buildIdSha256, 'Input build fingerprint differs from the trusted build receipt.');
  assert.equal(prior.artifact.sha256, input.archiveSha256, 'Inspected IPA digest differs from the trusted build receipt.');
  validateArchiveReview(prior.archiveReview, { source: prior, build: prior.build, artifact: prior.artifact });
  assert.equal(typeof inspect, 'function', 'Fresh archive inspection is required before submission.');
  phase = 'verify exact completed build and inspected IPA';
  const privateBuildId = await resolveBuildId({ run, sourceSha: input.sourceSha, build: prior.build });
  const metadata = JSON.parse(await run(['build:view', privateBuildId, '--json']));
  const summary = buildSummary(metadata, { sourceSha: input.sourceSha, buildId: privateBuildId });
  assert.deepEqual(summary, prior.build, 'EAS build identity changed since its successful build receipt.');
  const artifact = await digest(metadata);
  assert.deepEqual(artifact, prior.artifact, 'Current IPA differs from the inspected archive.');
  phase = 'repeat archive signature, profile and identity inspection';
  const archiveReview = validateArchiveReview(await inspect(artifact, summary), { source: prior, build: summary, artifact });
  await recheck();
  phase = 'submit the verified exact build once';
  await run(['submit', '--platform', 'ios', '--profile', 'production', '--id', privateBuildId,
    '--non-interactive', '--no-auto-testflight-setup', '--wait'], { timeout: 90 * 60 * 1000 });
  return { build: summary, artifact, archiveReview };
}

async function refreshProof(client, context, input, source) {
  assert.equal(git(['rev-parse', 'HEAD']), context.workflowSha, 'Control checkout changed.');
  assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all']), '', 'Control checkout changed.');
  return sourceProof({ client, context, input,
    isAncestor: (candidate, main) => {
      try { git(['merge-base', '--is-ancestor', candidate, main], source); return true; } catch { return false; }
    }, readMergeMessage: sha => git(['log', '-1', '--format=%B', sha], source) });
}

export async function runRelease(command) {
  const input = inputsFromEnv(), context = contextFromEnv(), paths = pathsFromEnv();
  const client = process.env.GITHUB_TOKEN ? githubClient(process.env.GITHUB_TOKEN) : undefined;
  if (command === 'source') {
    phase = 'source authorization';
    assert.ok(client, 'GitHub evidence access is required.');
    const proof = await refreshProof(client, context, input, controlRoot);
    git(['worktree', 'add', '--detach', paths.source, input.sourceSha]);
    const state = { ...sourceIdentity(input.sourceSha, paths.source), proof };
    readSourceConfig(paths.source);
    if (input.mode !== 'preflight') state.prior = await getReceipt(client, input, state, paths.root);
    writeJson(paths.state, state);
    console.log(`Verified reviewed main source ${input.sourceSha}; mode ${input.mode}.`);
    return;
  }
  const state = JSON.parse(readFileSync(paths.state, 'utf8'));
  assert.deepEqual(sourceIdentity(input.sourceSha, paths.source), {
    sourceSha: state.sourceSha, sourceTree: state.sourceTree, nativeTree: state.nativeTree,
    sharedBlob: state.sharedBlob, easignoreBlob: state.easignoreBlob,
  }, 'Candidate source changed after authorization.');
  const config = readSourceConfig(paths.source), run = easRunner(paths.source);
  if (command === 'preflight') {
    state.preflight = await easPreflight({ run, source: paths.source, sourceSha: input.sourceSha,
      archiveRoot: resolve(paths.root, 'preflight-archive'), config });
    sourceIdentity(input.sourceSha, paths.source);
    if (input.mode === 'build') {
      assert.deepEqual(state.preflight.sourceArchive, state.prior.sourceArchive, 'Source archive differs from preflight.');
      assert.equal(state.preflight.productionEnvironmentSha256, state.prior.productionEnvironmentSha256, 'Production environment changed since preflight.');
    }
    writeJson(paths.state, state);
    if (input.mode === 'preflight') writeJson(paths.receipt, publicReceipt(state, context, 'preflight'));
    console.log('EAS authentication, project, production configuration, and every admitted archive input verified. No build or version-counter operation was performed.');
    return;
  }
  if (command === 'queue') {
    assert.ok(client, 'Fresh GitHub evidence is required before a release mutation.');
    assert.equal(state.preflight?.productionEnvironmentVerified, true, 'A completed preflight is required.');
    assert.deepEqual(state.preflight.sourceArchive, state.prior.sourceArchive, 'Preflight archive differs.');
    assert.equal(state.preflight.productionEnvironmentSha256, state.prior.productionEnvironmentSha256, 'Preflight environment differs.');
    const queued = await queueBuild({ run, input, context, recheck: async () => {
      state.proof = await refreshProof(client, context, input, paths.source);
      sourceIdentity(input.sourceSha, paths.source);
    } });
    state.queuedBuild = queued.build;
    state.privateBuildId = queued.privateBuildId;
    writeJson(paths.state, state);
    writeJson(paths.queued, publicReceipt(state, context, 'build-queued', { evidenceRunId: input.evidenceRunId, build: state.queuedBuild }));
    console.log(`Queued build fingerprint ${state.queuedBuild.idSha256}; automatic submission is disabled.`);
    return;
  }
  if (command === 'finish') {
    assert.equal(input.mode, 'build');
    const buildId = state.privateBuildId;
    assert.match(buildId ?? '', UUID, 'No recorded queued build is available.');
    const deadline = Date.now() + 120 * 60 * 1000;
    while (Date.now() < deadline) {
      phase = 'wait for the recorded build';
      const build = JSON.parse(await run(['build:view', buildId, '--json']));
      buildSummary(build, { sourceSha: input.sourceSha, buildId, finished: false });
      if (build.status === 'FINISHED') {
        const summary = buildSummary(build, { sourceSha: input.sourceSha, buildId });
        phase = 'download and hash the completed IPA privately';
        const ipaPath = resolve(paths.root, 'private-build.ipa');
        const artifact = await ipaDigest(build, fetch, ipaPath);
        phase = 'inspect the actual phone and Watch archive';
        const archiveReview = await inspectArchive({ sourceRoot: paths.source, temporaryRoot: paths.root,
          source: state, build: summary, artifact, ipaPath, execute: runCaptured, env: publicEnvironment() });
        sourceIdentity(input.sourceSha, paths.source);
        writeJson(paths.receipt, publicReceipt(state, context, 'build', { evidenceRunId: input.evidenceRunId,
          build: summary, artifact, archiveReview }));
        console.log(`Finished build fingerprint ${summary.idSha256}; IPA SHA-256 ${artifact.sha256}. Review its bounded archive report before a separate submit dispatch.`);
        return;
      }
      console.log(`Recorded build fingerprint ${state.queuedBuild.idSha256} is ${build.status}; no new build request is being made.`);
      await delay(30000);
    }
    throw new Error('Build wait expired. Preserve the queued build ID; do not rerun the build job.');
  }
  if (command === 'submit') {
    assert.ok(client, 'Fresh GitHub evidence is required before a release mutation.');
    assert.equal(state.preflight?.productionEnvironmentVerified, true, 'A completed preflight is required.');
    const ipaPath = resolve(paths.root, 'private-build.ipa');
    const completed = await submitBuild({ run, input, prior: state.prior,
      digest: metadata => ipaDigest(metadata, fetch, ipaPath),
      inspect: (artifact, build) => inspectArchive({ sourceRoot: paths.source, temporaryRoot: paths.root,
        source: state, build, artifact, ipaPath, execute: runCaptured, env: publicEnvironment() }),
      recheck: async () => {
      state.proof = await refreshProof(client, context, input, paths.source);
      sourceIdentity(input.sourceSha, paths.source);
    } });
    writeJson(paths.receipt, publicReceipt(state, context, 'submit', { evidenceRunId: input.evidenceRunId, ...completed }));
    console.log(`Submission command completed for build fingerprint ${input.buildIdSha256}. Confirm Apple processing and internal tester availability separately.`);
    return;
  }
  throw new Error('Unknown release command.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runRelease(process.argv[2]); }
  catch {
    // Provider output, environment values, signed artifact URLs and secrets must
    // never enter logs, summaries or uploaded receipts, including failure paths.
    console.error(`TestFlight control stopped during ${phase}. No automatic retry will occur. Raw provider output is withheld; retain any queued-build receipt.`);
    process.exitCode = 1;
  }
}
