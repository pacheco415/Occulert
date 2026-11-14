import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';

export const RELEASE = Object.freeze({
  repository: 'pacheco415/Occulert', repositoryId: 1256606368,
  workflow: '.github/workflows/testflight-release.yml',
  easVersion: '27.10.0',
  projectId: '69c230c1-c42a-4d83-b2a0-e1752e719b53',
  bundleIdentifier: 'com.occulert.app', appleTeamId: 'W3W6Z8U68C',
  ascAppId: '6787265375', appVersion: '1.0.0', slug: 'occulert',
});
export const OFF_FLAGS = Object.freeze([
  'EXPO_PUBLIC_EYE_BASELINE_EXPERIMENT', 'EXPO_PUBLIC_CAPTURE_LOAD_EXPERIMENT',
  'EXPO_PUBLIC_EVENT_OUTBOX', 'EXPO_PUBLIC_UNANSWERED_ALERT_OBSERVATION',
  'EXPO_PUBLIC_MOTION_ACTIVITY_OBSERVATION', 'OCCULERT_MULTITASKING_CAMERA_EXPERIMENT',
  'OCCULERT_SIMULATOR_TRACE',
]);
export const ABSENT_FLAGS = Object.freeze(['OCCULERT_SIMULATOR_PROFILE', 'OCCULERT_SIMULATOR_PLATFORM']);
export const REQUIRED_WORKFLOWS = Object.freeze({
  'site-audit.yml': ['audit'],
  'browser-smoke.yml': ['browser (chromium)', 'browser (webkit)', 'smoke', 'offline-runtime-repeat'],
  'native-app-typecheck.yml': ['typecheck', 'eas-install', 'Watch notification freshness'],
  'event-concurrency.yml': ['concurrency'],
  'codeql.yml': ['analyze'],
});
export const SHA = /^[a-f0-9]{40}$/;
export const DIGEST = /^[a-f0-9]{64}$/;
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ID = /^[1-9][0-9]{0,19}$/;
const skipToken = /\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]|(?:^|\n)skip-checks:\s*true\s*(?:\n|$)/i;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isoDate = value => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));

export function parseInputs(input) {
  assert.ok(Object.keys(input).every(key => ['mode', 'sourceSha', 'evidenceRunId', 'buildIdSha256', 'archiveSha256', 'archiveReviewed'].includes(key)), 'Unknown release input.');
  const { mode, sourceSha, evidenceRunId = '', buildIdSha256 = '', archiveSha256 = '', archiveReviewed = 'false' } = input;
  assert.ok(['preflight', 'build', 'submit'].includes(mode), 'Choose preflight, build, or submit.');
  assert.match(sourceSha ?? '', SHA, 'Source must be a full lowercase commit SHA.');
  assert.ok(archiveReviewed === 'true' || archiveReviewed === 'false', 'Archive review must be a boolean.');
  if (mode === 'preflight') assert.equal(evidenceRunId, '', 'Preflight does not consume an earlier run.');
  else assert.match(evidenceRunId, ID, 'A successful evidence run ID is required.');
  if (mode === 'submit') {
    assert.match(buildIdSha256, DIGEST, 'Submit requires the exact build UUID fingerprint.');
    assert.match(archiveSha256, DIGEST, 'Submit requires the inspected IPA SHA-256.');
    assert.equal(archiveReviewed, 'true', 'Inspect the exact archive before submitting it.');
  } else {
    assert.equal(buildIdSha256, '', 'Only submit accepts a build fingerprint.');
    assert.equal(archiveSha256, '', 'Only submit accepts an IPA digest.');
    assert.equal(archiveReviewed, 'false', 'Only submit accepts archive review.');
  }
  return { mode, sourceSha, evidenceRunId, buildIdSha256, archiveSha256, archiveReviewed: archiveReviewed === 'true' };
}

export function validateContext(context, main, input) {
  assert.equal(context.repository, RELEASE.repository, 'Unexpected repository.');
  assert.equal(context.eventName, 'workflow_dispatch', 'Only a new manual dispatch is allowed.');
  assert.equal(context.ref, 'refs/heads/main', 'Select main in the workflow dispatch.');
  assert.equal(context.runAttempt, '1', 'Do not rerun a release job; use a new reviewed dispatch.');
  assert.match(context.runId ?? '', ID, 'Invalid GitHub run ID.');
  assert.equal(context.workflowRef, `${RELEASE.repository}/${RELEASE.workflow}@refs/heads/main`, 'Unexpected workflow ref.');
  assert.match(context.workflowSha ?? '', SHA, 'Missing workflow commit identity.');
  assert.equal(context.sha, context.workflowSha, 'Workflow and checkout commit must match.');
  assert.equal(main?.name, 'main', 'Cannot verify the main branch.');
  assert.equal(main?.protected, true, 'Main must remain protected.');
  assert.match(main?.commit?.sha ?? '', SHA, 'Cannot verify the main commit.');
  assert.equal(context.workflowSha, main.commit.sha, 'Main advanced; dispatch again from the reviewed current main.');
  if (input.mode !== 'submit') {
    assert.equal(input.sourceSha, main.commit.sha, 'Preflight and build require the exact current main SHA.');
  }
}

export function validateRun(run, { sourceSha, workflow, event = 'push', pullNumber, runId, attempt, mergedPolicyEvidence } = {}) {
  assert.ok(record(run), 'Missing workflow run.');
  assert.equal(run.repository?.id, RELEASE.repositoryId, 'Workflow belongs to another repository.');
  assert.equal(run.repository?.full_name, RELEASE.repository, 'Workflow repository name differs.');
  assert.equal(run.path, `.github/workflows/${workflow}`, 'Unexpected workflow path.');
  assert.equal(run.event, event, 'Unexpected workflow trigger.');
  assert.equal(run.head_sha, sourceSha, 'Workflow did not check the exact source commit.');
  assert.equal(run.status, 'completed', 'Source workflow is not complete.');
  assert.equal(run.conclusion, 'success', 'Source workflow did not succeed.');
  assert.ok(Number.isSafeInteger(run.id) && run.id > 0, 'Invalid workflow identity.');
  assert.ok(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0, 'Missing workflow attempt.');
  if (runId !== undefined) assert.equal(String(run.id), runId, 'Wrong evidence run.');
  if (attempt !== undefined) assert.equal(run.run_attempt, attempt, 'Rerun receipts cannot authorize release.');
  if (event === 'push' || event === 'workflow_dispatch') assert.equal(run.head_branch, 'main', 'Workflow must run on main.');
  if (pullNumber !== undefined) {
    assert.ok(Array.isArray(run.pull_requests), 'CI Policy PR association is malformed.');
    if (run.pull_requests.length > 0) {
      assert.ok(run.pull_requests.some(pull =>
        pull.number === pullNumber && pull.head?.sha === sourceSha && pull.base?.ref === 'main'
        && pull.base?.repo?.id === RELEASE.repositoryId), 'CI Policy is not associated with the exact merged PR head.');
    } else {
      // GitHub may omit a policy run's PR association after merge. Do not infer
      // its historical event number: revalidate the exact merged PR's complete
      // policy inputs while retaining every exact-head workflow/job check.
      assert.equal(workflow, 'ci-policy.yml', 'Only CI Policy supports merged-PR revalidation.');
      assert.equal(event, 'pull_request_target', 'Unexpected policy event.');
      const pull = validateMergedPullPolicy(mergedPolicyEvidence);
      assert.equal(pull.number, pullNumber, 'Revalidated policy belongs to another PR.');
      assert.equal(pull.head.sha, sourceSha, 'Revalidated policy belongs to another PR head.');
    }
  }
  return { workflow, runId: String(run.id), attempt: run.run_attempt };
}

export function newestRun(runs) {
  assert.ok(Array.isArray(runs) && runs.length > 0, 'Required workflow run is missing.');
  for (const run of runs) {
    assert.ok(Number.isSafeInteger(run.id) && run.id > 0 && isoDate(run.created_at), 'Malformed workflow list.');
  }
  return [...runs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)[0];
}

export function validateJobs(jobs, run, names) {
  assert.ok(Array.isArray(jobs) && jobs.length >= names.length && jobs.length <= 100, 'Missing workflow jobs.');
  for (const name of names) assert.equal(jobs.filter(job => job.name === name).length, 1, `Required job is missing or duplicated: ${name}`);
  for (const job of jobs) {
    assert.equal(job.run_id, run.id, 'Job belongs to another workflow run.');
    assert.equal(job.head_sha, run.head_sha, 'Job did not check this source.');
    assert.equal(job.status, 'completed', 'Source job is incomplete.');
    assert.equal(job.conclusion, 'success', 'Every source job must succeed.');
  }
}

export function mergedPull(pulls, sourceSha) {
  assert.ok(Array.isArray(pulls), 'Missing merge association.');
  const matches = pulls.filter(pull => pull.merged_at && pull.merge_commit_sha === sourceSha
    && pull.base?.ref === 'main' && pull.base?.repo?.id === RELEASE.repositoryId);
  assert.equal(matches.length, 1, 'Source must be the unambiguous reviewed merge of one PR into main.');
  const pull = matches[0];
  assert.match(pull.head?.sha ?? '', SHA, 'Merged PR head is missing.');
  assert.ok(Number.isSafeInteger(pull.number) && pull.number > 0, 'Invalid PR identity.');
  assert.equal(typeof pull.title, 'string', 'Missing PR title.');
  assert.equal(skipToken.test(pull.title), false, 'PR title contains a CI skip token.');
  return pull;
}

export function validateMergedPullPolicy(evidence) {
  assert.ok(record(evidence), 'Complete exact merged-PR policy evidence is required.');
  const { sourceSha, listedPull, currentPull, commits } = evidence;
  assert.match(sourceSha ?? '', SHA, 'Merged policy source is malformed.');
  const listed = mergedPull([listedPull], sourceSha);
  const current = mergedPull([currentPull], sourceSha);
  assert.equal(current.number, listed.number, 'Merged PR identity changed.');
  assert.equal(current.head.sha, listed.head.sha, 'Merged PR head changed.');
  assert.equal(current.merged, true, 'Policy revalidation requires a merged PR.');
  assert.equal(current.state, 'closed', 'Policy revalidation requires a closed PR.');
  assert.ok(isoDate(current.merged_at), 'Merged PR timestamp is malformed.');
  // GitHub's PR-commit endpoint returns at most 250 commits. Never accept a
  // truncated inventory as proof that every merged commit satisfies policy.
  assert.ok(Number.isSafeInteger(current.commits) && current.commits > 0 && current.commits <= 250,
    'Merged PR commit count exceeds the verifiable API bound.');
  assert.ok(Array.isArray(commits) && commits.length === current.commits, 'Merged PR commit inventory is incomplete.');
  const seen = new Set();
  for (const commit of commits) {
    assert.match(commit?.sha ?? '', SHA, 'Merged PR commit identity is malformed.');
    assert.ok(!seen.has(commit.sha), 'Merged PR commit inventory contains duplicates.');
    seen.add(commit.sha);
    assert.equal(typeof commit.commit?.message, 'string', 'Merged PR commit message is missing.');
    assert.equal(skipToken.test(commit.commit.message), false, 'Merged PR commit contains a CI skip token.');
  }
  assert.ok(seen.has(current.head.sha), 'Merged PR commit inventory omits the exact head.');
  return current;
}

export function validateFlags(environment) {
  assert.ok(record(environment), 'Malformed production environment.');
  for (const key of OFF_FLAGS) {
    assert.ok(!Object.hasOwn(environment, key) || environment[key] === '0', 'A production experiment flag is enabled or unverifiable.');
  }
  for (const key of ABSENT_FLAGS) assert.ok(!Object.hasOwn(environment, key), 'Simulator profile variables must be absent.');
}

export function validateSourceConfig(app, eas) {
  assert.equal(app?.name, 'Occulert', 'Unexpected app name.');
  assert.equal(app?.slug, RELEASE.slug, 'Unexpected app slug.');
  assert.equal(app?.version, RELEASE.appVersion, 'Review an app-version change separately.');
  assert.equal(app?.ios?.bundleIdentifier, RELEASE.bundleIdentifier, 'Unexpected iOS bundle.');
  assert.equal(app?.ios?.appleTeamId, RELEASE.appleTeamId, 'Unexpected Apple team.');
  assert.equal(app?.ios?.supportsTablet, false, 'Unexpected device family.');
  assert.equal(app?.extra?.eas?.projectId, RELEASE.projectId, 'Unexpected EAS project.');
  assert.ok(!app?.extra?.simulatorTrace && !app?.ios?.infoPlist?.OcculertSimulatorTrace, 'Simulator configuration cannot ship.');
  assert.ok(!Object.hasOwn(app.ios, 'buildNumber'), 'EAS must remain the remote build-number authority.');
  assert.equal(eas?.cli?.appVersionSource, 'remote', 'Remote version authority must remain enabled.');
  const profile = eas?.build?.production;
  assert.ok(record(profile) && !profile.extends, 'Production must be explicit and must not inherit another profile.');
  assert.equal(profile.autoIncrement, true, 'Preserve remote auto-increment.');
  assert.equal(profile.ios?.image, 'sdk-58', 'Unexpected production image.');
  assert.ok(!profile.developmentClient && !profile.ios?.simulator, 'Production cannot be a development/simulator build.');
  assert.ok(profile.distribution === undefined || profile.distribution === 'store', 'Production must use store distribution.');
  assert.ok(profile.environment === undefined || profile.environment === 'production', 'Production environment must be preserved.');
  assert.ok(profile.credentialsSource === undefined || profile.credentialsSource === 'remote', 'Use existing remote signing credentials.');
  assert.ok(profile.ios?.credentialsSource === undefined || profile.ios.credentialsSource === 'remote', 'Use existing remote iOS credentials.');
  validateFlags(profile.env ?? {});
  validateFlags(profile.ios?.env ?? {});
  assert.equal(eas?.submit?.production?.ios?.ascAppId, RELEASE.ascAppId, 'Unexpected App Store Connect destination.');
  assert.ok(!eas.submit.production.extends && !eas.submit.production.ios.groups, 'Submission must preserve the existing app and tester setup.');
}

export function validateResolvedConfig(value, sourceApp, sourceEas) {
  assert.ok(record(value?.appConfig) && record(value?.buildProfile), 'EAS configuration is incomplete.');
  validateSourceConfig(value.appConfig, sourceEas);
  const profile = value.buildProfile;
  assert.equal(profile.distribution, 'store', 'Resolved production distribution differs.');
  assert.equal(profile.autoIncrement, true, 'Resolved remote auto-increment differs.');
  assert.equal(profile.image, sourceEas.build.production.ios.image, 'Resolved build image differs.');
  assert.ok(profile.environment === undefined || profile.environment === 'production', 'Resolved environment differs.');
  assert.ok(!profile.developmentClient && !profile.simulator, 'Resolved build is not ordinary production.');
  validateFlags(profile.env ?? {});
  assert.equal(value.appConfig.ios.bundleIdentifier, sourceApp.ios.bundleIdentifier);
}

// This is deliberately tied to the pinned CLI's long, redacted output. Unknown
// formatting, multiline values, duplicate records, or hidden flag values fail.
// The caller never prints this output or stores it in a release artifact.
export function validateEnvironmentList(output, scope) {
  assert.ok(['project', 'account'].includes(scope), 'Invalid environment scope.');
  const text = stripVTControlCharacters(output).trim();
  const prefix = 'Environment: production\n';
  assert.ok(text.startsWith(prefix), 'EAS did not return the production environment.');
  const body = text.slice(prefix.length);
  if (body === 'No variables found for this environment.') return { variables: 0, checkedFlags: OFF_FLAGS.length + ABSENT_FLAGS.length };
  const heading = scope === 'project' ? 'Variables for this project:\n' : 'Account-wide variables for this account:\n';
  assert.ok(body.startsWith(heading), 'Cannot identify EAS environment scope.');
  const blocks = body.slice(heading.length).split('\n\n———\n\n');
  assert.ok(blocks.length <= 300, 'Environment inventory is too large.');
  const names = new Set();
  for (const block of blocks) {
    const lines = block.split('\n');
    assert.equal(lines.length, 9, 'Cannot safely parse EAS environment metadata.');
    const labels = ['ID', 'Name', 'Value', 'Scope', 'Visibility', 'Environments', 'type', 'Created at', 'Updated at'];
    const values = Object.fromEntries(labels.map((label, index) => {
      const match = lines[index].match(new RegExp(`^${label} {2,}(.*)$`));
      assert.ok(match && match[1].length <= 8192, 'Cannot safely parse EAS environment metadata.');
      return [label, match[1]];
    }));
    assert.match(values.ID, UUID, 'Malformed EAS environment identity.');
    assert.match(values.Name, /^[A-Za-z_][A-Za-z0-9_]{0,255}$/, 'Malformed environment name.');
    assert.ok(!names.has(values.Name), 'Duplicate environment name.');
    names.add(values.Name);
    assert.ok(['PROJECT', 'SHARED'].includes(values.Scope), 'Unknown environment scope.');
    assert.ok(['PUBLIC', 'SENSITIVE', 'SECRET'].includes(values.Visibility), 'Unknown environment visibility.');
    assert.ok(values.Environments.split(', ').includes('production'), 'Environment is not assigned to production.');
    assert.ok(['string', 'file'].includes(values.type), 'Unknown environment type.');
    assert.ok(!ABSENT_FLAGS.includes(values.Name), 'Simulator profile variables must be absent.');
    if (OFF_FLAGS.includes(values.Name)) {
      assert.equal(values.type, 'string', 'Production flags must be verifiable strings.');
      assert.equal(values.Visibility, 'PUBLIC', 'A hidden production flag cannot be verified.');
      assert.equal(values.Value, '0', 'A production experiment flag is not disabled.');
    }
  }
  return { variables: blocks.length, checkedFlags: OFF_FLAGS.length + ABSENT_FLAGS.length };
}

export function validateProjectInfo(output) {
  const lines = stripVTControlCharacters(output).trim().split('\n');
  assert.equal(lines.length, 2, 'Unexpected EAS project response.');
  assert.match(lines[0], /^fullName {2,}@[A-Za-z0-9_-]+\/occulert$/, 'Unexpected EAS project name.');
  assert.match(lines[1], new RegExp(`^ID {2,}${RELEASE.projectId}$`), 'Unexpected EAS project identity.');
}

export function buildSummary(build, { sourceSha, buildId, finished = true }) {
  assert.ok(record(build), 'Missing EAS build metadata.');
  assert.match(build.id ?? '', UUID, 'Malformed EAS build UUID.');
  if (buildId) assert.equal(build.id, buildId, 'EAS returned another build.');
  assert.equal(build.app?.id, RELEASE.projectId, 'Build belongs to another EAS project.');
  assert.equal(build.app?.slug, RELEASE.slug, 'Build belongs to another app.');
  assert.equal(build.appIdentifier, RELEASE.bundleIdentifier, 'Build has another bundle identifier.');
  assert.equal(build.platform, 'IOS', 'Only iOS builds can be submitted.');
  assert.equal(build.distribution, 'STORE', 'Only store-distribution builds can be submitted.');
  assert.equal(build.buildProfile, 'production', 'Only the production profile can be submitted.');
  assert.equal(build.isForIosSimulator, false, 'Simulator build cannot be submitted.');
  assert.equal(build.gitCommitHash, sourceSha, 'Build source commit differs.');
  assert.equal(build.appVersion, RELEASE.appVersion, 'Build app version differs.');
  assert.match(build.appBuildVersion ?? '', /^[1-9][0-9]{0,8}$/, 'Remote build number is missing or malformed.');
  assert.equal(build.error ?? null, null, 'Build reports an error.');
  assert.ok(isoDate(build.createdAt), 'Build creation time is missing.');
  assert.ok(finished ? build.status === 'FINISHED' : ['NEW', 'IN_QUEUE', 'IN_PROGRESS', 'FINISHED'].includes(build.status), 'Build has not finished successfully.');
  if (finished) assert.ok(isoDate(build.completedAt), 'Build completion time is missing.');
  return {
    idSha256: createHash('sha256').update(build.id).digest('hex'), sourceSha,
    platform: build.platform, distribution: build.distribution, profile: build.buildProfile,
    simulator: build.isForIosSimulator, status: build.status, appVersion: build.appVersion,
    appBuildVersion: build.appBuildVersion, createdAt: build.createdAt,
    ...(finished ? { completedAt: build.completedAt } : {}),
  };
}

export function validateArchiveReview(report, { source, build, artifact }) {
  assert.ok(record(report) && JSON.stringify(report).length <= 16384, 'Archive inspection report is missing or oversized.');
  assert.equal(report.schema, 1, 'Unknown archive inspection schema.');
  assert.equal(report.reviewable, true, 'Archive inspection did not pass.');
  assert.equal(report.sourceSha, source.sourceSha, 'Inspection source differs.');
  assert.equal(report.nativeTree, source.nativeTree, 'Inspection native tree differs.');
  assert.equal(report.buildIdSha256, build.idSha256, 'Inspection build fingerprint differs.');
  assert.equal(report.artifactSha256, artifact.sha256, 'Inspection IPA digest differs.');
  assert.equal(report.appVersion, build.appVersion, 'Inspection version differs.');
  assert.equal(report.appBuildVersion, build.appBuildVersion, 'Inspection build number differs.');
  assert.ok(isoDate(report.inspectedAt), 'Inspection timestamp is missing.');
  assert.ok(Number.isSafeInteger(report.archiveEntries) && report.archiveEntries > 0 && report.archiveEntries <= 30000, 'Invalid archive inventory.');
  const output = { schema: 1, reviewable: true, sourceSha: report.sourceSha, nativeTree: report.nativeTree,
    buildIdSha256: report.buildIdSha256, artifactSha256: report.artifactSha256,
    appVersion: report.appVersion, appBuildVersion: report.appBuildVersion,
    inspectedAt: report.inspectedAt, archiveEntries: report.archiveEntries };
  const checks = ['bundleMatchesSource', 'versionMatchesSource', 'buildMatchesRemote',
    'devicePlatformMatches', 'signatureIntegrityVerified', 'storeProfileShapeMatched',
    'profileCurrentAtInspection', 'signerCertificateAllowedByProfile', 'entitlementsAllowedByProfile',
    'sourceEntitlementsMatched', 'debuggingDisabled', 'locationAndMicrophoneAbsent',
    'healthBackgroundDisabled', 'multitaskingCameraDisabled'];
  const prompts = ['NSCameraUsageDescription', 'NSMotionUsageDescription', 'NSHealthShareUsageDescription',
    'NSHealthUpdateUsageDescription', 'NSFaceIDUsageDescription', 'NSLocalNetworkUsageDescription'];
  for (const role of ['phone', 'watch']) {
    assert.ok(record(report[role]), 'Inspection target is missing.');
    const target = {};
    for (const key of checks) {
      assert.equal(report[role][key], true, 'An archive target check did not pass.');
      target[key] = true;
    }
    const values = report[role].permissionPrompts;
    assert.ok(record(values) && Object.keys(values).every(key => prompts.includes(key)), 'Unexpected public permission inventory.');
    if (role === 'phone') assert.ok(prompts.slice(0, 4).every(key => Object.hasOwn(values, key)), 'Required phone purposes are missing.');
    else assert.equal(Object.keys(values).length, 0, 'Watch purposes require separate review.');
    target.permissionPrompts = {};
    for (const key of prompts) if (Object.hasOwn(values, key)) {
      assert.ok(typeof values[key] === 'string' && values[key].length > 0 && values[key].length <= 2048
        && !/[\x00-\x1f\x7f]/.test(values[key]), 'Malformed permission report.');
      target.permissionPrompts[key] = values[key];
    }
    output[role] = target;
  }
  const privacy = report.privacy;
  assert.ok(record(privacy), 'Privacy inspection is missing.');
  const counts = {};
  for (const key of ['manifests', 'phoneManifests', 'watchManifests', 'collectedDataEntries', 'linkedDataEntries', 'requiredReasonEntries']) {
    assert.ok(Number.isSafeInteger(privacy[key]) && privacy[key] >= 0 && privacy[key] <= 200000, 'Invalid privacy inventory.');
    counts[key] = privacy[key];
  }
  assert.ok(privacy.phoneManifests > 0 && privacy.watchManifests > 0 && privacy.manifests <= 2000
    && privacy.manifests === privacy.phoneManifests + privacy.watchManifests
    && privacy.linkedDataEntries <= privacy.collectedDataEntries, 'Inconsistent privacy inventory.');
  assert.equal(privacy.phoneRootManifestPresent, true, 'Phone privacy manifest is missing.');
  assert.equal(privacy.watchRootManifestPresent, true, 'Watch privacy manifest is missing.');
  assert.equal(privacy.watchTimerReasonDeclared, true, 'Known Watch timer usage needs its own required-reason declaration.');
  assert.equal(privacy.schemasChecked, true, 'Privacy schemas were not checked.');
  assert.equal(privacy.trackingDeclared, false, 'Tracking privacy declaration requires separate review.');
  assert.match(privacy.manifestSetSha256 ?? '', DIGEST, 'Privacy manifest fingerprint is missing.');
  const categories = ['FileTimestamp', 'SystemBootTime', 'DiskSpace', 'ActiveKeyboards', 'UserDefaults']
    .map(value => `NSPrivacyAccessedAPICategory${value}`);
  assert.ok(record(privacy.requiredReasons) && Object.keys(privacy.requiredReasons).every(key => categories.includes(key)), 'Unknown privacy API inventory.');
  const requiredReasons = {};
  for (const category of categories) if (Object.hasOwn(privacy.requiredReasons, category)) {
    const codes = privacy.requiredReasons[category];
    assert.ok(Array.isArray(codes) && codes.length > 0 && codes.length <= 30
      && codes.every(code => typeof code === 'string' && /^[A-F0-9]{4}\.[0-9]{1,3}$/.test(code)), 'Malformed privacy reason codes.');
    requiredReasons[category] = [...codes];
  }
  assert.ok(requiredReasons.NSPrivacyAccessedAPICategorySystemBootTime?.includes('35F9.1'), 'Watch timer reason is absent from the privacy inventory.');
  output.privacy = { ...counts, phoneRootManifestPresent: true,
    watchRootManifestPresent: true, watchTimerReasonDeclared: true, schemasChecked: true, trackingDeclared: false,
    manifestSetSha256: privacy.manifestSetSha256, requiredReasons };
  for (const key of ['watchCompanionMatches', 'productionEnvironmentVerified', 'simulatorPlistDisabled']) {
    assert.equal(report[key], true, 'Archive production check is missing.'); output[key] = true;
  }
  // These limits are explicit, fixed report fields, not provider-derived prose.
  for (const key of ['javascriptCompileFlagsVerifiedFromBinary', 'appleProcessingAndDeviceAcceptanceVerified',
    'appleCertificateTrustIndependentlyVerified', 'resolvedNativeDependencyLockAvailableInIpa']) {
    assert.equal(report[key], false, 'Archive report overstates its evidence.'); output[key] = false;
  }
  return output;
}

export function validateReceipt(receipt, { mode, run, source }) {
  assert.ok(record(receipt) && JSON.stringify(receipt).length <= 32768, 'Release receipt is missing or oversized.');
  assert.equal(receipt.schema, 1, 'Unknown release receipt schema.');
  assert.equal(receipt.mode, mode, 'Wrong evidence mode.');
  assert.equal(receipt.repository, RELEASE.repository, 'Receipt belongs to another repository.');
  assert.equal(receipt.runId, String(run.id), 'Receipt run differs.');
  assert.equal(receipt.runAttempt, 1, 'Rerun receipt is forbidden.');
  assert.equal(receipt.workflowSha, run.head_sha, 'Receipt workflow source differs.');
  assert.equal(receipt.sourceSha, source.sourceSha, 'Receipt source differs.');
  for (const key of ['sourceTree', 'nativeTree', 'sharedBlob', 'easignoreBlob']) {
    assert.match(receipt[key] ?? '', SHA, 'Receipt input identity is malformed.');
    assert.equal(receipt[key], source[key], 'Receipt source inputs differ.');
  }
  assert.equal(receipt.easVersion, RELEASE.easVersion, 'Receipt CLI version differs.');
  for (const field of ['projectId', 'bundleIdentifier', 'ascAppId', 'appleTeamId', 'account', 'buildId']) {
    assert.equal(Object.hasOwn(receipt, field), false, 'Private provider identifiers must not enter public receipts.');
  }
  assert.equal(receipt.productionEnvironmentVerified, true, 'Production environment was not verified.');
  assert.match(receipt.sourceArchive?.sha256 ?? '', DIGEST, 'Missing source archive manifest digest.');
  assert.ok(Number.isSafeInteger(receipt.sourceArchive?.files) && receipt.sourceArchive.files > 0, 'Missing source archive inventory.');
  assert.ok(isoDate(receipt.createdAt), 'Receipt timestamp is missing.');
  if (mode === 'build') {
    assert.match(receipt.build?.idSha256 ?? '', DIGEST, 'Build receipt has no UUID fingerprint.');
    for (const field of ['id', 'projectId', 'bundleIdentifier', 'app', 'artifacts']) {
      assert.equal(Object.hasOwn(receipt.build, field), false, 'Private provider metadata must not enter public receipts.');
    }
    assert.equal(receipt.build?.sourceSha, source.sourceSha, 'Build receipt source differs.');
    assert.equal(receipt.build?.status, 'FINISHED', 'Build receipt is not complete.');
    assert.match(receipt.artifact?.sha256 ?? '', DIGEST, 'Build receipt has no IPA digest.');
    assert.ok(Number.isSafeInteger(receipt.artifact?.bytes) && receipt.artifact.bytes > 0, 'Build receipt has no IPA size.');
    validateArchiveReview(receipt.archiveReview, { source, build: receipt.build, artifact: receipt.artifact });
  }
  return receipt;
}
