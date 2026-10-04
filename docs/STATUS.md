# Occulert status

These are dated snapshots. Source, deployment, build availability and device tests are separate.

- Inspected source (origin/main): `7b61530065b925cd0d58c60d7772f975b72bc5da`.
- Source commit date: 2026-10-04T09:37:15-07:00.

- Production website: `7b61530065b925cd0d58c60d7772f975b72bc5da`.
- Deployment: dpl_FJteCFD9JBeQ3pJeDFRCuUeuEk3N, READY; created 2026-10-04T16:37:18.513Z.
- Production observation: 2026-10-04T16:41:36Z.

- TestFlight: 1.0.0 (56); Apple VALID, internal beta available.
- TestFlight source: `0d11ad22b66baab61ea9db6456bfaed837871537`.
- Build completed: 2026-10-03T23:44:38.728Z; availability observed 2026-10-03T23:49:49.617533+00:00.
- Physical acceptance for build 56: Not recorded.
- Native changes waiting for a build: None in the inspected source; pending PRs are separate.

- Open PRs (2026-10-04T16:41:36Z): 9 total; 8 Codex, 1 Dependabot, 0 other; 1 draft.
- Production migrations (2026-10-04): unknown. Read-only production ledger lookup failed PostgreSQL authentication (28P01); PRs #192 and #206 remain gated.

Next steps:

1. Finish current-source checks for the remaining reviewed PRs and compose them against current main.
2. Prepare the next native release and checklist after selected native changes merge; do not start a build here.
3. Record parked iPhone Silent-mode Safari/PWA alerts, Watch delivery and exact-build device checks.
4. Read the production migration ledger and confirm definitions before enabling PRs #192 and #206.
5. Review remaining security and consent changes, then benchmark parked detector flags before changing released alerts.

Refresh the Git facts with `npm run status -- --write` in a current full-history checkout.
Supply dated service receipts in `docs/status-observations.json` and a complete PR snapshot in
`docs/status-pull-requests.json`; optional `--observations FILE`, `--pull-requests FILE` and `--ref REF` override them.
The tool performs no network requests, deployments, builds, database changes or external writes.
See [product scope and evidence rules](APP_ROADMAP.md) and [earlier records](archive/APP_ROADMAP_2026-09-28.md).
