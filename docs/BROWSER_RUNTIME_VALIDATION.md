# Browser runtime upgrade validation

## Scope and rationale

The coordinated test-only upgrade pins `@playwright/test`, its locked
`playwright` and `playwright-core` packages, the official Noble container, and
its runtime assertion to 1.64.1. It adopts the dependency update proposed in
[Dependabot #273](https://github.com/pacheco415/Occulert/pull/273), but preserves
main's later container, fresh-workspace ownership guards, probe, full suite,
retry policy, diagnostics, and verification artifacts. It does not change the
application or service worker. Do not merge the old dependency-only PR separately
without reconciling the matching runtime pins.

The [upstream issue](https://github.com/microsoft/playwright/issues/42803)
identifies a libsoup 3.6.5 use-after-free in Playwright 1.63.0's Linux WebKit
bundle. A [maintainer confirms the fix is included in 1.64](https://github.com/microsoft/playwright/issues/42803#issuecomment-5837772701).
Occulert's retained offline-startup evidence shows valid cache/registration
before navigation and their disappearance afterward. This is consistent with
network-process loss, but it does not prove that this upstream defect caused
Occulert's failures. A newer bundled browser is a candidate remediation, not a
confirmed application fix.

The official registry returned the 1.64.1 Noble multi-platform manifest digest
`sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea`
on October 26, 2026. Never substitute an unverified tag-only image.

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

As checked October 28, the [latest official stable release](https://github.com/microsoft/playwright/releases/tag/v1.64.1)
is still 1.64.1. Do not substitute an alpha, disable rendering effects, force
clicks, reduce assertion coverage or extend the probe's test deadline to obtain
a passing result. Reducing probe workers cannot address the retained failure:
that run already used one.

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

**The upgrade remains not ready for merge** until the unchanged Linux form
probe, complete browser matrix and offline repetitions pass on the refreshed
PR head. A local macOS pass cannot resolve a Linux-specific acceptance failure.
