import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, symlinkSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  RELEASE, REQUIRED_WORKFLOWS, OFF_FLAGS, ABSENT_FLAGS,
  parseInputs, validateContext, validateSourceConfig, validateResolvedConfig,
  validateEnvironmentList, validateProjectInfo, buildSummary, validateReceipt, validateArchiveReview,
} from './lib/testflight-policy.mjs';
import { archiveContract } from './lib/testflight-archive.mjs';
import {
  sourceProof, sourceIdentity, verifySourceArchive, easPreflight, queueBuild,
  submitBuild, ipaDigest, githubClient, boundedBody, runCaptured,
  publicEnvironment, pathsFromEnv, publicReceipt, resolveBuildId,
} from './testflight-release.mjs';
import { auditWorkflowPolicy } from './lib/workflow-policy.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const sha = 'a'.repeat(40), other = 'b'.repeat(40), prHead = 'c'.repeat(40), digest = 'd'.repeat(64);
const buildId = '11111111-2222-3333-4444-555555555555';
const buildFingerprint = createHash('sha256').update(buildId).digest('hex');
const repository = { id: RELEASE.repositoryId, full_name: RELEASE.repository };
const context = { repository: RELEASE.repository, eventName: 'workflow_dispatch', ref: 'refs/heads/main',
  runAttempt: '1', runId: '1234', workflowRef: `${RELEASE.repository}/${RELEASE.workflow}@refs/heads/main`,
  workflowSha: sha, sha };
const main = { name: 'main', protected: true, commit: { sha } };
const input = mode => parseInputs({ mode, sourceSha: sha,
  evidenceRunId: mode === 'preflight' ? '' : '123',
  buildIdSha256: mode === 'submit' ? buildFingerprint : '', archiveSha256: mode === 'submit' ? digest : '',
  archiveReviewed: mode === 'submit' ? 'true' : 'false' });
const source = { sourceSha: sha, sourceTree: other, nativeTree: other, sharedBlob: other, easignoreBlob: other };
const config = {
  app: JSON.parse(readFileSync(resolve(root, 'native-app/app.json'), 'utf8')).expo,
  eas: JSON.parse(readFileSync(resolve(root, 'native-app/eas.json'), 'utf8')),
};
const resolvedConfig = () => ({ appConfig: structuredClone(config.app),
  buildProfile: { distribution: 'store', autoIncrement: true, image: 'sdk-58', credentialsSource: 'remote' } });
const metadata = () => ({ id: buildId, app: { id: RELEASE.projectId, slug: 'occulert' },
  appIdentifier: RELEASE.bundleIdentifier, platform: 'IOS', distribution: 'STORE', buildProfile: 'production',
  isForIosSimulator: false, gitCommitHash: sha, appVersion: '1.0.0', appBuildVersion: '61',
  status: 'FINISHED', error: null, createdAt: '2026-11-14T21:00:00.000Z', completedAt: '2026-11-14T21:15:00.000Z',
  artifacts: { applicationArchiveUrl: 'https://expo.dev/artifacts/eas/example.ipa' } });
const archiveReview = () => {
  const checks = Object.fromEntries(['bundleMatchesSource', 'versionMatchesSource', 'buildMatchesRemote',
    'devicePlatformMatches', 'signatureIntegrityVerified', 'storeProfileShapeMatched',
    'profileCurrentAtInspection', 'signerCertificateAllowedByProfile', 'entitlementsAllowedByProfile',
    'sourceEntitlementsMatched', 'debuggingDisabled', 'locationAndMicrophoneAbsent',
    'healthBackgroundDisabled', 'multitaskingCameraDisabled'].map(key => [key, true]));
  const health = config.app.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === '@kingstinct/react-native-healthkit')[1];
  return { schema: 1, reviewable: true, sourceSha: sha, nativeTree: other, buildIdSha256: buildFingerprint,
    artifactSha256: digest, appVersion: '1.0.0', appBuildVersion: '61',
    inspectedAt: '2026-11-14T21:25:00Z', archiveEntries: 500,
    phone: { ...checks, permissionPrompts: {
      NSCameraUsageDescription: config.app.ios.infoPlist.NSCameraUsageDescription,
      NSMotionUsageDescription: config.app.ios.infoPlist.NSMotionUsageDescription,
      NSHealthShareUsageDescription: health.NSHealthShareUsageDescription,
      NSHealthUpdateUsageDescription: health.NSHealthUpdateUsageDescription } },
    watch: { ...checks, permissionPrompts: {} }, watchCompanionMatches: true,
    privacy: { manifests: 10, phoneManifests: 9, watchManifests: 1, collectedDataEntries: 0,
      linkedDataEntries: 0, requiredReasonEntries: 4, phoneRootManifestPresent: true,
      watchRootManifestPresent: true, watchTimerReasonDeclared: true, schemasChecked: true, trackingDeclared: false,
      manifestSetSha256: digest, requiredReasons: { NSPrivacyAccessedAPICategoryUserDefaults: ['CA92.1'],
        NSPrivacyAccessedAPICategorySystemBootTime: ['35F9.1'] } },
    productionEnvironmentVerified: true, simulatorPlistDisabled: true,
    javascriptCompileFlagsVerifiedFromBinary: false, appleProcessingAndDeviceAcceptanceVerified: false,
    appleCertificateTrustIndependentlyVerified: false, resolvedNativeDependencyLockAvailableInIpa: false };
};
const receipt = mode => ({ schema: 1, mode, repository: RELEASE.repository, runId: '123', runAttempt: 1,
  workflowSha: sha, ...source, easVersion: RELEASE.easVersion,
  productionEnvironmentVerified: true, productionEnvironmentSha256: digest,
  sourceArchive: { files: 200, sha256: digest }, createdAt: '2026-11-14T21:20:00.000Z',
  ...(mode === 'build' ? { build: buildSummary(metadata(), { sourceSha: sha }), artifact: { sha256: digest, bytes: 99 }, archiveReview: archiveReview() } : {}) });

function evidence() {
  let id = 10;
  const runs = new Map(), jobs = new Map();
  for (const [file, names] of [...Object.entries(REQUIRED_WORKFLOWS), ['ci-policy.yml', ['Reject CI skip tokens']]]) {
    const policy = file === 'ci-policy.yml';
    const run = { id: id++, repository, path: `.github/workflows/${file}`, event: policy ? 'pull_request_target' : 'push',
      head_sha: policy ? prHead : sha, head_branch: policy ? 'codex/source' : 'main',
      status: 'completed', conclusion: 'success', run_attempt: 1, created_at: '2026-11-14T20:00:00Z',
      pull_requests: policy ? [{ number: 99, head: { sha: prHead }, base: { ref: 'main', repo: { id: RELEASE.repositoryId } } }] : [] };
    runs.set(file, [run]);
    jobs.set(run.id, names.map(name => ({ name, run_id: run.id, head_sha: run.head_sha, status: 'completed', conclusion: 'success' })));
  }
  const pull = { number: 99, title: 'Reviewed source change', merged_at: '2026-11-14T20:30:00Z', merge_commit_sha: sha,
    head: { sha: prHead }, base: { ref: 'main', repo: { id: RELEASE.repositoryId } } };
  const currentPull = { ...structuredClone(pull), merged: true, state: 'closed', commits: 2 };
  const commits = [{ sha: other, commit: { message: 'First reviewed change' } },
    { sha: prHead, commit: { message: 'Final reviewed change' } }];
  const calls = [];
  return { runs, jobs, pull, currentPull, commits, calls, client: {
    async request(path) {
      calls.push(path);
      if (path === '/pulls/99') return currentPull;
      assert.equal(path, '/branches/main'); return main;
    },
    async pages(path) {
      calls.push(path);
      if (path.startsWith('/actions/workflows/')) {
        const file = path.split('/')[3], expectedHead = file === 'ci-policy.yml' ? prHead : sha;
        assert.ok(path.includes(`head_sha=${expectedHead}`));
        return runs.get(file);
      }
      if (path.startsWith('/actions/runs/')) return jobs.get(Number(path.split('/')[3]));
      if (path === '/pulls/99/commits') return commits;
      assert.equal(path, `/commits/${sha}/pulls`);
      return [pull];
    },
  } };
}
const prove = fixture => sourceProof({ client: fixture.client, context, input: input('preflight'),
  isAncestor: async () => true, readMergeMessage: async () => 'Merge reviewed source' });

test('manual inputs enforce exact identities and distinct operations', () => {
  for (const mode of ['preflight', 'build', 'submit']) assert.equal(input(mode).mode, mode);
  for (const fields of [
    { mode: 'other' }, { sourceSha: 'main' }, { sourceSha: sha.toUpperCase() },
    { sourceSha: `${sha}; touch /tmp/unwanted` }, { evidenceRunId: '123' },
    { buildId }, { buildIdSha256: buildFingerprint }, { archiveReviewed: 'true' }, { archiveSha256: digest },
  ]) assert.throws(() => parseInputs({ ...input('preflight'), archiveReviewed: 'false', ...fields }));
  assert.throws(() => parseInputs({ ...input('submit'), archiveReviewed: 'false' }));
  assert.throws(() => parseInputs({ ...input('submit'), archiveReviewed: 'true', buildIdSha256: buildId }));
});

test('workflow context rejects branch dispatches, reruns, unprotected or advanced main', () => {
  validateContext(context, main, input('preflight'));
  for (const patch of [{ repository: 'someone/fork' }, { eventName: 'push' }, { ref: 'refs/heads/release/testflight' },
    { runAttempt: '2' }, { workflowSha: other }, { workflowRef: context.workflowRef.replace('@refs/heads/main', '@refs/tags/release') }]) {
    assert.throws(() => validateContext({ ...context, ...patch }, main, input('build')));
  }
  assert.throws(() => validateContext(context, { ...main, protected: false }, input('build')));
  assert.throws(() => validateContext(context, { ...main, commit: { sha: other } }, input('build')));
  assert.throws(() => validateContext(context, main, { ...input('build'), sourceSha: other }));
  validateContext(context, main, { ...input('submit'), sourceSha: other });
});

test('complete source proof uses main push checks and the exact merged PR head policy', async () => {
  const fixture = evidence();
  const proof = await prove(fixture);
  assert.equal(proof.mergedPull, 99);
  assert.equal(proof.checks.length, 6);
  assert.equal(fixture.calls.filter(path => path === '/branches/main').length, 2);
  assert.equal(fixture.calls.at(-1), '/branches/main');
});

test('a merged policy run with no PR association revalidates the exact PR title and complete commit inventory', async () => {
  const fixture = evidence();
  fixture.runs.get('ci-policy.yml')[0].pull_requests = [];
  const proof = await prove(fixture);
  assert.equal(proof.mergedPull, 99);
  assert.equal(proof.checks.length, 6);
  assert.ok(fixture.calls.includes('/pulls/99') && fixture.calls.includes('/pulls/99/commits'));
  assert.equal(fixture.calls.at(-1), '/branches/main');
});

test('exact-PR fallback reads real paginated GitHub responses and rejects a skip token on the final page', async () => {
  const fixture = evidence(), requestedPages = [];
  fixture.runs.get('ci-policy.yml')[0].pull_requests = [];
  const commits = Array.from({ length: 100 }, (_, index) => ({
    sha: (index + 1).toString(16).padStart(40, '0'), commit: { message: `Reviewed commit ${index}` },
  }));
  commits.push({ sha: prHead, commit: { message: 'Final reviewed head' } });
  fixture.currentPull.commits = commits.length;
  const api = githubClient('fixture-token', async url => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, `/repos/${RELEASE.repository}/pulls/99/commits`);
    assert.equal(parsed.searchParams.get('per_page'), '100');
    const page = Number(parsed.searchParams.get('page'));
    requestedPages.push(page);
    return new Response(JSON.stringify(commits.slice((page - 1) * 100, page * 100)),
      { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const pages = fixture.client.pages;
  fixture.client.pages = (path, field) => path === '/pulls/99/commits' ? api.pages(path) : pages(path, field);
  await prove(fixture);
  assert.deepEqual(requestedPages, [1, 2]);
  commits.at(-1).commit.message = 'Final change\n\nskip-checks: true\n';
  let mutations = 0;
  await assert.rejects(() => queueBuild({ input: input('build'), context, recheck: () => prove(fixture),
    run: async () => { mutations++; } }), /skip token/);
  assert.equal(mutations, 0);
  assert.deepEqual(requestedPages, [1, 2, 1, 2]);
});

test('empty policy association never weakens exact PR, complete commits, workflow or job checks', async t => {
  const mutations = [
    ['different PR', f => { f.currentPull.number = 98; }],
    ['different head', f => { f.currentPull.head.sha = other; }],
    ['different merge', f => { f.currentPull.merge_commit_sha = other; }],
    ['different base', f => { f.currentPull.base.ref = 'release/testflight'; }],
    ['different repository', f => { f.currentPull.base.repo.id = 7; }],
    ['not merged', f => { f.currentPull.merged = false; }],
    ['not closed', f => { f.currentPull.state = 'open'; }],
    ['malformed merge time', f => { f.currentPull.merged_at = 'unknown'; }],
    ['changed title requests skip', f => { f.currentPull.title = 'Change [skip ci]'; }],
    ['missing count', f => { delete f.currentPull.commits; }],
    ['empty count', f => { f.currentPull.commits = 0; }],
    ['unverifiable count', f => { f.currentPull.commits = 251; }],
    ['truncated inventory', f => { f.currentPull.commits = 3; }],
    ['duplicate commit', f => { f.commits[0].sha = prHead; }],
    ['missing exact head', f => { f.commits[1].sha = 'd'.repeat(40); }],
    ['malformed commit', f => { f.commits[0].sha = 'main'; }],
    ['missing message', f => { delete f.commits[0].commit.message; }],
    ['commit requests skip', f => { f.commits[0].commit.message = 'Change [actions skip]'; }],
    ['wrong policy head', f => { f.runs.get('ci-policy.yml')[0].head_sha = other; }],
    ['wrong policy event', f => { f.runs.get('ci-policy.yml')[0].event = 'push'; }],
    ['wrong policy workflow', f => { f.runs.get('ci-policy.yml')[0].path = '.github/workflows/other.yml'; }],
    ['wrong policy repository', f => { f.runs.get('ci-policy.yml')[0].repository = { ...repository, id: 7 }; }],
    ['incomplete policy run', f => { f.runs.get('ci-policy.yml')[0].status = 'in_progress'; }],
    ['failed policy run', f => { f.runs.get('ci-policy.yml')[0].conclusion = 'failure'; }],
    ['skipped policy job', f => { f.jobs.get(f.runs.get('ci-policy.yml')[0].id)[0].conclusion = 'skipped'; }],
  ];
  for (const [name, mutate] of mutations) await t.test(name, async () => {
    const fixture = evidence();
    fixture.runs.get('ci-policy.yml')[0].pull_requests = [];
    mutate(fixture);
    let writes = 0;
    await assert.rejects(() => queueBuild({ input: input('build'), context, recheck: () => prove(fixture),
      run: async () => { writes++; } }));
    assert.equal(writes, 0);
  });
});

test('a nonempty contradictory or malformed policy association cannot invoke the empty-association fallback', async () => {
  for (const association of [[{ number: 98, head: { sha: prHead }, base: { ref: 'main', repo: repository } }], null, undefined]) {
    const fixture = evidence();
    fixture.runs.get('ci-policy.yml')[0].pull_requests = association;
    await assert.rejects(() => prove(fixture));
    assert.equal(fixture.calls.includes('/pulls/99'), false);
  }
});

test('main is rechecked after exact merged-PR fallback and before any build mutation', async () => {
  const fixture = evidence();
  fixture.runs.get('ci-policy.yml')[0].pull_requests = [];
  let reads = 0, writes = 0;
  const request = fixture.client.request;
  fixture.client.request = async path => path === '/branches/main' && ++reads === 2
    ? { ...main, commit: { sha: other } } : request(path);
  await assert.rejects(() => queueBuild({ input: input('build'), context, recheck: () => prove(fixture),
    run: async () => { writes++; } }));
  assert.equal(reads, 2);
  assert.equal(writes, 0);
  assert.ok(fixture.calls.includes('/pulls/99/commits'));
});

test('a newer pending, failed, skipped or wrong-source run cannot reuse an older success', async t => {
  for (const change of [{ status: 'in_progress', conclusion: null }, { conclusion: 'failure' },
    { conclusion: 'skipped' }, { event: 'pull_request' }, { head_sha: other },
    { path: '.github/workflows/another.yml' }, { repository: { ...repository, id: 7 } }]) {
    await t.test(JSON.stringify(change), async () => {
      const fixture = evidence(), old = fixture.runs.get('site-audit.yml')[0];
      fixture.runs.set('site-audit.yml', [old, { ...old, id: 90, created_at: '2026-11-14T21:00:00Z', ...change }]);
      await assert.rejects(() => prove(fixture));
    });
  }
});

test('missing/failed jobs and unrelated or ambiguous PR policy evidence fail closed', async t => {
  const mutations = [
    f => f.jobs.get(10).splice(0),
    f => { f.jobs.get(10)[0].conclusion = 'skipped'; },
    f => { f.jobs.get(10)[0].head_sha = other; },
    f => { f.pull.merge_commit_sha = other; },
    f => { f.pull.title = 'Change [skip ci]'; },
    f => { f.runs.get('ci-policy.yml')[0].head_sha = sha; },
    f => { f.runs.get('ci-policy.yml')[0].pull_requests[0].number = 98; },
    f => { f.runs.get('ci-policy.yml')[0].conclusion = 'failure'; },
  ];
  for (let index = 0; index < mutations.length; index++) await t.test(`boundary ${index}`, async () => {
    const fixture = evidence(); mutations[index](fixture); await assert.rejects(() => prove(fixture));
  });
  const duplicate = evidence(), pages = duplicate.client.pages;
  duplicate.client.pages = async path => path.startsWith('/commits/') ? [duplicate.pull, { ...duplicate.pull, number: 100 }] : pages(path);
  await assert.rejects(() => prove(duplicate));
});

test('main advancing during evidence lookup stops before a build mutation', async () => {
  const fixture = evidence(); let reads = 0, mutations = 0;
  fixture.client.request = async () => ++reads === 1 ? main : { ...main, commit: { sha: other } };
  await assert.rejects(() => queueBuild({ run: async () => { mutations++; }, input: input('build'), context, recheck: () => prove(fixture) }));
  assert.equal(mutations, 0);
});

test('source proof rejects unmerged ancestry even for an otherwise valid submit source', async () => {
  const fixture = evidence();
  await assert.rejects(() => sourceProof({ client: fixture.client, context, input: input('submit'),
    isAncestor: () => false, readMergeMessage: () => 'Merge' }));
});

function environmentBlock({ name = OFF_FLAGS[0], value = '0', visibility = 'PUBLIC', type = 'string' } = {}) {
  const fields = { ID: buildId, Name: name, Value: value, Scope: 'PROJECT', Visibility: visibility,
    Environments: 'production', type, 'Created at': 'Nov 14 20:00:00', 'Updated at': 'Nov 14 20:00:00' };
  return 'Environment: production\nVariables for this project:\n' + Object.entries(fields).map(([key, val]) => `${key.padEnd(12)}  ${val}`).join('\n');
}

test('production env parser accepts actual pinned CLI shapes but never hidden or enabled flags', () => {
  assert.equal(validateEnvironmentList('Environment: production\nNo variables found for this environment.', 'account').variables, 0);
  assert.equal(validateEnvironmentList(environmentBlock(), 'project').variables, 1);
  for (const name of OFF_FLAGS) {
    assert.equal(validateEnvironmentList(environmentBlock({ name }), 'project').variables, 1);
    for (const value of ['1', '', 'false', '0\nName          OTHER']) assert.throws(() => validateEnvironmentList(environmentBlock({ name, value }), 'project'));
    for (const visibility of ['SECRET', 'SENSITIVE']) assert.throws(() => validateEnvironmentList(environmentBlock({ name, visibility }), 'project'));
  }
  for (const name of ABSENT_FLAGS) assert.throws(() => validateEnvironmentList(environmentBlock({ name }), 'project'));
  assert.throws(() => validateEnvironmentList(environmentBlock({ type: 'file' }), 'project'));
  assert.throws(() => validateEnvironmentList(environmentBlock().replace('production', 'preview'), 'project'));
  assert.throws(() => validateEnvironmentList('partial provider output', 'project'));
  assert.throws(() => validateEnvironmentList(environmentBlock() + '\n\n———\n\n' + environmentBlock().split('\n').slice(2).join('\n'), 'project'));
  // Values unrelated to release flags are not echoed into the returned proof.
  assert.equal(JSON.stringify(validateEnvironmentList(environmentBlock({ name: 'EXPO_PUBLIC_API_URL', value: 'private-test-value' }), 'project')).includes('private-test-value'), false);
});

test('source/resolved production identity and flag changes fail before EAS mutation', () => {
  validateSourceConfig(config.app, config.eas);
  validateResolvedConfig(resolvedConfig(), config.app, config.eas);
  const changes = [
    c => { c.app.ios.bundleIdentifier = 'com.other'; }, c => { c.app.ios.appleTeamId = 'OTHER'; },
    c => { c.app.extra.eas.projectId = buildId; }, c => { c.app.ios.buildNumber = '61'; },
    c => { c.eas.cli.appVersionSource = 'local'; }, c => { c.eas.build.production.autoIncrement = false; },
    c => { c.eas.build.production.ios.simulator = true; }, c => { c.eas.build.production.distribution = 'internal'; },
    c => { c.eas.build.production.environment = 'preview'; }, c => { c.eas.build.production.extends = 'preview'; },
    c => { c.eas.build.production.env = { EXPO_PUBLIC_EVENT_OUTBOX: '1' }; },
    c => { c.eas.submit.production.ios.ascAppId = '111'; },
  ];
  for (const change of changes) { const copy = structuredClone(config); change(copy); assert.throws(() => validateSourceConfig(copy.app, copy.eas)); }
  const changed = resolvedConfig(); changed.buildProfile.simulator = true;
  assert.throws(() => validateResolvedConfig(changed, config.app, config.eas));
});

test('pinned EAS preflight calls only read/inspect commands and validates every response', async () => {
  const calls = [];
  const run = async args => {
    calls.push(args);
    if (args[0] === '--version') return `eas-cli/${RELEASE.easVersion} linux-x64 node-v24.0.0`;
    if (args[0] === 'whoami') return 'release-actor';
    if (args[0] === 'project:info') return `fullName  @owner/occulert\nID        ${RELEASE.projectId}\n`;
    if (args[0] === 'env:list') return 'Environment: production\nNo variables found for this environment.\n';
    if (args[0] === 'config') return JSON.stringify(resolvedConfig());
    assert.equal(args[0], 'build:inspect');
    return '';
  };
  const result = await easPreflight({ run, source: '/source', sourceSha: sha, archiveRoot: '/archive', config,
    archiveCheck: args => { assert.equal(args.sourceSha, sha); return { files: 200, sha256: digest }; } });
  assert.equal(result.productionEnvironmentVerified, true);
  assert.deepEqual(calls.map(args => args[0]), ['--version', 'whoami', 'project:info', 'env:list', 'env:list', 'config', 'build:inspect']);
  assert.ok(calls.at(-1).includes('archive'));
  assert.ok(!calls.some(args => args[0] === 'build' || args[0] === 'submit' || args[0].startsWith('build:version')));
  let later = false;
  await assert.rejects(() => easPreflight({ run: async args => {
    if (args[0] === 'project:info') return `fullName  @owner/occulert\nID        ${buildId}\n`;
    if (args[0] === 'config') later = true;
    return run(args);
  }, source: '/source', sourceSha: sha, archiveRoot: '/archive', config }));
  assert.equal(later, false);
  assert.throws(() => validateProjectInfo(`fullName  @owner/other\nID        ${RELEASE.projectId}`));
});

test('build command queues once, only after recheck, without autosubmit or credential mutation', async () => {
  const order = [], calls = [];
  const result = await queueBuild({ input: input('build'), context, recheck: async () => order.push('recheck'),
    run: async args => { order.push('queue'); calls.push(args); return JSON.stringify([{ ...metadata(), status: 'IN_QUEUE' }]); } });
  assert.deepEqual(order, ['recheck', 'queue']);
  assert.equal(result.privateBuildId, buildId);
  assert.equal(result.build.idSha256, buildFingerprint);
  assert.equal(JSON.stringify(result.build).includes(buildId), false);
  assert.ok(calls[0].includes('--freeze-credentials') && calls[0].includes('--no-wait'));
  assert.ok(!calls[0].some(arg => arg.startsWith('--auto-submit')));
  let attempted = 0;
  await assert.rejects(() => queueBuild({ input: input('build'), context, recheck: async () => {},
    run: async () => { attempted++; throw new Error('ambiguous provider failure'); } }));
  assert.equal(attempted, 1, 'Ambiguous mutation must not be retried.');
});

test('submit checks exact UUID, source, app/platform/status and digest before one explicit-ID upload', async () => {
  const prior = receipt('build'), order = [], commands = [];
  const result = await submitBuild({ input: input('submit'), prior,
    run: async args => { commands.push(args); order.push(args[0]);
      return args[0] === 'build:list' ? JSON.stringify([metadata()]) : args[0] === 'build:view' ? JSON.stringify(metadata()) : ''; },
    digest: async () => { order.push('digest'); return prior.artifact; },
    inspect: async () => { order.push('inspect'); return archiveReview(); }, recheck: async () => order.push('recheck') });
  assert.deepEqual(order, ['build:list', 'build:view', 'digest', 'inspect', 'recheck', 'submit']);
  assert.equal(result.build.idSha256, buildFingerprint);
  assert.deepEqual(commands[2], ['submit', '--platform', 'ios', '--profile', 'production', '--id', buildId,
    '--non-interactive', '--no-auto-testflight-setup', '--wait']);
});

test('wrong or stale EAS build metadata never reaches submit', async t => {
  const changes = [b => { b.id = RELEASE.projectId; }, b => { b.app.id = buildId; }, b => { b.appIdentifier = 'com.other'; },
    b => { b.platform = 'ANDROID'; }, b => { b.status = 'IN_PROGRESS'; }, b => { b.distribution = 'INTERNAL'; },
    b => { b.buildProfile = 'preview'; }, b => { b.isForIosSimulator = true; }, b => { delete b.isForIosSimulator; },
    b => { b.gitCommitHash = other; }, b => { b.appVersion = '2.0.0'; }, b => { b.appBuildVersion = '62'; },
    b => { b.error = { message: 'failed' }; }];
  for (let index = 0; index < changes.length; index++) await t.test(`metadata boundary ${index}`, async () => {
    const data = metadata(), calls = []; changes[index](data);
    await assert.rejects(() => submitBuild({ input: input('submit'), prior: receipt('build'),
      run: async args => { calls.push(args[0]); return JSON.stringify(args[0] === 'build:list' ? [metadata()] : data); },
      digest: async () => receipt('build').artifact, inspect: async () => archiveReview(), recheck: async () => {} }));
    assert.deepEqual(calls, ['build:list', 'build:view']);
  });
});

test('unreviewed/different IPA and a fresh source-check failure cannot submit', async () => {
  for (const failure of ['unreviewed', 'input-id', 'input-digest', 'download-digest', 'source-recheck']) {
    const data = input('submit'), calls = [];
    if (failure === 'unreviewed') data.archiveReviewed = false;
    if (failure === 'input-id') data.buildIdSha256 = 'f'.repeat(64);
    if (failure === 'input-digest') data.archiveSha256 = 'e'.repeat(64);
    await assert.rejects(() => submitBuild({ input: data, prior: receipt('build'),
      run: async args => { calls.push(args[0]); return JSON.stringify(args[0] === 'build:list' ? [metadata()] : metadata()); },
      digest: async () => failure === 'download-digest' ? { ...receipt('build').artifact, sha256: 'e'.repeat(64) } : receipt('build').artifact,
      inspect: async () => archiveReview(),
      recheck: async () => { if (failure === 'source-recheck') throw new Error('main advanced'); } }));
    assert.ok(!calls.includes('submit'));
  }
});

test('trusted receipt binding rejects wrong mode, run, source, CLI, destination and incomplete builds', () => {
  const run = { id: 123, head_sha: sha };
  validateReceipt(receipt('preflight'), { mode: 'preflight', run, source });
  validateReceipt(receipt('build'), { mode: 'build', run, source });
  for (const patch of [{ mode: 'submit' }, { runId: '999' }, { runAttempt: 2 }, { workflowSha: other }, { sourceSha: other },
    { nativeTree: sha }, { easVersion: 'latest' }, { projectId: buildId }, { bundleIdentifier: 'com.other' },
    { productionEnvironmentVerified: false }, { sourceArchive: {} }, { build: { id: buildId, status: 'IN_QUEUE' } },
    { archiveReview: undefined }, { archiveReview: { ...archiveReview(), artifactSha256: 'e'.repeat(64) } }]) {
    assert.throws(() => validateReceipt({ ...receipt('build'), ...patch }, { mode: 'build', run, source }));
  }
});

test('private build lookup is exact, paginated, bounded and never uses a latest fallback', async () => {
  const build = receipt('build').build, calls = [];
  const first = Array.from({ length: 50 }, (_, index) => ({ id: `${index.toString(16).padStart(8, '0')}-2222-3333-4444-555555555555` }));
  const result = await resolveBuildId({ sourceSha: sha, build, run: async args => {
    calls.push(args); return JSON.stringify(calls.length === 1 ? first : [metadata()]);
  } });
  assert.equal(result, buildId);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes('--build-profile') && calls[0].includes('--git-commit-hash') && calls[0].includes('--app-build-version'));
  assert.equal(calls[0][calls[0].indexOf('--limit') + 1], '50');
  assert.equal(calls[1][calls[1].indexOf('--offset') + 1], '50');
  assert.ok(!calls.flat().includes('--latest'));
  for (const values of [[], {}, [metadata(), metadata()], [{ id: 'invalid' }], [{ ...metadata(), gitCommitHash: other }]]) {
    await assert.rejects(() => resolveBuildId({ sourceSha: sha, build, run: async () => JSON.stringify(values) }));
  }
  let pages = 0;
  await assert.rejects(() => resolveBuildId({ sourceSha: sha, build, run: async () => {
    const start = pages++ * 50;
    return JSON.stringify(Array.from({ length: 50 }, (_, index) => ({ id: `${(start + index).toString(16).padStart(8, '0')}-2222-3333-4444-555555555555` })));
  } }), /pagination bound/);
  assert.equal(pages, 10);
});

test('every public receipt path allowlists fields and excludes private IDs, provider JSON and signed URLs', () => {
  const privateValues = [buildId, RELEASE.projectId, RELEASE.appleTeamId, RELEASE.ascAppId,
    'private-account-id', 'https://storage.googleapis.com/private.ipa?secret-signature'];
  const state = { ...source, privateBuildId: buildId, proof: { checks: [{ workflow: 'site-audit.yml', runId: '99', attempt: 1, account: privateValues[4] }] },
    preflight: { sourceArchive: { files: 200, sha256: digest, signedUrl: privateValues[5] },
      productionEnvironmentVerified: true, productionEnvironmentSha256: digest, privateConfig: privateValues }, privateValues };
  const detail = { evidenceRunId: '123', build: { ...receipt('build').build, id: buildId,
    projectId: RELEASE.projectId, appleTeamId: RELEASE.appleTeamId, ascAppId: RELEASE.ascAppId,
    account: privateValues[4], artifacts: { applicationArchiveUrl: privateValues[5] } },
    artifact: { ...receipt('build').artifact, signedUrl: privateValues[5] }, providerJson: privateValues,
    archiveReview: { ...archiveReview(), signedUrl: privateValues[5], provider: privateValues,
      phone: { ...archiveReview().phone, teamIdentifier: RELEASE.appleTeamId },
      privacy: { ...archiveReview().privacy, domains: privateValues } } };
  for (const mode of ['preflight', 'build-queued', 'build', 'submit']) {
    const value = publicReceipt(state, context, mode, mode === 'preflight' ? {} : detail);
    const text = JSON.stringify(value);
    for (const secret of privateValues) assert.equal(text.includes(secret), false, `${mode} public receipt exposed private metadata`);
    if (mode !== 'preflight') assert.equal(value.build.idSha256, buildFingerprint);
  }
  const runner = readFileSync(resolve(root, 'scripts/testflight-release.mjs'), 'utf8');
  const printed = runner.split('\n').filter(line => /console\.(?:log|error)/.test(line)).join('\n');
  assert.doesNotMatch(printed, /\$\{(?:buildId|privateBuildId|state\.privateBuildId|input\.buildId)\}/);
  const workflow = readFileSync(resolve(root, RELEASE.workflow), 'utf8');
  assert.match(workflow, /^      build_id_sha256:/m);
  assert.doesNotMatch(workflow, /^      build_id:|TF_BUILD_ID:|receipt\.build\.id\}/m);
  assert.throws(() => buildSummary({ ...metadata(), createdAt: `2026-11-14 (${buildId})` }, { sourceSha: sha }),
    'Parseable provider dates with arbitrary appended metadata must not enter public receipts.');
});

function temporaryRepository() {
  const directory = mkdtempSync(resolve(tmpdir(), 'occulert-testflight-test-'));
  const sourceRoot = resolve(directory, 'source'), archiveRoot = resolve(directory, 'archive');
  mkdirSync(sourceRoot); mkdirSync(archiveRoot);
  const files = { 'native-app/app.json': '{"expo":{}}\n', 'native-app/code.ts': 'export const x = 1;\n',
    'native-app/.eas/workflows/testflight.yml': 'ignored\n', 'lib/event-outbox.ts': 'export {};\n', '.easignore': 'policy\n', 'README.md': 'not uploaded\n' };
  for (const [name, body] of Object.entries(files)) { mkdirSync(resolve(sourceRoot, name, '..'), { recursive: true }); writeFileSync(resolve(sourceRoot, name), body); }
  const git = args => execFileSync('git', args, { cwd: sourceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--quiet']); git(['add', '.']); git(['-c', 'user.name=Release test', '-c', 'user.email=release-test@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
  const sourceSha = git(['rev-parse', 'HEAD']);
  for (const name of ['native-app/app.json', 'native-app/code.ts', 'lib/event-outbox.ts']) {
    mkdirSync(resolve(archiveRoot, name, '..'), { recursive: true }); cpSync(resolve(sourceRoot, name), resolve(archiveRoot, name));
  }
  return { directory, sourceRoot, archiveRoot, sourceSha };
}

test('actual Git/archive comparison covers all admitted bytes, missing inputs, extras and symlinks', () => {
  const fixture = temporaryRepository();
  try {
    assert.equal(verifySourceArchive(fixture).files, 3);
    sourceIdentity(fixture.sourceSha, fixture.sourceRoot);
    writeFileSync(resolve(fixture.archiveRoot, 'native-app/code.ts'), 'changed');
    assert.throws(() => verifySourceArchive(fixture));
    cpSync(resolve(fixture.sourceRoot, 'native-app/code.ts'), resolve(fixture.archiveRoot, 'native-app/code.ts'));
    writeFileSync(resolve(fixture.archiveRoot, 'native-app/extra.ts'), 'untracked');
    assert.throws(() => verifySourceArchive(fixture)); rmSync(resolve(fixture.archiveRoot, 'native-app/extra.ts'));
    rmSync(resolve(fixture.archiveRoot, 'native-app/code.ts'));
    assert.throws(() => verifySourceArchive(fixture));
    symlinkSync(resolve(fixture.sourceRoot, 'native-app/code.ts'), resolve(fixture.archiveRoot, 'native-app/code.ts'));
    assert.throws(() => verifySourceArchive(fixture));
    writeFileSync(resolve(fixture.sourceRoot, 'untracked'), 'untracked');
    assert.throws(() => sourceIdentity(fixture.sourceSha, fixture.sourceRoot));
  } finally { rmSync(fixture.directory, { recursive: true, force: true }); }
});

test('entrypoint normalizes the real checkout path and stores state outside it', () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'occulert-control-paths-'));
  const saved = { RUNNER_TEMP: process.env.RUNNER_TEMP, GITHUB_WORKSPACE: process.env.GITHUB_WORKSPACE };
  try {
    process.env.RUNNER_TEMP = temp; process.env.GITHUB_WORKSPACE = root;
    assert.equal(pathsFromEnv().source, resolve(temp, 'occulert-testflight-control/source'));
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(temp, { recursive: true, force: true });
  }
});

test('IPA downloads are bounded, hashed and never receive credentials', async () => {
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
  const calls = [];
  const actual = await ipaDigest(metadata(), async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return new Response(null, { status: 302, headers: { location: 'https://storage.googleapis.com/eas/test.ipa?private-signed-value' } });
    return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
  });
  assert.deepEqual(actual, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  assert.ok(calls.every(call => call.options.headers === undefined && call.options.redirect === 'manual'));
  for (const response of [new Response('not an IPA'), new Response(bytes, { headers: { 'content-length': '1073741825' } }),
    new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } })]) {
    await assert.rejects(() => ipaDigest(metadata(), async () => response));
  }
});

test('private IPA download preserves exact bytes, restrictive permissions and failed-download cleanup', async () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'occulert-private-ipa-'));
  const path = resolve(directory, 'private.ipa');
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
  try {
    const result = await ipaDigest(metadata(), async () => new Response(bytes), path);
    assert.deepEqual(readFileSync(path), bytes);
    assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(statSync(path).mode & 0o777, 0o600);
    await assert.rejects(() => ipaDigest(metadata(), async () => new Response(bytes), path));
    assert.deepEqual(readFileSync(path), bytes, 'An existing private download must not be overwritten or deleted.');
    rmSync(path);
    await assert.rejects(() => ipaDigest(metadata(), async () => new Response('not a ZIP'), path));
    assert.equal(existsSync(path), false, 'Partial or invalid downloads must not survive as reviewable artifacts.');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('inspection contract derives Watch identity and purpose strings from actual source config output', () => {
  const health = config.app.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === '@kingstinct/react-native-healthkit')[1];
  const introspected = { _internal: { modResults: { ios: {
    infoPlist: { ...config.app.ios.infoPlist, NSHealthShareUsageDescription: health.NSHealthShareUsageDescription,
      NSHealthUpdateUsageDescription: health.NSHealthUpdateUsageDescription,
      NSFaceIDUsageDescription: 'Allow $(PRODUCT_NAME) to access your Face ID biometric data.' },
    entitlements: { 'com.apple.developer.healthkit': true },
  } } }, extra: { eas: { build: { experimental: { ios: { appExtensions: [{ targetName: 'OcculertWatch',
    bundleIdentifier: 'com.occulert.app.watch', entitlements: { 'com.apple.developer.usernotifications.time-sensitive': true } }] } } } } } };
  const args = { ...config, introspected, source: { ...source, preflight: { productionEnvironmentVerified: true } },
    build: receipt('build').build, artifact: receipt('build').artifact };
  const result = archiveContract(args);
  assert.equal(result.watch.bundleIdentifier, 'com.occulert.app.watch');
  assert.equal(result.phone.permissions.NSFaceIDUsageDescription, 'Allow Occulert to access your Face ID biometric data.');
  assert.equal(result.phone.permissions.NSHealthShareUsageDescription, health.NSHealthShareUsageDescription);
  assert.equal(result.artifactSha256, digest);
  for (const mutate of [
    value => { value.extra.eas.build.experimental.ios.appExtensions = []; },
    value => { value.extra.eas.build.experimental.ios.appExtensions[0].bundleIdentifier = 'com.other.watch'; },
    value => { value._internal.modResults.ios.infoPlist.NSHealthUpdateUsageDescription = 'write health'; },
    value => { value._internal.modResults.ios.infoPlist.NSMicrophoneUsageDescription = 'record audio'; },
    value => { value._internal.modResults.ios.entitlements['com.apple.developer.healthkit.background-delivery'] = true; },
  ]) {
    const changed = structuredClone(introspected); mutate(changed);
    assert.throws(() => archiveContract({ ...args, introspected: changed }));
  }
});

test('actual IPA ZIP/plist and provisioning-policy fixtures run without mocking archive inspection', t => {
  const result = JSON.parse(execFileSync('python3', [resolve(root, 'scripts/test-testflight-ipa.py')],
    { encoding: 'utf8', timeout: 30000, env: { ...publicEnvironment(), PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.deepEqual(result, { tests: 12, failures: 0, errors: 0 });
  t.diagnostic('12 Python archive/signing-policy fixtures passed; Apple tool subprocess results are fixtures on Linux, and actual codesign/security inspection is mandatory on the macOS release runner.');
});

test('archive reports bind source, binary, targets and limits and cannot be replaced by an operator checkbox', async () => {
  for (const mutate of [
    value => { value.reviewable = false; }, value => { value.sourceSha = other; },
    value => { value.nativeTree = sha; }, value => { value.artifactSha256 = 'e'.repeat(64); },
    value => { value.buildIdSha256 = 'f'.repeat(64); }, value => { value.appBuildVersion = '60'; },
    value => { value.phone.signatureIntegrityVerified = false; }, value => { value.watch.profileCurrentAtInspection = false; },
    value => { value.watchCompanionMatches = false; }, value => { value.privacy.schemasChecked = false; },
    value => { value.privacy.watchRootManifestPresent = false; }, value => { value.privacy.watchTimerReasonDeclared = false; },
    value => { value.privacy.trackingDeclared = true; }, value => { value.javascriptCompileFlagsVerifiedFromBinary = true; },
    value => { value.appleCertificateTrustIndependentlyVerified = true; },
  ]) {
    const report = archiveReview(); mutate(report);
    assert.throws(() => validateArchiveReview(report, { source, build: receipt('build').build, artifact: receipt('build').artifact }));
    let calls = 0;
    await assert.rejects(() => submitBuild({ input: input('submit'), prior: { ...receipt('build'), archiveReview: report },
      run: async () => { calls++; }, inspect: async () => report, recheck: async () => {} }));
    assert.equal(calls, 0);
  }
  const calls = [];
  await assert.rejects(() => submitBuild({ input: input('submit'), prior: receipt('build'),
    run: async args => { calls.push(args[0]); return JSON.stringify(args[0] === 'build:list' ? [metadata()] : metadata()); },
    digest: async () => receipt('build').artifact,
    inspect: async () => { calls.push('inspect'); throw new Error('Profile expired after the original inspection'); },
    recheck: async () => { calls.push('recheck'); } }));
  assert.deepEqual(calls, ['build:list', 'build:view', 'inspect']);
});

test('GitHub receipt download strips auth on redirect and rejects unrelated storage', async () => {
  const seen = [];
  const client = githubClient('private-github-token', async (url, options) => {
    seen.push({ url: String(url), options });
    if (seen.length === 1) return new Response(null, { status: 302, headers: { location: 'https://results.blob.core.windows.net/receipt.zip?signature' } });
    return new Response('zip', { status: 200 });
  });
  assert.equal((await client.request('/actions/artifacts/123/zip', { binary: true })).toString(), 'zip');
  assert.equal(seen[0].options.headers.Authorization, 'Bearer private-github-token');
  assert.equal(seen[1].options.headers, undefined);
  const malicious = githubClient('token', async () => new Response(null, { status: 302, headers: { location: 'https://other.example/steal' } }));
  await assert.rejects(() => malicious.request('/actions/artifacts/123/zip', { binary: true }));
  await assert.rejects(() => boundedBody(new Response('oversized'), 2));
});

test('subprocess failures suppress provider output and public subprocess environments omit credentials', async () => {
  const env = { EXPO_TOKEN: 'expo-secret', GH_TOKEN: 'gh-secret', GITHUB_TOKEN: 'github-secret', NODE_OPTIONS: '--inspect', SAFE: 'yes' };
  assert.deepEqual(publicEnvironment(env), { SAFE: 'yes' });
  await assert.rejects(() => runCaptured(process.execPath, ['-e', 'process.stdout.write("secret-output");process.stderr.write("secret-error");process.exit(1)'], { env: publicEnvironment() }),
    error => !error.message.includes('secret-output') && !error.message.includes('secret-error'));
  await assert.rejects(() => runCaptured(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { env: publicEnvironment(), timeout: 20 }), /time bound/);
});

test('workflow connects tested controls, isolates secrets, pins actions and never auto-triggers', () => {
  const workflow = readFileSync(resolve(root, RELEASE.workflow), 'utf8');
  assert.deepEqual(auditWorkflowPolicy(workflow, { requireNodeSetup: true }), []);
  assert.match(workflow, /^  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|workflow_run|schedule):/m);
  assert.match(workflow, /group: occulert-testflight-production\n  cancel-in-progress: false/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /runs-on: macos-26/);
  assert.match(workflow, /npm install --global npm@10\.9\.8 eas-cli@27\.10\.0/);
  assert.doesNotMatch(workflow, /permissions:[\s\S]*?write\b|--auto-submit|--latest|createComment|release\/testflight\s*$/m);
  const steps = workflow.split(/^      - /m).slice(1);
  const secretSteps = steps.filter(step => step.includes('EXPO_TOKEN:'));
  assert.equal(secretSteps.length, 4);
  for (const step of secretSteps) {
    assert.match(step, /run: node scripts\/testflight-release\.mjs (?:preflight|queue|finish|submit)\s*$/m);
    assert.doesNotMatch(step, /npm ci|npm install|upload-artifact/);
  }
  for (const command of ['source', 'preflight', 'queue', 'finish', 'submit']) assert.match(workflow, new RegExp(`run: node scripts/testflight-release\\.mjs ${command}\\s*$`, 'm'));
  const manifest = JSON.parse(readFileSync(resolve(root, 'scripts/verify-steps.json'), 'utf8'));
  assert.equal(manifest.steps.filter(name => name === 'test:testflight-control').length, 1);
});
