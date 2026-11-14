# Controlled private TestFlight release

The **Controlled TestFlight** GitHub workflow provides three separate manual
operations using the existing repository `EXPO_TOKEN`. It never runs on a push,
updates `release/testflight`, posts comments, or activates a paid plan. Its
submission destination is the existing Occulert App Store Connect app;
submission does not request an App Store production release.

The user has authorized the next build and private TestFlight delivery after
the source/security checks. Complete those checks and choose the exact source;
this control does not replace that review or require another blanket approval.

## Dispatch in GitHub

After this workflow has merged and resulting-main checks have passed, open
**Actions → Controlled TestFlight → Run workflow**. Always select **main** in
the branch menu. Use a new dispatch for each operation, never **Re-run jobs**.
The workflow deliberately rejects reruns before it can access Expo credentials.

| Mode | Required inputs | Result |
| --- | --- | --- |
| `preflight` | Full reviewed current-main `source_sha`; all other inputs empty/false | Verifies protected main, exact source checks, token/project access, production configuration/flags and every admitted source archive file. No build, signing mutation, submission, or remote version-counter operation. |
| `build` | The same current-main SHA and the successful preflight's numeric `evidence_run_id` | Repeats preflight, compares the source archive/environment with its receipt, rechecks source gates, queues one production iOS build, waits for that exact private UUID, then hashes and inspects the actual phone/Watch IPA. Does not submit. |
| `submit` | Original build-source SHA; successful build run's numeric `evidence_run_id`; its `build_id_sha256` fingerprint; reviewed report's `archive_sha256`; `archive_reviewed=true` | Retrieves the trusted build receipt, privately resolves the exact UUID, checks fresh metadata and IPA hash, repeats archive inspection, rechecks source gates, then submits only that UUID. |

The run ID is the numeric part of the GitHub run URL, not a build number. The
source SHA must contain all 40 lowercase hexadecimal characters. The build UUID's
SHA-256 fingerprint and IPA SHA-256 appear in the successful build run's summary and `receipt.json`
artifact. Do not infer the next build number from the dated Build 60 handoff;
EAS remains the remote version authority and increments only in `build` mode.

Preflight and build require the source SHA to equal current protected main.
If main advances before a build is queued, refresh the source review and start
a new preflight. A later submit may use the successfully built source if it
remains an ancestor of current protected main. Submission uses that original
source's `eas.json`, not newer-main submission settings.

## Source and credential gates

The workflow runs only as a new manual dispatch of its current-main definition
in `pacheco415/Occulert`. It serializes all operations using one production
concurrency group without cancelling an operation already in progress.

For the exact source merge, it requires the newest main-push runs of Site
Audit, Browser Smoke Tests, Native App Typecheck, Event PostgreSQL Concurrency,
and CodeQL to succeed, including all expected jobs. A newer pending, skipped,
failed or cancelled run cannot be hidden by an older success. It separately
finds the unique PR whose `merge_commit_sha` is the source SHA and verifies
its exact head's successful **CI Policy / Reject CI skip tokens** run. That
policy uses `pull_request_target`, so it is not incorrectly sought on the
resulting main merge SHA. GitHub may remove a run's PR associations after merge.
When that array is empty, the control additionally fetches the exact merged PR
and its complete, unique commit list, verifies the source/head/base/count, and
applies the same skip-token rule to the current title and every commit message.
This is exact-head policy success plus independent exact-PR revalidation; it
does not invent a historical run-to-PR-number association. Nonempty conflicting
associations, truncated lists and PRs beyond the REST API's 250-commit bound
fail closed. Main is read again after all evidence and immediately before an
EAS mutation. GitHub read access is limited to contents, Actions and pull
requests. Checkout does not persist its token.

The existing Expo secret is present only on the EAS command steps. It is not
available during dependency installation, source checks alone, or artifact
upload. EAS children do not inherit the GitHub token. This repository is public:
raw build UUIDs, provider output, provider account/app/team IDs, environment
values, private config and signed artifact URLs are never put in workflow inputs,
printed or uploaded, including on failure. Raw UUIDs remain in private runner
state for the current operation. Public receipts contain bounded source/check
IDs, source archive digest, version/build number, a SHA-256 fingerprint of the
build UUID and IPA digest/size, plus the bounded archive inspection report.
An environment fingerprint is a digest,
not a copy of environment values.

The CLI is pinned to **EAS 27.10.0**, the version in the official CLI reference
on November 14, 2026. Its published npm tarball integrity is
`sha512-GPYav5Kb2UmGXLSThj1347O4LWboxoZAnCvBXBWfgaqcKaIct74xr2qG2it94cGwvuTIuB+H931vYIr91ck2+A==`.
Existing reviewed action commit pins and Node 24 are reused. Native installation
uses npm 10.9.8, matching the existing EAS installer validation lane. All modes
run on the existing `macos-26` runner family so Apple's signing tools can inspect
the private IPA in the same job, without transferring it through artifacts.

Preflight uses `whoami`, `project:info`, redacted production `env:list` for both
project/account scopes, `config`, and `build:inspect --stage archive`. Inspection
of the pinned CLI confirmed that its **archive** stage only makes a VCS copy;
it does not enter the build/signing/version pipeline. No version command is
allowed by this workflow. The every-file archive comparison rejects missing,
untracked, changed or symlinked inputs and preserves root `lib/event-outbox.ts`
alongside the native project. Generated receipts stay outside the source tree.

App name/version, project ID, bundle `com.occulert.app`, Apple team, ASC app,
remote versioning, production image `sdk-58`, and store distribution are checked.
The ordinary production environment is retained. The seven experiment flags
listed in [production gates](RELEASE_2026-11-08.md#production-gates) must be
absent or the visible string `0`; simulator profile/platform variables must be
absent. A hidden flag value or unrecognized CLI output fails closed. This
workflow never changes those values. N4 language drafts, when included in the
selected source, remain hidden and English remains the runtime language.

## Inspect before submitting

Review the successful build run's summary and `receipt.json → archiveReview`.
The runner downloads the actual IPA into private temporary storage, enforces
download/extraction bounds, rejects traversal, duplicate paths, symlinks and
unexpected app targets, and binds its report to the source SHA/native tree,
build fingerprint, version/build number and IPA SHA-256. The report contains:

| Evidence | Checks on the actual archive |
| --- | --- |
| Phone and Watch identity | Both bundle identifiers match source; both versions and remote build numbers match the EAS receipt; device families/platforms are iPhone and Watch; the Watch companion reference matches the phone. The Watch identity comes from the locked Expo config plugin's resolved target, not a guessed suffix. |
| Permissions and capabilities | Required camera, Motion and both Health prompts match source byte for byte; any additional known prompts match resolved source config and are included in the report. Location/microphone disclosures are absent, phone background modes remain audio only, Health background access is off, and Watch time-sensitive notifications remain enabled. Extra feature entitlements and extra keychain groups require a separate source review. |
| Signature and provisioning | `codesign --verify --deep --strict` checks integrity; `codesign --display --entitlements - --xml` reads signed entitlements. `security cms -D` decodes each profile. Each profile must be current, have the expected team and store-distribution shape, permit every signed entitlement, and include the actual leaf signing certificate extracted by `codesign`. Application prefixes may legitimately differ from the team; debugging is disabled. |
| Privacy manifests | Both phone and Watch root manifests must exist. The Watch root must declare `NSPrivacyAccessedAPICategorySystemBootTime` with reason `35F9.1` for the existing local alert-freshness timer; a phone declaration cannot substitute for it. Every embedded manifest is readable and schema checked; tracking declarations/domains are rejected. The report records phone/Watch counts, the Watch timer declaration, collected-data counts, required-reason categories/codes and a manifest-set digest. |
| Detectable experiments | The simulator plist marker and multitasking-camera entitlement are disabled. Ordinary production flags remain verified by source/configuration and environment preflight. |

Raw IPA bytes, profiles, entitlements, signing certificates, provider JSON and
signed URLs are never uploaded. The report exposes source-matched purpose
strings, booleans, counts and hashes, without new provider/account/team IDs.
No separate Expo login or private IPA export is needed to review this report.
The Watch privacy-manifest packaging fix is a prerequisite to this release;
the inspector deliberately refuses a binary that omits that declaration.

The report has explicit limits. CMS decoding and signer membership do not
independently establish Apple's certificate-chain trust. Privacy schema checks
do not establish that Apple accepts the declarations or that all native API
uses are accurately described. JavaScript experiment values cannot be proved
from plist/signature inspection, and a resolved `Podfile.lock` is not generally
part of an IPA; source lockfiles and required native checks remain separate
evidence. Apple processing, internal tester availability and physical parked
acceptance require their own observations. Use the exact-source handoff and
[device acceptance](DEVICE_ACCEPTANCE.md); do not carry a dated Build 60 receipt
forward as evidence for a new binary.

After reviewing this report, source and applicable release gates, dispatch
`submit` with the exact build run, UUID fingerprint, IPA digest and archive-review
checkbox. Never enter a raw UUID in
the public workflow. An arbitrary JSON file cannot replace the successful build artifact: the control downloads the
receipt from this workflow's successful first-attempt build run and verifies
its repository, source and input identities. An authenticated EAS inventory is
scoped to the receipt's exact source, app version/build number, iOS/store/profile
and bundle. It reads bounded pages and requires exactly one UUID matching the
fingerprint; missing, duplicate or truncated inventory fails closed. Fresh EAS metadata must show
`IOS`, `FINISHED`, `STORE`, `production`, a non-simulator archive, the expected
project/bundle/version and the exact source commit. The IPA is downloaded,
hashed and inspected again before submission; a profile that has since expired
cannot reuse the earlier report. Only then are main/checks revalidated and the
exact-ID submission issued.

Build uses `--freeze-credentials`, `--no-wait`, a recorded exact UUID and bounded
polling; it never uses auto-submit. Submit uses `--id`, `--wait`, and
`--no-auto-testflight-setup`; it never uses `--latest`, changes groups, or invites
testers. Existing remote signing and submission credentials must already be
usable. If they are not, the operation stops without an automatic credential
repair or a paid upgrade.

## Receipts, failures and recovery

Artifacts are retained for 14 days. Build mode uploads `testflight-queued-RUN_ID`
as soon as it has a private UUID, recording only its public fingerprint before waiting, then uploads the final
`testflight-build-RUN_ID` receipt after completion and successful IPA inspection. Preflight
and submit have correspondingly named artifacts. Only a successful completed
run and its final receipt can authorize the next mode.

If a command fails or the runner is interrupted after a remote request, do not
rerun the job or blindly queue another build/submission. Preserve the queued
fingerprint/run and inspect its private remote state. EAS may have accepted a request before
a connection failed. This control deliberately does not refund, retry, cancel,
or adopt an ambiguous remote operation; resolve that exact operation through a
reviewed recovery step. A GitHub timeout does not establish remote failure.

After `submit` completes, separately verify Apple processing and availability
to the existing internal TestFlight group. The workflow's success is an upload
receipt, not proof of tester availability or physical parked acceptance. It
does not activate an App Store production version.

## Validation and maintenance

Run `npm ci && npm run verify`. The registered `test:testflight-control` suite
exercises source/CI correlation, denied/malformed evidence, all mode boundaries,
production flags/config, archive bytes, exact build binding, receipt provenance,
bounded downloads and credential/output isolation without contacting Expo or
queuing a build. It includes real ZIP/binary-plist fixtures, malformed archive
boundaries, exact permission/identity checks, profile allowlists and signer
membership, private report serialization and a failed fresh-inspection submit
barrier. Linux tests inject only Apple's command results; actual `codesign` and
`security` execution is a mandatory macOS release-runner gate. Normal PR and
resulting-main release checks still apply.

Primary references: [EAS CLI](https://docs.expo.dev/eas/cli/),
[programmatic authentication](https://docs.expo.dev/accounts/programmatic-access/),
[project upload](https://docs.expo.dev/build-reference/project-upload/),
[environment variables](https://docs.expo.dev/eas/environment-variables/),
[iOS submission](https://docs.expo.dev/submit/ios/), and
[GitHub workflow-run API](https://docs.github.com/en/rest/actions/workflow-runs),
[Apple provisioning-profile semantics](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles),
[Apple code-signature verification](https://developer.apple.com/library/archive/technotes/tn2206/),
and [privacy manifests](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files).
