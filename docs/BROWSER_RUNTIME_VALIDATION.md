# Browser runtime upgrade validation

## Scope and rationale

The coordinated test-only upgrade pins `@playwright/test`, its locked
`playwright` and `playwright-core` packages, the official Noble container, and
its runtime assertions to stable 1.65.0. This refresh continues
[PR #324](https://github.com/pacheco415/Occulert/pull/324), which coordinates the
dependency work from [Dependabot #273](https://github.com/pacheco415/Occulert/pull/273).
It preserves current main's fresh-workspace ownership guards, form probe, full
suite, retry policy, browser-process diagnostics, action pins and verification
artifacts. It does not change the application or service worker. Evaluate the
coordinated runtime in PR #324; the original dependency-only proposal is
historical context, not a separate upgrade to merge.

The [upstream issue](https://github.com/microsoft/playwright/issues/42803)
identifies a libsoup 3.6.5 use-after-free in Playwright 1.63.0's Linux WebKit
bundle. A [maintainer confirms the fix is included in 1.64](https://github.com/microsoft/playwright/issues/42803#issuecomment-5837772701).
Occulert's retained offline-startup evidence shows valid cache/registration
before navigation and their disappearance afterward. This is consistent with
network-process loss, but it does not prove that this upstream defect caused
Occulert's failures. A newer bundled browser is a candidate remediation, not a
confirmed application fix.

The [official stable release](https://github.com/microsoft/playwright/releases/tag/v1.65.0)
was published November 5, 2026. On November 8 and again November 10, the official
registry returned the 1.65.0 Noble multi-platform manifest digest
`sha256:6e3fb709361521eb27161606e6da6d2674e5e89fa16516cb37d6fdd91372273d`.
The SHA-256 of the returned index bytes matched that digest. Both browser jobs
use this exact image. Never substitute an unverified tag-only image.

## Required hosted evidence

Local portable checks do not exercise browser engines. Before merging, run the
existing Linux WebKit form probe and full Chromium/WebKit suite on the exact
reviewed commit, retaining receipts and failure/retry diagnostics. Do not call
recovered flaky tests direct passes or relax the existing assertions/retries.

The separately authorized `offline-runtime-repeat` job uses the same pinned
image and its own twenty-minute budget, independently of the full suite. It runs:

```sh
DEBUG=pw:browser npm run test:browser -- tests/driver-startup-recovery.spec.mjs --project=webkit --grep 'cached complete driver startup' --repeat-each=10 --retries=0 --workers=1
```

This is twenty cases (two scenarios repeated ten times), with unchanged per-test
timeouts and no automatic retry masking. The job preserves stdout/stderr (`DEBUG=pw:browser`) and `test-results/` as
a separate seven-day artifact. Bash pipefail keeps test failures blocking despite
log capture. Its fixtures use local
synthetic data only. Do not add production credentials, change browser security
settings, or reuse an external server. Do not run this command in an environment
that has denied socket/server execution.

Compare with the already retained 1.63.0 failures, including process stderr if
available; lack of a crash signature means causality remains unconfirmed. A
successful finite sample supports improvement, not a guarantee that all offline
bugs are fixed. Hosted results must be read from checks on the exact PR head; preparing this
change locally does not establish a browser pass.

## Retained acceptance failure and current evaluation

The [October 26 Linux run](https://github.com/pacheco415/Occulert/actions/runs/40396072913)
tested PR #324 head `1a14deee56bf07a9eb833fcf4b1221ec9401f24d`, with
GitHub's test merge `b7c9b2ce40acd236bdd08d26c71c401054b15c20`:

- The independent offline job passed all twenty cases with no retries in
  37.7 seconds. Its [process-log artifact](https://github.com/pacheco415/Occulert/actions/runs/40396072913/artifacts/12687460048)
  remains the dated receipt, not evidence for every offline scenario.
- The seven-case native form probe ran with **one worker**. Six passed;
  `/account.html` failed on the first attempt and both retries. The log resolves
  the Name label correctly, then waits for visibility/stability until the
  unchanged thirty-second test deadline. The [diagnostic artifact](https://github.com/pacheco415/Occulert/actions/runs/40396072913/artifacts/12685084627)
  retains all three traces. The full browser suite did not run.

The [upstream r2370 regression](https://github.com/microsoft/playwright/issues/43426)
reproduces near-zero paint rates for backdrop-filter pages on constrained Linux
runners with Playwright 1.64.0/1.64.1. A
[maintainer's follow-up](https://github.com/microsoft/playwright/issues/43426#issuecomment-6221528470)
warns that newer alpha revisions only partly fix the problem when filters overlap.
Occulert's account cards already disable blur, but its header, nested buttons,
fields, badges and footer retain shipped filter effects. The correct label,
populated DOM and white captured frame are consistent with that renderer defect;
they do not by themselves establish its cause in Occulert.

The October 28 review found 1.64.1 was still the latest stable release. That
dated observation is superseded by the November 10 review below. Do not
substitute an alpha, disable rendering effects, force clicks, reduce assertion
coverage or extend the probe's test deadline to obtain a passing result.
Reducing probe workers cannot address the retained failure: that run already
used one.

The refreshed workflow preserves main's parallel browser matrix, required
`smoke` aggregate, retry report and verification receipts, plus the independent
repeat job. Repeat-job artifact names include the run attempt and it now writes
its own source/environment receipt. Every job using a browser keeps the exact
same package, lockfile, container digest and runtime-version assertion.

The form probe observes animation-frame callbacks without waiting for them or
changing any actionability assertion. On failure only, it records a bounded
JSON diagnostic with frame counts, label bounds/styles, font/viewport state,
active filter metadata and runner CPU/memory availability. It records no form
values. These observations help distinguish a missing label from a renderer
stall on the next actual Linux run; they are not a rendering workaround.

## November 10 refresh and unresolved acceptance

The refreshed candidate retains original PR head
`4c01c327bf00c0b1f7c99d5e36512b48909471d8` as its first parent and current main
`0373418636440865b5aa417984c9524f5e2710d7` as its second parent. The package and
lockfile start from current main; only `@playwright/test`, `playwright` and
`playwright-core` advance to 1.65.0. Current main's application assets and
dependency updates are retained. The form diagnostics from this draft remain
unchanged, and the full-suite jobs retain `scripts/run-browser-check.mjs` from
main for bounded browser stderr and resource observations.

The November 10 npm registry check still reports stable 1.65.0. The exact
[tagged browser manifest](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/browsers.json)
(blob `fcd39c9ce9b7ac5253b811d9b05ab7c6c5f68e7c`) pins WebKit revision 2388,
browser version 27.2. The refreshed image index is unchanged from the
[November 8 readiness review](https://github.com/pacheco415/Occulert/pull/324).
Its Linux amd64 manifest is
`sha256:bc4fbb329a25287ed23e9216c97063646abdd1bf2da669a9895fa3e2078b2302`.
The earlier observation that the image tag was unavailable no longer applies.

The November 8 review downloaded and verified the complete 111,767,372-byte
amd64 WebKit layer
`sha256:1aea89d9b89dfe8f2337e8810ca1436c81549266c3a1376a8fbcbe5fba010609`.
It inspected the actual `webkit-2388` bundled libraries:

| Library | SHA-256 |
| --- | --- |
| GTK `sys/lib/libsoup-3.0.so.0.7.4` | `81839c7074fc8c105bb130dfc9080e72751e69b4f61ce60e4f17af65066eabe1` |
| WPE `sys/lib/libsoup-3.0.so.0.7.4` | `47ac78474975d417b377a68cbbea58794a90c533f8ec93f6d2c6d96312956bd7` |

Their exported version functions return 3.6.6 in static ELF disassembly. This
retained evidence establishes the bundled version, but does not identify the
library actually loaded by the network process or prove the queue-item
lifetime remedy's machine-code content. Tagged source metadata naming 3.6.5
does not override the inspected bundle. This refresh does not claim a new
layer download or binary inspection.

The rendering gate remains separate. The tagged
[WebKit configuration](https://github.com/microsoft/playwright/blob/v1.65.0/browser_patches/webkit/UPSTREAM_CONFIG.sh)
pins base `5b391e6d3b14d549908dad2c6695999291313f30`. The
[ancestry comparison](https://github.com/WebKit/WebKit/compare/3a41ad1d523ccc432418410723dfe5e60f1f9a63...5b391e6d3b14d549908dad2c6695999291313f30)
places that base 4,576 commits behind the known rendering fix, with zero ahead
and the tagged base as merge base. The complete tagged
[bootstrap patch](https://github.com/microsoft/playwright/blob/v1.65.0/browser_patches/webkit/patches/bootstrap.diff)
(blob `ab31e39a60fcc511607003e8d8a87bdc201287d4`) has no modifications to either
`SkiaCompositingLayer` source file and no `ShouldReuseFilteredBackdrop` or
`filteredBackdrops` identifiers. These source checks do not show the known
remedy included and do not independently certify final browser behavior.

At the November 10 review, the upgrade remained draft under acceptance gates
requiring rendering-remedy evidence, the exact loaded network-process library
mapping/hash and remedy content, and hosted browser results. The November 14
owner decision below supersedes those evidence gates; this historical review
does not claim that either underlying defect has been proved fixed.

The preparation environment has no Docker or Podman. Prior local browser
launch and pinned download attempts were blocked; this refresh does not repeat
those attempts or claim a local engine pass. Portable checks and test collection
can validate the prepared source, but hosted execution remains required.
Historical macOS results do not resolve the Linux-specific acceptance failure.

## November 14 owner acceptance criteria

The owner explicitly waived proof of the loaded network-process library
mapping and source proof of the WebKit rendering fix for this test-only
dependency. Acceptance now depends on the unchanged test results, without a
claim that a particular upstream defect caused or resolved Occulert's failures.
The separate evidence-collector PR #424 remains draft and is not a prerequisite
for evaluating this candidate.

This refresh merges main `04020f81d9a84415291fcb541b82de6c6317fe44` into the
existing runtime-upgrade branch without rebasing or force-pushing. Its diff
against main remains limited to the six runtime-upgrade paths. Application
assets, browser projects, existing assertions, timeouts and retry counts are
unchanged.

Before marking #324 ready for review, collect **three separate hosted Browser
Smoke Tests runs on the same refreshed PR head**. Each run must complete with:

- No terminal failure in either complete browser suite.
- The Linux WebKit form probe passing **7 of 7** cases.
- The independent offline repetition job passing **20 of 20** cases with its
  existing `--retries=0` setting.

Record the exact head, all run IDs and attempts, direct pass counts and every
recovered-after-retry case in the PR beside main's last three browser runs.
Preserve initial failure logs, retry reports and source/environment receipts;
do not describe recovered tests as first-attempt passes. A failed run stays in
the record. Marking the PR ready for review does not authorize its merge.

The refreshed-head results belong in the PR's validation record so collecting
or documenting the three runs does not change the commit being evaluated.
