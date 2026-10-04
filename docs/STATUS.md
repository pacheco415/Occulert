# Occulert status

These are dated snapshots. Source, deployment, build availability and device tests are separate.

- Inspected source (origin/main): `e00e2834eb6ea5e118f9334a57c237f0f6cf7e21`.
- Source commit date: 2026-10-03T17:56:08-07:00.

- Production website: `0d11ad22b66baab61ea9db6456bfaed837871537`.
- Deployment: dpl_DJCCTk2wdrBiEFxPF8WSWdjQCZGN, READY; created 2026-10-03T23:20:35.697Z.
- Production observation: 2026-10-04.

- TestFlight: 1.0.0 (56); Apple VALID, internal beta available.
- TestFlight source: `0d11ad22b66baab61ea9db6456bfaed837871537`.
- Build completed: 2026-10-03T23:44:38.728Z; availability observed 2026-10-03T23:49:49.617533+00:00.
- Physical acceptance for build 56: Not recorded.
- Native changes waiting for a build: None in the inspected source; pending PRs are separate.

- Open PRs (2026-10-04T00:56:41Z): 32 total; 27 Codex, 5 Dependabot, 0 other; 1 draft.
- Production migrations (2026-10-04): unknown. Read-only production ledger lookup failed PostgreSQL authentication (28P01); PRs #192 and #206 remain gated.

Next steps:

1. Finish pipeline checks and merge the reviewed API, fleet and browser PRs against current main.
2. Prepare the next native release and checklist after selected native changes merge; do not start a build here.
3. Record parked iPhone Silent-mode Safari/PWA alerts, Watch delivery and exact-build device checks.
4. Read the production migration ledger and confirm definitions before enabling PRs #192 and #206.
5. Complete security hardening, then benchmark parked detector flags before changing released alerts.

Refresh the Git facts with `npm run status -- --write` in a current full-history checkout.
Supply dated service receipts in `docs/status-observations.json` and a complete PR snapshot in
`docs/status-pull-requests.json`; optional `--observations FILE`, `--pull-requests FILE` and `--ref REF` override them.
The tool performs no network requests, deployments, builds, database changes or external writes.
See [product scope and evidence rules](APP_ROADMAP.md) and [earlier records](archive/APP_ROADMAP_2026-09-28.md).
