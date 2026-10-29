# Remote branch inventory

Observed: 2026-10-29T00:08:58.772Z. Base: `09930515b86cb62fe232e044822a07378cea45ed` (fetched origin/main).

Remote branches other than main: **145**. Commented review proposals: **8**.

Open PR snapshot: 2026-10-29T00:08:54.788Z; 16 open PRs, complete pagination. See [snapshot](open-pull-requests.json).

`merged ancestry` means every branch commit is reachable from captured main, even if main later edited its files. `matching change snapshot` means the branch's net changed paths equal main (including modes and deletions); unique history may remain, so it gets no deletion proposal. `not proven` includes divergent files, ambiguous ancestry and Git errors.

Every same-repository open-PR branch is protected regardless of containment. These observations are not live deletion approval. Refetch, refresh the complete open-PR snapshot and review again before any manual deletion. A head lease detects branch movement but cannot detect a newly opened PR.

The generator reads fetched refs and never fetches or deletes branches. The companion [proposal](proposed-branch-deletions.sh) contains only comments and performs no actions if run.

Regenerate after `git fetch --prune origin` using Node 24:

```sh
node scripts/list-stale-branches.mjs --github --output=docs/branch-inventory
# Without GitHub CLI: supply a fresh complete connector snapshot explicitly.
node scripts/list-stale-branches.mjs --github --github-snapshot=docs/branch-inventory/open-pull-requests.json --output=docs/branch-inventory
```

| Branch | Captured head | Last commit | Containment evidence | Open PRs | Review proposal |
| --- | --- | --- | --- | --- | --- |
| agent/account-role-authority-20260824 | [7a399f61ffd7](https://github.com/pacheco415/Occulert/commit/7a399f61ffd7a66b20ce24e0a43743c4293d6c3e) | 2026-08-24T20:15:09-07:00 | not proven | none | keep / inspect |
| agent/auth-confirmation-resend-20260816 | [1726c4e4f75c](https://github.com/pacheco415/Occulert/commit/1726c4e4f75c487d66a9fbf2b41788ad5c6bb383) | 2026-08-24T08:21:38-07:00 | not proven | none | keep / inspect |
| agent/build30-improvements-20260824 | [2b920d5cca04](https://github.com/pacheco415/Occulert/commit/2b920d5cca04c478ceaa1e8e2355bb59a6cb26c5) | 2026-08-24T18:00:00-07:00 | not proven | none | keep / inspect |
| agent/cloud-sync-recovery-20260815 | [80a744d9cf05](https://github.com/pacheco415/Occulert/commit/80a744d9cf0564e6aa4cf37c42a651758d9a2e97) | 2026-08-15T10:19:27-07:00 | not proven | none | keep / inspect |
| agent/display-installed-build-20260815 | [40e7bad64b21](https://github.com/pacheco415/Occulert/commit/40e7bad64b2119c94d8775555c7e2d8357381042) | 2026-08-15T09:05:11-07:00 | not proven | none | keep / inspect |
| agent/eas-npm10-lockfile | [aa3204a2dfba](https://github.com/pacheco415/Occulert/commit/aa3204a2dfbaacf3404bf430c1aa0c98df2750b4) | 2026-08-10T23:38:53-07:00 | not proven | none | keep / inspect |
| agent/eas-npm10-lockfile-repair-20260815 | [4f5fe63605db](https://github.com/pacheco415/Occulert/commit/4f5fe63605dbcc758d237835067c402ae14069ed) | 2026-08-15T08:08:19-07:00 | not proven | none | keep / inspect |
| agent/fleet-dashboard-data-states-20260815 | [a3b93995e4e6](https://github.com/pacheco415/Occulert/commit/a3b93995e4e6177423d9f27ac1ace373518c7f97) | 2026-08-15T10:50:24-07:00 | not proven | none | keep / inspect |
| agent/fleet-dashboard-performance-20260824 | [ba2338f57385](https://github.com/pacheco415/Occulert/commit/ba2338f573859c19652d28dc38d8c9b9a000e633) | 2026-08-24T22:18:59-07:00 | not proven | none | keep / inspect |
| agent/fleet-gps-copy-20260815 | [124fa0c8cc6d](https://github.com/pacheco415/Occulert/commit/124fa0c8cc6de9fa99943ecfc83c25cdb2588cec) | 2026-08-24T15:52:41-07:00 | not proven | none | keep / inspect |
| agent/fleet-journey-cleanup-20260824 | [c664816b231a](https://github.com/pacheco415/Occulert/commit/c664816b231a2f6303c473152a492bdc0fee33ad) | 2026-08-24T21:21:33-07:00 | not proven | none | keep / inspect |
| agent/fleet-web-simplification-20260824 | [efd788a2812c](https://github.com/pacheco415/Occulert/commit/efd788a2812c4d20b7eb67c6257e3a907d6be3d7) | 2026-08-24T19:39:13-07:00 | not proven | none | keep / inspect |
| agent/history-edit-race-20260815 | [f236b7ae8031](https://github.com/pacheco415/Occulert/commit/f236b7ae8031fe4ec76856ae70a8f63ee14a194d) | 2026-08-15T10:28:38-07:00 | not proven | none | keep / inspect |
| agent/homepage-3d-journey-nav-repair-20260815 | [32ae96ae02c3](https://github.com/pacheco415/Occulert/commit/32ae96ae02c3d4acb0c702ddb993b10da13abdbf) | 2026-08-15T19:59:17-07:00 | not proven | none | keep / inspect |
| agent/homepage-journey-recovery-20260815 | [f1b859a920c2](https://github.com/pacheco415/Occulert/commit/f1b859a920c2d1e326f8926e57048ef7627206e3) | 2026-08-15T17:29:23-07:00 | not proven | none | keep / inspect |
| agent/login-recovery-20260815 | [3bdc460bad7e](https://github.com/pacheco415/Occulert/commit/3bdc460bad7e798b00c3643906f7f360dce0e080) | 2026-08-15T11:13:11-07:00 | not proven | none | keep / inspect |
| agent/manager-role-display-repair-20260816 | [05e9daee7005](https://github.com/pacheco415/Occulert/commit/05e9daee7005b68ca9a3f4bedc051974275a69b7) | 2026-08-16T15:47:13-07:00 | not proven | none | keep / inspect |
| agent/native-alert-brand-refresh | [ae27bbfecb4c](https://github.com/pacheco415/Occulert/commit/ae27bbfecb4c89ed99ce333cc5ce4f56da0a59ef) | 2026-08-08T11:13:32-07:00 | not proven | none | keep / inspect |
| agent/navigation-auth-state-repair-20260816 | [acf82d28510d](https://github.com/pacheco415/Occulert/commit/acf82d28510d92ea0a77359b796c4d03b67cc788) | 2026-08-16T14:58:48-07:00 | not proven | none | keep / inspect |
| agent/passkey-auth-20260815 | [7c8f6b12ed73](https://github.com/pacheco415/Occulert/commit/7c8f6b12ed730f7b7ac972487082022f881703f3) | 2026-08-15T13:16:07-07:00 | not proven | none | keep / inspect |
| agent/passkey-mobile-repair-20260815 | [f88c1f259407](https://github.com/pacheco415/Occulert/commit/f88c1f259407b6763d87c938552257729d10ef80) | 2026-08-15T13:51:50-07:00 | not proven | none | keep / inspect |
| agent/production-stylesheet-cache-repair-20260815 | [b49af561e5a5](https://github.com/pacheco415/Occulert/commit/b49af561e5a5636577d97efcf8be07491811b9b7) | 2026-08-15T18:20:12-07:00 | not proven | none | keep / inspect |
| agent/race-safe-watch-preference-20260815 | [b9cef90780a5](https://github.com/pacheco415/Occulert/commit/b9cef90780a57f16ecdfb226ad401ca2372b2932) | 2026-08-15T09:47:26-07:00 | not proven | none | keep / inspect |
| agent/reliability-improvements-20260815 | [240f751458d2](https://github.com/pacheco415/Occulert/commit/240f751458d2ace0cfb98acb4bcdb7d7b1a1efbb) | 2026-08-15T07:58:35-07:00 | not proven | none | keep / inspect |
| agent/replace-unsourced-homepage-stats | [0cb649907e7a](https://github.com/pacheco415/Occulert/commit/0cb649907e7a88c7c75ef412f1a3bc753f8646c8) | 2026-08-09T15:13:07-07:00 | not proven | none | keep / inspect |
| agent/safari-passkey-loader-repair-20260815 | [8cbcb9ea1665](https://github.com/pacheco415/Occulert/commit/8cbcb9ea1665393bde709330099dc3440a524318) | 2026-08-15T14:30:54-07:00 | not proven | none | keep / inspect |
| agent/safe-stop-finder | [5b3995cb9a18](https://github.com/pacheco415/Occulert/commit/5b3995cb9a1853fcfbd3f0c1e646f53e0d61dd7a) | 2026-08-10T18:39:28-07:00 | not proven | none | keep / inspect |
| agent/sensitivity-persistence-20260815 | [55c3cc9050fa](https://github.com/pacheco415/Occulert/commit/55c3cc9050faf7a53bbd2db55c8422e694194d72) | 2026-08-15T10:09:14-07:00 | not proven | none | keep / inspect |
| agent/settings-persistence-20260815 | [9ce5c35339ae](https://github.com/pacheco415/Occulert/commit/9ce5c35339aeb39fca5f7d21ce972f7c17192cc7) | 2026-08-15T09:58:17-07:00 | not proven | none | keep / inspect |
| agent/site-liquid-glass-20260815 | [cc1eb71181c5](https://github.com/pacheco415/Occulert/commit/cc1eb71181c51ac43b84ff14b48d14f88a1e1b7b) | 2026-08-15T12:53:58-07:00 | not proven | none | keep / inspect |
| audit/github-bug-fixes | [f50559ccfc54](https://github.com/pacheco415/Occulert/commit/f50559ccfc54600a1bc0c57af444749152952a77) | 2026-09-26T11:44:14-07:00 | not proven | none | keep / inspect |
| codex/account-deletion-release-20260912 | [acc7a8cd9fbd](https://github.com/pacheco415/Occulert/commit/acc7a8cd9fbd00738a8b3e46fda416e58b7e90c4) | 2026-09-12T10:08:09-07:00 | not proven | none | keep / inspect |
| codex/agent-development-rules | [590579131f0c](https://github.com/pacheco415/Occulert/commit/590579131f0c23cd74d239bad43da1cb26d28cfd) | 2026-10-03T12:11:17-07:00 | not proven | none | keep / inspect |
| codex/android-camera-minimum | [49f0c1c8b78f](https://github.com/pacheco415/Occulert/commit/49f0c1c8b78f2f6a6706bdb607277aaaeedfa824) | 2026-10-03T13:25:52-07:00 | not proven | none | keep / inspect |
| codex/android-watch-linking | [1b5272e61114](https://github.com/pacheco415/Occulert/commit/1b5272e61114f626adbd7dfe1bb9df82c19c53be) | 2026-10-03T12:34:18-07:00 | not proven | none | keep / inspect |
| codex/api-comment-refresh | [3f66dd0a471c](https://github.com/pacheco415/Occulert/commit/3f66dd0a471cefccf9118d37669c9eea8a169f70) | 2026-10-25T10:17:32-07:00 | not proven | [#312](https://github.com/pacheco415/Occulert/pull/312) | keep: open PR |
| codex/approved-upgrades-2026-09-27 | [3f5bc5895645](https://github.com/pacheco415/Occulert/commit/3f5bc589564540ed890552f81063531215ac017f) | 2026-09-29T19:52:23-07:00 | merged ancestry | none | review merged branch |
| codex/atomic-event-quotas | [0ac0ab771acc](https://github.com/pacheco415/Occulert/commit/0ac0ab771acc25265acf5eadf4177f33b7bfcb5a) | 2026-10-03T12:27:35-07:00 | not proven | [#192](https://github.com/pacheco415/Occulert/pull/192) | keep: open PR |
| codex/automate-asset-releases | [d23ee9288593](https://github.com/pacheco415/Occulert/commit/d23ee9288593b049e36575feb7556715a5c0c17e) | 2026-10-03T12:03:21-07:00 | not proven | none | keep / inspect |
| codex/billing-customer-idempotency | [87820dd8aebf](https://github.com/pacheco415/Occulert/commit/87820dd8aebfe127044d5dadb937c49819fe6cad) | 2026-09-29T21:04:14-07:00 | merged ancestry | none | review merged branch |
| codex/billing-webhook-permanent-errors | [74c429561e0d](https://github.com/pacheco415/Occulert/commit/74c429561e0d6ef08166f101a0c2e178548675eb) | 2026-09-29T20:56:12-07:00 | merged ancestry | none | review merged branch |
| codex/bounded-fatigue-summary | [64c30a764625](https://github.com/pacheco415/Occulert/commit/64c30a7646255939e4d0dec60c69b86b34221bf8) | 2026-10-03T11:32:58-07:00 | not proven | none | keep / inspect |
| codex/bounded-pinned-ci | [40b113711fdb](https://github.com/pacheco415/Occulert/commit/40b113711fdb6bb630723070994718eb0f30edf4) | 2026-10-03T09:38:48-07:00 | not proven | none | keep / inspect |
| codex/browser-summary-values | [f480d891af45](https://github.com/pacheco415/Occulert/commit/f480d891af4519074c3a34eb65361db8c23e2aeb) | 2026-10-03T15:06:55-07:00 | not proven | none | keep / inspect |
| codex/build-30-performance-20260830 | [9ac85d1a7530](https://github.com/pacheco415/Occulert/commit/9ac85d1a7530bd2ac492a23d435033b7b37b9519) | 2026-08-30T15:26:06-07:00 | not proven | none | keep / inspect |
| codex/build-output-plan | [d176cf130bd8](https://github.com/pacheco415/Occulert/commit/d176cf130bd8088e409fe2f1441b9bed0d7d6699) | 2026-10-28T16:56:03-07:00 | not proven | [#330](https://github.com/pacheco415/Occulert/pull/330) | keep: open PR |
| codex/complete-ci-skip-guard | [bae5efa30615](https://github.com/pacheco415/Occulert/commit/bae5efa30615901a212fc3ee4ca47b8c3a22b111) | 2026-10-03T12:55:44-07:00 | not proven | none | keep / inspect |
| codex/controlled-startup-evidence | [a9c92b421795](https://github.com/pacheco415/Occulert/commit/a9c92b421795c17378fd68d9780191b86f00fdbc) | 2026-10-03T16:20:34-07:00 | not proven | none | keep / inspect |
| codex/current-development-docs | [f7451a75a998](https://github.com/pacheco415/Occulert/commit/f7451a75a9982da54539b896e4140bb034c48c5f) | 2026-10-03T13:57:57-07:00 | not proven | none | keep / inspect |
| codex/current-source-race-tests | [07e9577d8efb](https://github.com/pacheco415/Occulert/commit/07e9577d8efb4f75780a2540116d51903d02f400) | 2026-09-29T21:17:20-07:00 | merged ancestry | none | review merged branch |
| codex/dependency-audit-reports | [977114d76e9d](https://github.com/pacheco415/Occulert/commit/977114d76e9ddd66c0cc6272c107a259e94ebd6f) | 2026-10-03T15:48:16-07:00 | not proven | none | keep / inspect |
| codex/dependency-monitoring | [4dc033df3fad](https://github.com/pacheco415/Occulert/commit/4dc033df3fadb7d153f4d5f500e2d6af3b10e3fa) | 2026-10-03T12:24:36-07:00 | not proven | none | keep / inspect |
| codex/durable-native-session-summary | [97b5ad99d1dd](https://github.com/pacheco415/Occulert/commit/97b5ad99d1dd3272ce169b38a3831a2800edac6a) | 2026-10-03T11:49:32-07:00 | not proven | none | keep / inspect |
| codex/durable-web-session-summary | [7c04f235294b](https://github.com/pacheco415/Occulert/commit/7c04f235294b83c3998560e8b7a12718d444eb03) | 2026-10-03T12:16:49-07:00 | not proven | none | keep / inspect |
| codex/dynamic-asset-tests-20260929 | [2e100a27ac15](https://github.com/pacheco415/Occulert/commit/2e100a27ac15f575abbfb314a8bb07cc0789ca3c) | 2026-09-29T20:40:00-07:00 | merged ancestry | none | review merged branch |
| codex/elapsed-fatigue-experiment | [3c4b148e2f32](https://github.com/pacheco415/Occulert/commit/3c4b148e2f324106b8c79f35a336954a670a9ca3) | 2026-10-03T13:07:01-07:00 | not proven | none | keep / inspect |
| codex/event-occurred-at | [7c2029a7970f](https://github.com/pacheco415/Occulert/commit/7c2029a7970f3c7a21bb6429fb5144b335ac4079) | 2026-10-25T11:31:37-07:00 | not proven | [#315](https://github.com/pacheco415/Occulert/pull/315) | keep: open PR |
| codex/exclude-development-files | [70263555de1f](https://github.com/pacheco415/Occulert/commit/70263555de1f7ddb608a9f143216c929e49b8b80) | 2026-10-03T09:15:25-07:00 | not proven | none | keep / inspect |
| codex/extract-driver-app-script-20260829 | [e6ed4b65d29e](https://github.com/pacheco415/Occulert/commit/e6ed4b65d29ef943251c49de86f815c91b7d4518) | 2026-08-29T10:51:43-07:00 | not proven | none | keep / inspect |
| codex/fix-watch-transfer-crash-20260901 | [6d156099d3e5](https://github.com/pacheco415/Occulert/commit/6d156099d3e5649ca23f484bf033c0b56b0cc022) | 2026-09-01T21:31:29-07:00 | not proven | none | keep / inspect |
| codex/fleet-dashboard-commercial-value-20260828 | [beeeda78413b](https://github.com/pacheco415/Occulert/commit/beeeda78413ba6eef0cc4df307002f8a07c904ee) | 2026-08-28T20:57:09-07:00 | not proven | none | keep / inspect |
| codex/fleet-offboarding | [95c0acd36e8c](https://github.com/pacheco415/Occulert/commit/95c0acd36e8c2b11856e9dc5ff28c4f32403cfbf) | 2026-10-03T12:34:46-07:00 | not proven | [#206](https://github.com/pacheco415/Occulert/pull/206) | keep: open PR |
| codex/full-bug-fix-20260830 | [3b56c85cf67e](https://github.com/pacheco415/Occulert/commit/3b56c85cf67ec118b2374ad74142851f0b179264) | 2026-08-30T09:46:59-07:00 | not proven | none | keep / inspect |
| codex/full-migration-replay | [343f07800b89](https://github.com/pacheco415/Occulert/commit/343f07800b89836b304c0baa35a486bf5ebeec8d) | 2026-10-03T14:23:52-07:00 | not proven | none | keep / inspect |
| codex/history-record-identity | [a48f44c627ab](https://github.com/pacheco415/Occulert/commit/a48f44c627abc20e3cf823856e6fb29de76bc9df) | 2026-10-03T11:39:13-07:00 | not proven | none | keep / inspect |
| codex/immutable-site-assets | [32bc010822e8](https://github.com/pacheco415/Occulert/commit/32bc010822e83ff2ba667fd7937932e21fa7f3d2) | 2026-09-14T17:13:50-07:00 | not proven | none | keep / inspect |
| codex/isolate-browser-server | [f5b0dc17981b](https://github.com/pacheco415/Occulert/commit/f5b0dc17981b6bedeeb204247aae664b8a52bf14) | 2026-10-03T13:33:44-07:00 | matching change snapshot | none | keep / inspect |
| codex/isolated-release-fixtures | [042536d48eb2](https://github.com/pacheco415/Occulert/commit/042536d48eb28bd1fc73df3d31580342c6f5f3a4) | 2026-10-03T12:44:48-07:00 | not proven | none | keep / inspect |
| codex/migration-readiness-report | [84e0342b217f](https://github.com/pacheco415/Occulert/commit/84e0342b217f51bdf29b292c977662b5dd22e02f) | 2026-10-03T15:55:42-07:00 | not proven | none | keep / inspect |
| codex/monitor-runtime-performance-20260828 | [c6b91b576576](https://github.com/pacheco415/Occulert/commit/c6b91b576576813f84aa1f233a64f9c8fe1e4ddb) | 2026-08-28T19:44:57-07:00 | not proven | none | keep / inspect |
| codex/native-parked-baseline | [746df43e52ae](https://github.com/pacheco415/Occulert/commit/746df43e52aeb7c373d9e6556deb37a047a00adb) | 2026-10-03T14:05:46-07:00 | not proven | none | keep / inspect |
| codex/native-session-completion | [912663e1d08a](https://github.com/pacheco415/Occulert/commit/912663e1d08a13a1ff7a3b9b56dfb736a1c56075) | 2026-10-03T15:06:18-07:00 | not proven | none | keep / inspect |
| codex/native-setup-reliability-upgrade-20260901 | [6f7995e18a6f](https://github.com/pacheco415/Occulert/commit/6f7995e18a6fbb825d6284a9855a5715db3f738f) | 2026-09-01T16:08:55-07:00 | not proven | none | keep / inspect |
| codex/passkey-profile-signup | [7e1557f17d63](https://github.com/pacheco415/Occulert/commit/7e1557f17d63155e0be1306c19a1a8ba66da5aa8) | 2026-09-14T22:03:11-07:00 | not proven | none | keep / inspect |
| codex/performance-upgrades-20260829 | [096762bef6ab](https://github.com/pacheco415/Occulert/commit/096762bef6ab1737afdb2e40f6d7fbafd2bac36c) | 2026-08-30T15:09:32-07:00 | not proven | none | keep / inspect |
| codex/pixel-ear-experiment | [c5ae3d254047](https://github.com/pacheco415/Occulert/commit/c5ae3d2540471c0640e40188b13f65abb95d2c62) | 2026-10-03T13:19:28-07:00 | not proven | none | keep / inspect |
| codex/playwright-runtime-upgrade | [1a14deee56bf](https://github.com/pacheco415/Occulert/commit/1a14deee56bf07a9eb833fcf4b1221ec9401f24d) | 2026-10-26T13:28:36-07:00 | not proven | [#324](https://github.com/pacheco415/Occulert/pull/324) | keep: open PR |
| codex/preserve-driver-profile | [9fbfd34f018f](https://github.com/pacheco415/Occulert/commit/9fbfd34f018f1a8ab0984f54df81660662090c6a) | 2026-10-03T09:21:55-07:00 | not proven | none | keep / inspect |
| codex/private-static-files | [73cf51737b6a](https://github.com/pacheco415/Occulert/commit/73cf51737b6a28111786c45a15885330c161d753) | 2026-10-03T13:04:57-07:00 | matching change snapshot | none | keep / inspect |
| codex/release-process-guide | [5dd7a3942274](https://github.com/pacheco415/Occulert/commit/5dd7a39422745f563726a0852e2dc39a5c2d0aca) | 2026-09-29T21:25:22-07:00 | merged ancestry | none | review merged branch |
| codex/reliable-sync-reporting-20260912 | [81e9f5ef2e63](https://github.com/pacheco415/Occulert/commit/81e9f5ef2e6345b9e74f2b9e947b0de58320306a) | 2026-09-13T23:48:13-07:00 | not proven | none | keep / inspect |
| codex/remove-obsolete-xss-header | [5d1902fec21d](https://github.com/pacheco415/Occulert/commit/5d1902fec21d8dabc7614c342db5b6e654682c91) | 2026-10-03T13:29:30-07:00 | not proven | none | keep / inspect |
| codex/reserve-asset-history | [4db2aad17952](https://github.com/pacheco415/Occulert/commit/4db2aad17952e32514b2c8a4ad4401537fd83783) | 2026-10-03T13:40:51-07:00 | not proven | none | keep / inspect |
| codex/retire-assets-2026-10-10 | [fe047bebf503](https://github.com/pacheco415/Occulert/commit/fe047bebf503fea12d6bd430cd71353ef1c847e8) | 2026-10-10T14:08:29-07:00 | not proven | [#267](https://github.com/pacheco415/Occulert/pull/267) | keep: open PR |
| codex/retire-stale-assets-2026-09-29 | [d3063c1ce87a](https://github.com/pacheco415/Occulert/commit/d3063c1ce87af1aa022c5a5c823def3199f7bc64) | 2026-09-29T20:48:22-07:00 | merged ancestry | none | review merged branch |
| codex/review-and-bug-templates | [cc89cf5703fd](https://github.com/pacheco415/Occulert/commit/cc89cf5703fd7a349f192a085a764695e0e962ac) | 2026-10-03T15:34:45-07:00 | matching change snapshot | none | keep / inspect |
| codex/safety-alert-improvements-20260901 | [6ecdf875c4e1](https://github.com/pacheco415/Occulert/commit/6ecdf875c4e10ff80318c6b476e14ad7856f20c4) | 2026-09-01T19:15:40-07:00 | not proven | none | keep / inspect |
| codex/security-reporting-guidance | [ff97a110d24b](https://github.com/pacheco415/Occulert/commit/ff97a110d24bbdb1c9669aef78d8df172d36fc9e) | 2026-10-03T14:32:09-07:00 | matching change snapshot | none | keep / inspect |
| codex/self-host-mediapipe | [a5849d6203a8](https://github.com/pacheco415/Occulert/commit/a5849d6203a882a311bf652191b08828a1121879) | 2026-09-14T17:34:33-07:00 | not proven | none | keep / inspect |
| codex/session-cloud-outcomes | [c1c86f91ac19](https://github.com/pacheco415/Occulert/commit/c1c86f91ac19d1a9fdbe7ef6307beaf340705db1) | 2026-10-03T15:15:05-07:00 | not proven | none | keep / inspect |
| codex/session-finalization-integrity | [db95f12441b8](https://github.com/pacheco415/Occulert/commit/db95f12441b8051848f25ae0aa20c92b38b49fd4) | 2026-10-03T09:28:34-07:00 | not proven | none | keep / inspect |
| codex/stable-local-session-ids | [18b47f217d4c](https://github.com/pacheco415/Occulert/commit/18b47f217d4ca94a8d7a99d89605127deb430bfa) | 2026-10-03T13:50:20-07:00 | not proven | none | keep / inspect |
| codex/stale-branch-inventory | [9945eb231d04](https://github.com/pacheco415/Occulert/commit/9945eb231d04c8a6ec92ae3320e23041c60bea46) | 2026-10-03T14:15:25-07:00 | matching change snapshot | none | keep / inspect |
| codex/static-asset-size-budgets | [aeef38671bdf](https://github.com/pacheco415/Occulert/commit/aeef38671bdfa0e684aeddaaeb87e3eae6b0e180) | 2026-10-03T15:41:25-07:00 | not proven | none | keep / inspect |
| codex/sw-exact-origin | [6ac31a19d35e](https://github.com/pacheco415/Occulert/commit/6ac31a19d35e7e305bc6be35d1ad454a0adfd1d5) | 2026-10-25T10:24:15-07:00 | not proven | [#313](https://github.com/pacheco415/Occulert/pull/313) | keep: open PR |
| codex/sw-same-origin-cache | [fb426f4dc392](https://github.com/pacheco415/Occulert/commit/fb426f4dc392ed9263c30f0145cd6abca3b7c49e) | 2026-10-25T10:21:39-07:00 | not proven | [#314](https://github.com/pacheco415/Occulert/pull/314) | keep: open PR |
| codex/tasks-vision-comparison | [4c71a7329da4](https://github.com/pacheco415/Occulert/commit/4c71a7329da42174e631d93909814c47c786c0ac) | 2026-10-03T13:54:42-07:00 | not proven | none | keep / inspect |
| codex/truthful-native-summaries | [e5bd74b25a26](https://github.com/pacheco415/Occulert/commit/e5bd74b25a26e5e1912018c47be6a0e02e80cbe7) | 2026-10-03T14:45:51-07:00 | not proven | none | keep / inspect |
| codex/unobserved-native-telemetry | [4dd6b6d9746d](https://github.com/pacheco415/Occulert/commit/4dd6b6d9746da6fcbb9addfed3b4bbd11d7b0b52) | 2026-10-03T16:04:19-07:00 | not proven | none | keep / inspect |
| codex/unskippable-ci-2026-09-29 | [d73ddaae81ef](https://github.com/pacheco415/Occulert/commit/d73ddaae81efb283ee88688b58b06bafafe537bf) | 2026-09-29T20:32:46-07:00 | merged ancestry | none | review merged branch |
| codex/validate-session-event-input | [42efc3d3356e](https://github.com/pacheco415/Occulert/commit/42efc3d3356ea2a11b5ac2230b44fb398a13beec) | 2026-10-03T11:56:20-07:00 | not proven | none | keep / inspect |
| codex/validate-session-recovery | [439b512542de](https://github.com/pacheco415/Occulert/commit/439b512542de81777e72cab57efcef036cd7e199) | 2026-10-03T09:46:40-07:00 | not proven | none | keep / inspect |
| codex/verification-evidence-timeouts | [9e126e9cd706](https://github.com/pacheco415/Occulert/commit/9e126e9cd7068f33fe7f131021092296696c04bd) | 2026-10-03T15:27:38-07:00 | matching change snapshot | none | keep / inspect |
| codex/verification-receipts | [0043f21e329a](https://github.com/pacheco415/Occulert/commit/0043f21e329aac50dddd5904417303fd28605712) | 2026-10-03T13:19:59-07:00 | not proven | none | keep / inspect |
| codex/verified-native-cloud-ack | [0afa2f912cb2](https://github.com/pacheco415/Occulert/commit/0afa2f912cb21a95d0ccf382ebf2ea362bd7c5a2) | 2026-10-03T16:12:31-07:00 | not proven | none | keep / inspect |
| codex/version-browser-history | [e8f6940743c0](https://github.com/pacheco415/Occulert/commit/e8f6940743c03423a46062d27b889070cc7cc970) | 2026-10-03T14:41:10-07:00 | not proven | none | keep / inspect |
| codex/version-native-history | [59540e61cabd](https://github.com/pacheco415/Occulert/commit/59540e61cabdf9ce803a9efc23e623e0745b8278) | 2026-10-03T14:38:13-07:00 | not proven | none | keep / inspect |
| codex/watch-alert-ios-fleet-20260825 | [70bd960054d8](https://github.com/pacheco415/Occulert/commit/70bd960054d846ce2ad4491600d3a6a7d7ce70b0) | 2026-08-25T19:22:53-07:00 | not proven | none | keep / inspect |
| codex/web-detector-release-20260914 | [e335eb40f909](https://github.com/pacheco415/Occulert/commit/e335eb40f90945f6630881ecb54de669358dec18) | 2026-09-14T16:15:32-07:00 | not proven | none | keep / inspect |
| codex/web-fleet-affordability-20260830 | [829b3665df05](https://github.com/pacheco415/Occulert/commit/829b3665df05511caabf96f6c77b59d40320aaf4) | 2026-08-30T12:14:44-07:00 | not proven | none | keep / inspect |
| dependabot/github_actions/actions/github-script-9.0.0 | [a1a54babd8ef](https://github.com/pacheco415/Occulert/commit/a1a54babd8efa86cd3bb11f5b34fb5380a8a817b) | 2026-10-03T23:50:36-07:00 | matching change snapshot | none | keep / inspect |
| dependabot/github_actions/weekly-actions-dc4f8b6e13 | [6a1f5648f95a](https://github.com/pacheco415/Occulert/commit/6a1f5648f95a8c69a2eb391cc94a25949d46b9ea) | 2026-10-27T00:56:19Z | not proven | [#276](https://github.com/pacheco415/Occulert/pull/276) | keep: open PR |
| dependabot/npm_and_yarn/acorn-8.19.0 | [075a614361c4](https://github.com/pacheco415/Occulert/commit/075a614361c4a87487d9d7dea03209aa22de7942) | 2026-10-26T16:24:35Z | not proven | [#262](https://github.com/pacheco415/Occulert/pull/262) | keep: open PR |
| dependabot/npm_and_yarn/axe-core/playwright-4.14.0 | [f41ad0a7524b](https://github.com/pacheco415/Occulert/commit/f41ad0a7524b3d7771f11bc9314db36a78d11cd0) | 2026-10-26T16:24:38Z | not proven | [#299](https://github.com/pacheco415/Occulert/pull/299) | keep: open PR |
| dependabot/npm_and_yarn/electric-sql/pglite-0.5.11 | [677369d2b68c](https://github.com/pacheco415/Occulert/commit/677369d2b68ccec30523c035e1faf29365580b00) | 2026-10-26T16:24:44Z | not proven | [#298](https://github.com/pacheco415/Occulert/pull/298) | keep: open PR |
| dependabot/npm_and_yarn/native-app/react-test-renderer-19.3.1 | [714afd7da915](https://github.com/pacheco415/Occulert/commit/714afd7da915b02eeee7e01ad97ebff3008d639c) | 2026-10-27T20:21:11Z | not proven | [#297](https://github.com/pacheco415/Occulert/pull/297) | keep: open PR |
| dependabot/npm_and_yarn/playwright/test-1.64.1 | [a0ae7b170484](https://github.com/pacheco415/Occulert/commit/a0ae7b17048465ea265e5c8e09650afa85579eed) | 2026-10-26T16:24:44Z | not proven | [#273](https://github.com/pacheco415/Occulert/pull/273) | keep: open PR |
| dependabot/npm_and_yarn/typescript-7.0.2 | [32be6310b6d0](https://github.com/pacheco415/Occulert/commit/32be6310b6d04e28d66d44e17dd1780599aaf77d) | 2026-10-26T16:24:40Z | not proven | [#263](https://github.com/pacheco415/Occulert/pull/263) | keep: open PR |
| development-readiness-2026-10-03 | [1dd2a2b403d5](https://github.com/pacheco415/Occulert/commit/1dd2a2b403d58e26148d8e0a0e972975ec7aa19d) | 2026-10-03T08:39:08-07:00 | not proven | none | keep / inspect |
| development/fleet-history-export | [40ecf21dc016](https://github.com/pacheco415/Occulert/commit/40ecf21dc016c1474110564d96836c0f4ef7104b) | 2026-09-26T19:38:18-07:00 | not proven | none | keep / inspect |
| development/fleet-history-filters | [2f7891d36762](https://github.com/pacheco415/Occulert/commit/2f7891d367628c498a778689ff33a43f2bc16076) | 2026-09-26T19:31:20-07:00 | not proven | none | keep / inspect |
| development/history-alert-feedback | [432f1c7940d6](https://github.com/pacheco415/Occulert/commit/432f1c7940d6e7511861ee8d79d9acb7dc9864b2) | 2026-09-26T19:49:39-07:00 | not proven | none | keep / inspect |
| development/history-summary-values | [570933cfd683](https://github.com/pacheco415/Occulert/commit/570933cfd683868cc54597d8fbb642867d643799) | 2026-09-26T20:02:18-07:00 | not proven | none | keep / inspect |
| development/independent-feature-work | [0e2876315d4f](https://github.com/pacheco415/Occulert/commit/0e2876315d4f77fed6efac0c4a194aa525801667) | 2026-09-26T19:19:54-07:00 | not proven | none | keep / inspect |
| development/native-release-readiness | [f16730b985b2](https://github.com/pacheco415/Occulert/commit/f16730b985b2cc1eedea4b1fed00297fc658476f) | 2026-09-26T13:19:02-07:00 | not proven | none | keep / inspect |
| development/pilot-readiness | [d647586fe84e](https://github.com/pacheco415/Occulert/commit/d647586fe84ea31af9a5289d4963289c64dc01d7) | 2026-09-26T14:31:37-07:00 | not proven | none | keep / inspect |
| development/support-and-release-preparation | [753dea7bdedc](https://github.com/pacheco415/Occulert/commit/753dea7bdedc9c356bb2b5d072bbab0419668528) | 2026-09-26T19:25:11-07:00 | not proven | none | keep / inspect |
| feat/driver-startup-recovery | [030391b02ff7](https://github.com/pacheco415/Occulert/commit/030391b02ff73402360e5f35695f4897e12562c3) | 2026-09-26T10:47:38-07:00 | not proven | none | keep / inspect |
| feat/fleet-follow-up-outcomes | [61e7c4a15da1](https://github.com/pacheco415/Occulert/commit/61e7c4a15da1221eb3a92e170ef0b48d9a8b25de) | 2026-09-20T21:15:06-07:00 | not proven | none | keep / inspect |
| feat/fleet-query-indexes | [a4ff3d19233f](https://github.com/pacheco415/Occulert/commit/a4ff3d19233f8f1ffb1dc551fc27688c1cb0f0a8) | 2026-09-20T21:25:50-07:00 | not proven | none | keep / inspect |
| feat/fleet-refresh-recovery | [d3af4085eb13](https://github.com/pacheco415/Occulert/commit/d3af4085eb13ac58ab0bd2ed3e5c0d5cd704bc95) | 2026-09-26T09:30:40-07:00 | not proven | none | keep / inspect |
| feat/fusion-validation-session-planner | [42b8f341d29c](https://github.com/pacheco415/Occulert/commit/42b8f341d29c412c1a7ea97ac5e060e83043376f) | 2026-09-24T21:58:55-07:00 | not proven | none | keep / inspect |
| feat/local-fusion-validation-dashboard | [3fd6562dd753](https://github.com/pacheco415/Occulert/commit/3fd6562dd753df7f24e4f0914b06fedd2b5c8fea) | 2026-09-24T21:48:03-07:00 | not proven | none | keep / inspect |
| feat/native-validation-lockfile | [9cc2656bc0b2](https://github.com/pacheco415/Occulert/commit/9cc2656bc0b2736ebf22bcb8a467f3df667f63f3) | 2026-09-26T08:09:03-07:00 | not proven | none | keep / inspect |
| feat/observation-only-sensor-fusion | [7b6d57c8a9c0](https://github.com/pacheco415/Occulert/commit/7b6d57c8a9c0f980a171b237803a81fd0e458c2d) | 2026-09-24T21:33:21-07:00 | not proven | none | keep / inspect |
| feat/parked-device-readiness | [f2356608e3e4](https://github.com/pacheco415/Occulert/commit/f2356608e3e4a88fe3cbd0f69617912afa200807) | 2026-09-20T20:59:26-07:00 | not proven | none | keep / inspect |
| feat/pilot-launch-checklist | [e0fd230619f2](https://github.com/pacheco415/Occulert/commit/e0fd230619f2b6e4b13a05e08cc1f3cb9ebf3fde) | 2026-09-24T22:45:15-07:00 | not proven | none | keep / inspect |
| feat/pilot-quick-start-center | [391a14f18f8f](https://github.com/pacheco415/Occulert/commit/391a14f18f8f8febac1265ff88e51e2cd4f34023) | 2026-09-25T22:38:21-07:00 | not proven | none | keep / inspect |
| feat/privacy-safe-fleet-tv-mode | [9d3d4846d134](https://github.com/pacheco415/Occulert/commit/9d3d4846d13442357f0253e00bc863f7b6b644ba) | 2026-09-24T22:22:21-07:00 | not proven | none | keep / inspect |
| feat/source-only-ux-improvements | [2b2a8d7caad7](https://github.com/pacheco415/Occulert/commit/2b2a8d7caad79f5c2fc4116f9268f0e4b9e705c8) | 2026-09-23T06:48:45-07:00 | not proven | none | keep / inspect |
| feat/web-pilot-reliability | [287f332f2c0e](https://github.com/pacheco415/Occulert/commit/287f332f2c0e716b3f86bb21e2ba754ee6d98721) | 2026-09-26T08:49:44-07:00 | not proven | none | keep / inspect |
| fix/benchmark-input-validation | [416948e983c1](https://github.com/pacheco415/Occulert/commit/416948e983c173e8bd8f88c59cf75baf90c50c76) | 2026-09-20T20:32:49-07:00 | not proven | none | keep / inspect |
| fix/offline-response-body-recovery | [cffcf5b9c97d](https://github.com/pacheco415/Occulert/commit/cffcf5b9c97dfb63d4f094b10d5ed3757a08a066) | 2026-09-26T10:11:22-07:00 | not proven | none | keep / inspect |
| improve/approved-upgrades-sept26 | [97a4bafb59aa](https://github.com/pacheco415/Occulert/commit/97a4bafb59aad1faf33393a855d5259a7569b96d) | 2026-09-26T20:42:12-07:00 | not proven | none | keep / inspect |
| release/testflight | [0cba473b6019](https://github.com/pacheco415/Occulert/commit/0cba473b601940ddcdb1843ff0c6b96ba4350f86) | 2026-08-09T14:07:44-07:00 | not proven | none | keep / inspect |
