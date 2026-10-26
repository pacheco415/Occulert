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
