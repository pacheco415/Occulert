# Occulert status

Snapshot only. Run npm run status before relying on PR counts or deploy state.

These are dated snapshots. Source, deployment, build availability and device tests are separate.

- Inspected source (origin/main): `39c32652ac3742f451077d0849125e0c382816d2`.
- Source commit date: 2026-10-04T13:55:00-07:00.

- Production website: Live assets observed 2026-10-04T21:52:06Z match main #258: `occulert-v111`, `driver-app.v83.js` (bytes verified).
- Exact deployed Git commit and deployment ID: Unknown; no new READY deployment receipt supplied.
- Previous READY deployment receipt remains historical in `docs/status-observations.json`.

- TestFlight: 1.0.0 (56); Apple VALID, internal beta available.
- TestFlight source: `0d11ad22b66baab61ea9db6456bfaed837871537`.
- Build completed: 2026-10-03T23:44:38.728Z; availability observed 2026-10-03T23:49:49.617533+00:00.
- Physical acceptance for build 56: Not recorded.
- Native changes waiting for a build: 25 files differ from the TestFlight source.
  - native-app/app.json
  - native-app/app/history.tsx
  - native-app/app/monitor.tsx
  - native-app/app/settings.tsx
  - native-app/components/AlertSystem.tsx
  - 20 more; inspect the source comparison before preparing a binary.

- Open PRs (2026-10-04T21:52:06Z): 2 total; 2 Codex, 0 Dependabot, 0 other; 1 draft.
- Production migrations (2026-10-04): unknown. Read-only production ledger lookup failed PostgreSQL authentication (28P01); PRs #192 and #206 remain gated.

Next steps:

1. Finish current-source checks for the remaining reviewed PRs and compose them against current main.
2. Build the current main candidate using `docs/RELEASE_2026-10-04.md`, then record exact-build device checks.
3. Record parked iPhone Silent-mode Safari/PWA alerts, Watch delivery and exact-build device checks.
4. Read the production migration ledger and confirm definitions before enabling PRs #192 and #206.
5. Review remaining security and consent changes, then benchmark parked detector flags before changing released alerts.

Refresh the Git facts with `npm run status -- --write` in a current full-history checkout.
Supply dated service receipts in `docs/status-observations.json` and a complete PR snapshot in
`docs/status-pull-requests.json`; optional `--observations FILE`, `--pull-requests FILE` and `--ref REF` override them.
The tool performs no network requests, deployments, builds, database changes or external writes.
See [product scope and evidence rules](APP_ROADMAP.md) and [earlier records](archive/APP_ROADMAP_2026-09-28.md).
