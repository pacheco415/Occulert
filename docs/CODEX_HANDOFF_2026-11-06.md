# Development handoff review — November 6, 2026

Reviewed Claude's task list against full fetched history and main
`ec019c9609e353943bf995a3dcd074d3ed25a499`. This is a triage record,
not evidence that the roadmap has been implemented or accepted.

## In-flight work

| Task | Finding | Next action |
| --- | --- | --- |
| A1 / A2 | Open PRs #273 and #324 remain unmerged. #324 explicitly requires keeping #273 open until the coordinated runtime is accepted. The official latest Playwright release now resolves to 1.65.0; its tagged browser manifest uses WebKit r2388, versus the draft's r2370. | Evaluate the new stable runtime and exact immutable container, including the bundled/loaded libsoup fix evidence required by #324. Preserve the form probe, rendering diagnostics, complete browser matrix and bounded offline repetitions. Neither a newer revision nor release metadata proves the fixes are shipped or tests pass. |
| A3 | A local trial merge of #206 into current main produced conflicts in session creation, assets and the concurrency harness. The draft's enabled path calls `start_offboarding_aware_session`, which inserts directly without the quota enforced by main's `start_rate_limited_session`. | Compose offboarding with the accepted quota transaction and its replay/ownership validation; retain both quota and membership/deletion concurrency scenarios. Prepare fresh immutable assets after fetching history. Keep the flag off and PR draft; do not activate or merge. The trial merge was discarded, with no remote changes. |
| A4 | `codex/event-occurred-at` has four commits not patch-equivalent to main. PR #335 merged the v2 implementation. Current `src/cloud-sync.js` retains occurrence timestamps, compatibility fallback and the newer event-outbox adapter absent from the old branch. | Complete semantic comparison of all changed files before deciding deletion. Do not merge the old branch wholesale or infer redundancy from its name. |
| A5 | Both old service-worker branches produce no positive entries in `git cherry main <branch>`; their commits are patch-equivalent to main. PR #333 merged the origin-cache fix. | These are deletion candidates after owner review. No branch was deleted. |
| A6 | The old github-script branch proposes only a SHA-pinned v9.0.0 change. It has no open PR in the complete live snapshot. | Treat as an unmerged branch, not an open PR to close. Review upstream compatibility and the CI policy before proposing a replacement. |
| A7 | The live open-PR snapshot contains #324, #273 and #206. The previous status snapshot still included #356. | Refresh `docs/status-pull-requests.json` and regenerate `docs/STATUS.md` from current main. |

## Remaining scope

The branch inventory, asset retention, dependency audit, native release handoff
and roadmap implementations remain separate tasks. This status refresh does not
complete them. Keep one task per branch and verify the exact candidate before
opening or updating its draft PR. Unresolved A1–A6 work remains explicit above;
this refresh is not an acceptance gate for later sections of Claude's list.

No deployment, production migration, native build, feature activation or billing
change was performed. Owner decisions and device/data evidence in
`VISION_ROADMAP.md` remain required.

## Sources

- [Open pull requests](https://github.com/pacheco415/Occulert/pulls)
- [Coordinated runtime draft #324](https://github.com/pacheco415/Occulert/pull/324)
- [Offboarding draft #206](https://github.com/pacheco415/Occulert/pull/206)
- [Timing implementation #335](https://github.com/pacheco415/Occulert/pull/335)
- [Service-worker fix #333](https://github.com/pacheco415/Occulert/pull/333)
- [Official Playwright 1.65.0 release](https://github.com/microsoft/playwright/releases/tag/v1.65.0)
- [Tagged browser manifest](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/browsers.json)


## November 7 follow-up: current source and tooling

A remote GitHub inspection on 2026-11-08T07:01:47Z (November 7 in
America/Los_Angeles) inspected main
`444cfd867fd68c83985ff8788d1094754c97d0bd` and all five open PRs:
#385, #379, #324, #273 and #206. Four are drafts. This dated snapshot replaces
the older counts in the status page; it does not complete A1–A6 above.

PRs #388–#394 completed the editable report source, weekly asset cleanup,
offline-startup evidence and tooling updates. Each merged source received
required resulting-main checks; PR #394's final receipt records 109 passing
verification steps and passing workflows with five WebKit tests recovering
after retry. The intermittent offline failure cause remains unknown. The
failed vendor execution again had matching cache bytes before origin cut and
an empty cache-entry snapshot afterward. That observation does not establish
eviction, a causal actor or a fix.

The official Playwright latest release was rechecked as stable 1.65.0,
published November 5. A direct read of the expected
`mcr.microsoft.com/v2/playwright/manifests/v1.65.0-noble` endpoint returned
HTTP 404 in this cloud session. No immutable image digest or bundled/loaded
library evidence was obtained. This is an access/availability observation for
that URL, not proof that every image variant is absent. Keep #324 draft and
#273 open; a release tag alone does not satisfy their rendering, library,
browser-matrix and offline repetition gates.

The status document was rendered using the unchanged exported
`renderStatus` function on Node 24.22.1, with GitHub commit/tree facts and a
complete API PR snapshot. This cloud session did not run the Git-based CLI in
a full-history Mac checkout. The recursively fetched native trees were
untruncated; their path/hash/mode comparison yields 123 non-documentation
changes from build 56. Main's native tree
`404af75fd0a3f61d37c4330a50936df7884b4e11` also exactly matches the November 6
inspected source's tree, preserving that earlier local comparison. The
build-56 receipt remains historical; no current Apple or physical acceptance
check was performed. Production and migration observations remain private.
