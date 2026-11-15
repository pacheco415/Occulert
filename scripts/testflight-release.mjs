import assert from 'node:assert/strict';
import { constants, createHash, createPublicKey, publicEncrypt } from 'node:crypto';
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
  validateRecoverableRun, matchQueuedBuild, matchReceiptInputs,
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
  async function proveCommit(sourceSha) {
  assert.equal(await isAncestor(sourceSha, main.commit.sha), true, 'Source is not an ancestor of protected main.');
  assert.equal(/\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]|(?:^|\n)skip-checks:\s*true\s*(?:\n|$)/i.test(await readMergeMessage(sourceSha)), false, 'Source merge message contains a CI skip token.');
  const checks = [];
  for (const [workflow, names] of Object.entries(REQUIRED_WORKFLOWS)) {
    const runs = await client.pages(`/actions/workflows/${workflow}/runs?head_sha=${sourceSha}&event=push&branch=main`, 'workflow_runs');
    const run = newestRun(runs);
    const proof = validateRun(run, { sourceSha, workflow });
    const jobs = await client.pages(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs');
    validateJobs(jobs, run, names);
    checks.push(proof);
  }
  // pull_request_target checks belong to the PR head, not the resulting merge.
  const pull = mergedPull(await client.pages(`/commits/${sourceSha}/pulls`), sourceSha);
  const policyRuns = await client.pages(`/actions/workflows/ci-policy.yml/runs?head_sha=${pull.head.sha}&event=pull_request_target`, 'workflow_runs');
  const policy = newestRun(policyRuns);
  let mergedPolicyEvidence;
  if (Array.isArray(policy.pull_requests) && policy.pull_requests.length === 0) {
    const currentPull = await client.request(`/pulls/${pull.number}`);
    const commits = await client.pages(`/pulls/${pull.number}/commits`);
    mergedPolicyEvidence = { sourceSha, listedPull: pull, currentPull, commits };
  }
  checks.push(validateRun(policy, { sourceSha: pull.head.sha, workflow: 'ci-policy.yml', event: 'pull_request_target',
    pullNumber: pull.number, mergedPolicyEvidence }));
  validateJobs(await client.pages(`/actions/runs/${policy.id}/attempts/${policy.run_attempt}/jobs`, 'jobs'), policy, ['Reject CI skip tokens']);
  return { sourceSha, mergedPull: pull.number, checks };
  }
  const source = await proveCommit(input.sourceSha);
  const control = context.workflowSha === input.sourceSha ? source : await proveCommit(context.workflowSha);
  const currentMain = await client.request('/branches/main');
  validateContext(context, currentMain, input);
  assert.equal(currentMain.commit.sha, main.commit.sha, 'Main advanced while source checks were read.');
  return { mainSha: main.commit.sha, mergedPull: source.mergedPull, checks: source.checks, control };
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

export async function readEvidenceArtifact({ client, run, mode, source, temporaryRoot, artifacts }) {
  assert.ok(['preflight', 'build-queued', 'build', 'recover'].includes(mode), 'Unknown evidence artifact mode.');
  artifacts ??= await client.pages(`/actions/runs/${run.id}/artifacts`, 'artifacts');
  const queued = mode === 'build-queued';
  const matching = artifacts.filter(artifact => artifact.name === `testflight-${queued ? 'queued' : mode}-${run.id}`);
  assert.equal(matching.length, 1, 'The exact successful evidence artifact is required.');
  const artifact = matching[0];
  assert.equal(artifact.expired, false, 'Evidence artifact has expired.');
  assert.ok(Number.isSafeInteger(artifact.id) && artifact.id > 0
    && Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 128 * 1024, 'Invalid evidence artifact.');
  assert.equal(artifact.workflow_run?.id, run.id, 'Artifact belongs to another run.');
  assert.equal(artifact.workflow_run?.head_sha, run.head_sha, 'Artifact control source differs.');
  assert.equal(artifact.workflow_run?.repository_id, RELEASE.repositoryId, 'Artifact repository differs.');
  assert.equal(artifact.workflow_run?.head_repository_id, RELEASE.repositoryId, 'Artifact head repository differs.');
  const zip = resolve(temporaryRoot, `evidence-${mode}-${run.id}.zip`);
  const bytes = await client.request(`/actions/artifacts/${artifact.id}/zip`, { binary: true });
  assert.ok(Buffer.isBuffer(bytes) && bytes.length === artifact.size_in_bytes, 'Evidence artifact size differs.');
  assert.equal(artifact.digest, `sha256:${hash(bytes)}`, 'Evidence artifact digest differs.');
  writeFileSync(zip, bytes, { mode: 0o600 });
  const members = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8', maxBuffer: 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const member = queued ? 'queued.json' : 'receipt.json';
  assert.equal(members, member, 'Evidence archive contains unexpected files.');
  const raw = execFileSync('unzip', ['-p', zip, member], { encoding: 'utf8', maxBuffer: 32768, stdio: ['ignore', 'pipe', 'pipe'] });
  return validateReceipt(JSON.parse(raw), { mode, run, source });
}

export async function getQueuedOrigin({ client, runId, source, temporaryRoot }) {
  const run = await client.request(`/actions/runs/${runId}`);
  assert.ok(Number.isSafeInteger(run?.id) && String(run.id) === runId, 'Original run identity differs.');
  const jobs = await client.pages(`/actions/runs/${run.id}/attempts/1/jobs`, 'jobs');
  validateRecoverableRun(run, jobs, { sourceSha: source.sourceSha, runId });
  const artifacts = await client.pages(`/actions/runs/${run.id}/artifacts`, 'artifacts');
  assert.ok(!artifacts.some(artifact => ['build', 'recover'].some(mode => artifact.name === `testflight-${mode}-${run.id}`)),
    'A final receipt makes failed-run recovery ambiguous.');
  const queued = await readEvidenceArtifact({ client, run, mode: 'build-queued', source, temporaryRoot, artifacts });
  const preflightRun = await client.request(`/actions/runs/${queued.preflightRunId}`);
  validateRun(preflightRun, { sourceSha: source.sourceSha, workflow: 'testflight-release.yml', event: 'workflow_dispatch',
    runId: queued.preflightRunId, attempt: 1 });
  const preflight = await readEvidenceArtifact({ client, run: preflightRun, mode: 'preflight', source, temporaryRoot });
  matchReceiptInputs(queued, preflight);
  return queued;
}

export async function getReceipt(client, input, state, temporaryRoot, isAncestor) {
  if (input.mode === 'recover') {
    const queued = await getQueuedOrigin({ client, runId: input.evidenceRunId, source: state, temporaryRoot });
    assert.equal(queued.build.idSha256, input.buildIdSha256, 'Recovery fingerprint differs from the original queue.');
    return queued;
  }
  const run = await client.request(`/actions/runs/${input.evidenceRunId}`);
  // A successful recovery workflow may be newer than the original app source.
  // Its head is checked independently and must still belong to protected main.
  assert.match(run.head_sha ?? '', SHA, 'Evidence control identity is malformed.');
  validateRun(run, { sourceSha: run.head_sha, workflow: 'testflight-release.yml', event: 'workflow_dispatch',
    runId: input.evidenceRunId, attempt: 1 });
  assert.equal(await isAncestor(run.head_sha, state.proof.mainSha), true, 'Evidence control is outside protected main history.');
  assert.equal(await isAncestor(input.sourceSha, run.head_sha), true, 'Evidence control does not descend from the original source.');
  const artifacts = await client.pages(`/actions/runs/${run.id}/artifacts`, 'artifacts');
  const modes = input.mode === 'build' ? ['preflight'] : ['build', 'recover'];
  const matchingModes = modes.filter(mode => artifacts.some(artifact => artifact.name === `testflight-${mode}-${run.id}`));
  assert.equal(matchingModes.length, 1, 'Successful evidence mode is missing or ambiguous.');
  const mode = matchingModes[0];
  if (mode !== 'recover') assert.equal(run.head_sha, input.sourceSha, 'Build/preflight control must match its app source.');
  const receipt = await readEvidenceArtifact({ client, run, mode, source: state, temporaryRoot, artifacts });
  if (mode === 'recover') {
    const queued = await getQueuedOrigin({ client, runId: receipt.queuedBuildRunId, source: state, temporaryRoot });
    assert.equal(receipt.preflightRunId, queued.preflightRunId, 'Recovery preflight origin differs.');
    matchReceiptInputs(receipt, queued);
    matchQueuedBuild(receipt.build, queued.build);
  }
  return receipt;
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
    controlChecks: (state.proof.control?.checks ?? state.proof.checks).map(({ workflow, runId, attempt }) => ({ workflow, runId, attempt })),
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
  if (mode === 'build' || mode === 'recover' || mode === 'submit') receipt.archiveReview = validateArchiveReview(detail.archiveReview,
    { source: state, build: receipt.build, artifact: receipt.artifact });
  if (mode === 'build' || mode === 'build-queued') receipt.preflightRunId = detail.evidenceRunId;
  if (mode === 'recover') {
    receipt.queuedBuildRunId = state.prior.runId;
    receipt.preflightRunId = state.prior.preflightRunId;
  }
  if (mode === 'submit') {
    if (state.prior?.mode === 'recover') {
      receipt.recoveryRunId = detail.evidenceRunId;
      receipt.queuedBuildRunId = state.prior.queuedBuildRunId;
      receipt.preflightRunId = state.prior.preflightRunId;
    } else receipt.buildRunId = detail.evidenceRunId;
    receipt.archiveReviewed = true;
    receipt.submissionCommandCompleted = true;
    receipt.appleProcessingAndTesterAvailability = 'not verified by this workflow';
  }
  return receipt;
}

const DOWNLOAD_CODES = new Set(['IPA_URL_MISSING', 'IPA_URL_INVALID', 'IPA_SCHEME', 'IPA_AUTHORITY',
  'IPA_HOST', 'IPA_FETCH', 'IPA_TIMEOUT', 'IPA_REDIRECT', 'IPA_REDIRECT_LIMIT', 'IPA_STATUS',
  'IPA_LENGTH', 'IPA_EMPTY', 'IPA_STREAM', 'IPA_ENCODING_STREAM', 'IPA_TOO_LARGE', 'IPA_SIGNATURE',
  'IPA_LENGTH_MISMATCH', 'IPA_FILE_OPEN', 'IPA_FILE_WRITE', 'IPA_FILE_CLOSE', 'IPA_FILE_CLEANUP']);
const HOST_CLASSES = ['unknown', 'expo', 'eas-cdn', 'google-storage', 'other'];
const ENCODINGS = ['absent', 'identity', 'gzip', 'br', 'deflate', 'other'];

// Temporary, pinned recipient for the rejected-host diagnostic only. The
// matching private key stays with the release owner, outside Git and Actions.
export const HOST_DIAGNOSTIC = Object.freeze({
  algorithm: 'RSA-OAEP-SHA256',
  keySha256: 'bd181dacd81c33d5d99083b65f6f517dca926985d0bbbe48ea48a3325dff327b',
  label: 'occulert-testflight-redirect-host-v1',
  publicKey: `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA6gU+Kh5j8gnI44+xveDi
nz2caY+3GvvPGADurQtsFG8PrC3Lp6zwPmOL4Wu61kLfT+X/5+rEzOmEE0p/hExV
V0yrf1jbwdyNV3Mi+0ZrVNSwUYBZTEY8k7Xr/vSPKDWfyJRbLUI9oay31IbL1cOG
kiUOGDcMHZtPrJW20P3LXk4A01of05lw5kFt3IWTAX+0JR8Lntq+PkrfDq4ZKFHw
38GSXmpWHGnAxLEo0fbuNMMibkqRby0HStYr+1bTb4GbdLIFUpQRx7K4g3RA7bZ+
786oBJ3IkuWvpiNh6FfsJR+eNpqE1bTvklCWcr29BSOzT8Gy+n5fA2d8ifMg677r
fXkE5i3Le1OmPVXmE7ncNiIeZ0OjV1Sr2qAWPfonr4V/2mMVW3pZPY3ZHWm88edp
i0lHqzqUbJZZwyesDbwedZgij/dA3law10NcecbJ3LJp8gYjETmp8Bty19S7t8Hg
ykvYetT9UigoHRzPnu2p+DtdCFd06pf3Oejb83f6TzotAgMBAAE=
-----END PUBLIC KEY-----
`,
});

export function sealRejectedHostname(hostname, { createKey = createPublicKey, encrypt = publicEncrypt } = {}) {
  try {
    // Only the WHATWG URL's canonical hostname is admissible, never a URL,
    // Location header, path, query, credential, or arbitrary provider text.
    if (typeof hostname !== 'string' || !/^[\x21-\x7e]{1,253}$/.test(hostname)
      || new URL(`https://${hostname}`).hostname !== hostname) return undefined;
    const key = createKey(HOST_DIAGNOSTIC.publicKey);
    if (key.type !== 'public' || key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails?.modulusLength !== 3072
      || hash(key.export({ format: 'der', type: 'spki' })) !== HOST_DIAGNOSTIC.keySha256) return undefined;
    const ciphertext = encrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256',
      oaepLabel: Buffer.from(HOST_DIAGNOSTIC.label, 'ascii') }, Buffer.from(hostname, 'ascii'));
    if (!Buffer.isBuffer(ciphertext) || ciphertext.length !== 384) return undefined;
    return { algorithm: HOST_DIAGNOSTIC.algorithm, keySha256: HOST_DIAGNOSTIC.keySha256,
      ciphertext: ciphertext.toString('base64') };
  } catch {
    // A diagnostic must never change the host rejection or expose a crypto error.
    return undefined;
  }
}

function boundedSealedHost(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.algorithm !== HOST_DIAGNOSTIC.algorithm || value.keySha256 !== HOST_DIAGNOSTIC.keySha256
    || typeof value.ciphertext !== 'string' || !/^[A-Za-z0-9+/]{512}$/.test(value.ciphertext)) return undefined;
  return { algorithm: HOST_DIAGNOSTIC.algorithm, keySha256: HOST_DIAGNOSTIC.keySha256, ciphertext: value.ciphertext };
}

export class IpaDownloadError extends Error {
  constructor(code, details = {}) {
    assert.ok(DOWNLOAD_CODES.has(code), 'Unknown bounded download code.');
    super(`IPA download stopped: ${code}.`);
    this.diagnostic = { schema: 1, code };
    for (const key of ['redirects', 'status', 'declaredBytes', 'receivedBytes']) {
      const maximum = key === 'redirects' ? 6 : key === 'status' ? 599 : MAX_IPA + 1;
      if (Number.isSafeInteger(details[key]) && details[key] >= 0 && details[key] <= maximum) this.diagnostic[key] = details[key];
    }
    if (HOST_CLASSES.includes(details.hostClass)) this.diagnostic.hostClass = details.hostClass;
    if (ENCODINGS.includes(details.encoding)) this.diagnostic.encoding = details.encoding;
    const sealedHost = code === 'IPA_HOST' && details.hostClass === 'other' ? boundedSealedHost(details.sealedHost) : undefined;
    if (sealedHost) this.diagnostic.sealedHost = sealedHost;
  }
}

export function downloadDiagnostic(error) {
  return error instanceof IpaDownloadError && DOWNLOAD_CODES.has(error.diagnostic?.code)
    ? new IpaDownloadError(error.diagnostic.code, error.diagnostic).diagnostic : null;
}

export async function ipaDigest(build, fetchImpl = fetch, privatePath, io = { openSync, writeSync, closeSync, rmSync }, sealHost = sealRejectedHostname) {
  const details = { redirects: 0, hostClass: 'unknown', receivedBytes: 0 };
  const fail = code => new IpaDownloadError(code, details);
  const rawUrl = build.artifacts?.applicationArchiveUrl;
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) throw fail('IPA_URL_MISSING');
  let url;
  try { url = new URL(rawUrl); } catch { throw fail('IPA_URL_INVALID'); }
  for (let redirect = 0; redirect <= 5; redirect++) {
    details.redirects = redirect;
    details.hostClass = url.hostname === 'expo.dev' ? 'expo' : url.hostname === 'artifacts.eascdn.net' ? 'eas-cdn'
      : url.hostname === 'storage.googleapis.com' || url.hostname.endsWith('.storage.googleapis.com') ? 'google-storage' : 'other';
    if (url.protocol !== 'https:') throw fail('IPA_SCHEME');
    if (url.username || url.password || url.port) throw fail('IPA_AUTHORITY');
    if (details.hostClass === 'other') {
      try { details.sealedHost = sealHost(url.hostname); } catch { /* Preserve IPA_HOST without plaintext fallback. */ }
      throw fail('IPA_HOST');
    }
    // Artifact storage never receives EXPO_TOKEN or GITHUB_TOKEN.
    let response;
    try { response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(300000) }); }
    catch (error) { throw fail(['TimeoutError', 'AbortError'].includes(error?.name) ? 'IPA_TIMEOUT' : 'IPA_FETCH'); }
    details.status = response.status;
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw fail('IPA_REDIRECT');
      try { url = new URL(location, url); } catch { throw fail('IPA_REDIRECT'); }
      continue;
    }
    if (response.status !== 200) throw fail('IPA_STATUS');
    const encoding = response.headers.get('content-encoding');
    details.encoding = encoding === null ? 'absent' : ENCODINGS.includes(encoding.toLowerCase()) ? encoding.toLowerCase() : 'other';
    const length = response.headers.get('content-length');
    if (length !== null) {
      if (!/^[0-9]+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) <= 0) throw fail('IPA_LENGTH');
      details.declaredBytes = Math.min(Number(length), MAX_IPA + 1);
      if (Number(length) > MAX_IPA) throw fail('IPA_TOO_LARGE');
    }
    if (!response.body) throw fail('IPA_EMPTY');
    const digest = createHash('sha256');
    let bytes = 0, signature = Buffer.alloc(0), descriptor;
    try {
      if (privatePath) {
        try { descriptor = io.openSync(privatePath, 'wx', 0o600); } catch { throw fail('IPA_FILE_OPEN'); }
      }
      for await (const chunk of response.body) {
        bytes += chunk.length;
        details.receivedBytes = Math.min(bytes, MAX_IPA + 1);
        if (bytes > MAX_IPA) throw fail('IPA_TOO_LARGE');
        if (signature.length < 4) signature = Buffer.concat([signature, chunk]).subarray(0, 4);
        digest.update(chunk);
        if (descriptor !== undefined) {
          let offset = 0;
          while (offset < chunk.length) {
            let written;
            try { written = io.writeSync(descriptor, chunk, offset, chunk.length - offset); }
            catch { throw fail('IPA_FILE_WRITE'); }
            if (!Number.isSafeInteger(written) || written <= 0 || written > chunk.length - offset) throw fail('IPA_FILE_WRITE');
            offset += written;
          }
        }
      }
      if (!(bytes > 0 && signature.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))) throw fail('IPA_SIGNATURE');
      if (length !== null && bytes !== Number(length)) throw fail('IPA_LENGTH_MISMATCH');
      return { bytes, sha256: digest.digest('hex') };
    } catch (error) {
      if (descriptor !== undefined) {
        try { io.rmSync(privatePath, { force: true }); } catch { throw fail('IPA_FILE_CLEANUP'); }
      }
      throw error instanceof IpaDownloadError ? error : fail(details.encoding === 'absent' || details.encoding === 'identity' ? 'IPA_STREAM' : 'IPA_ENCODING_STREAM');
    } finally {
      if (descriptor !== undefined) {
        try { io.closeSync(descriptor); } catch { throw fail('IPA_FILE_CLOSE'); }
      }
    }
  }
  throw fail('IPA_REDIRECT_LIMIT');
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

export async function resolveBuildId({ run, sourceSha, build, queued = false }) {
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
        const completed = buildSummary(value, { sourceSha });
        if (queued) matchQueuedBuild(completed, build);
        else assert.deepEqual(completed, build, 'Resolved build differs from the trusted receipt.');
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

export function matchFreshPreflight(preflight, prior) {
  assert.equal(preflight?.productionEnvironmentVerified, true, 'A completed preflight is required.');
  assert.deepEqual(preflight.sourceArchive, prior.sourceArchive, 'Fresh source archive differs from trusted evidence.');
  assert.equal(preflight.productionEnvironmentSha256, prior.productionEnvironmentSha256, 'Fresh production environment differs from trusted evidence.');
}

export async function recoverBuild({ run, input, prior, preflight, recheck, inspect, digest = ipaDigest }) {
  assert.equal(input.mode, 'recover', 'Recovery is a separate read-only operation.');
  assert.equal(prior.mode, 'build-queued', 'Recovery requires original queued evidence.');
  assert.equal(prior.runId, input.evidenceRunId, 'Recovery run differs from original queued evidence.');
  assert.equal(prior.build.idSha256, input.buildIdSha256, 'Recovery fingerprint differs.');
  assert.equal(typeof inspect, 'function', 'Actual archive inspection is required.');
  matchFreshPreflight(preflight, prior);
  await recheck();
  phase = 'resolve the exact completed queued build';
  const privateBuildId = await resolveBuildId({ run, sourceSha: input.sourceSha, build: prior.build, queued: true });
  const metadata = JSON.parse(await run(['build:view', privateBuildId, '--json']));
  const summary = buildSummary(metadata, { sourceSha: input.sourceSha, buildId: privateBuildId });
  matchQueuedBuild(summary, prior.build);
  phase = 'download and hash the recovered IPA privately';
  const artifact = await digest(metadata);
  phase = 'inspect the actual recovered phone and Watch archive';
  const archiveReview = validateArchiveReview(await inspect(artifact, summary), { source: prior, build: summary, artifact });
  // No receipt exists until both the inspector and fresh source/control proof pass.
  await recheck();
  return { build: summary, artifact, archiveReview };
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
    if (input.mode !== 'preflight') state.prior = await getReceipt(client, input, state, paths.root,
      (candidate, main) => { try { git(['merge-base', '--is-ancestor', candidate, main]); return true; } catch { return false; } });
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
    if (input.mode === 'build' || input.mode === 'recover' || input.mode === 'submit') {
      matchFreshPreflight(state.preflight, state.prior);
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
  if (command === 'recover') {
    assert.ok(client, 'Fresh source and control evidence is required for recovery.');
    assert.equal(state.preflight?.productionEnvironmentVerified, true, 'A completed preflight is required.');
    assert.deepEqual(state.preflight.sourceArchive, state.prior.sourceArchive, 'Recovery archive differs.');
    assert.equal(state.preflight.productionEnvironmentSha256, state.prior.productionEnvironmentSha256, 'Recovery environment differs.');
    const ipaPath = resolve(paths.root, 'private-build.ipa');
    const completed = await recoverBuild({ run, input, prior: state.prior, preflight: state.preflight,
      digest: metadata => ipaDigest(metadata, fetch, ipaPath),
      inspect: (artifact, build) => inspectArchive({ sourceRoot: paths.source, temporaryRoot: paths.root,
        source: state, build, artifact, ipaPath, execute: runCaptured, env: publicEnvironment() }),
      recheck: async () => {
        state.proof = await refreshProof(client, context, input, paths.source);
        sourceIdentity(input.sourceSha, paths.source);
      } });
    writeJson(paths.receipt, publicReceipt(state, context, 'recover', completed));
    console.log(`Recovered build fingerprint ${completed.build.idSha256}; IPA SHA-256 ${completed.artifact.sha256}. No build, version-counter or submission operation was performed.`);
    return;
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
  catch (error) {
    // Provider output, environment values, signed artifact URLs and secrets must
    // never enter logs, summaries or uploaded receipts, including failure paths.
    console.error(`TestFlight control stopped during ${phase}. No automatic retry will occur. Raw provider output is withheld; retain any queued-build receipt.`);
    const diagnostic = downloadDiagnostic(error);
    if (diagnostic) {
      console.error(`Bounded download diagnostic: ${JSON.stringify(diagnostic)}`);
      try { writeJson(resolve(pathsFromEnv().root, 'download-diagnostic.json'), diagnostic); } catch { /* Do not print filesystem paths or secondary failures. */ }
    }
    process.exitCode = 1;
  }
}
