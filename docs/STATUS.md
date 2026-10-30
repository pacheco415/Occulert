# Occulert status

These are dated snapshots. Source, deployment, build availability and device tests are separate.

- Inspected source (origin/main): `b8b5494999ef9a075edb2d4edcc84cf536f50ee7`.
- Source commit date: 2026-10-29T20:43:59-07:00.

- Production website: Deployment receipts are kept private; no current receipt is published here.

- Historical TestFlight receipt: 1.0.0 (56); observed Apple VALID, internal IN_BETA_TESTING.
- TestFlight source: `0d11ad22b66baab61ea9db6456bfaed837871537`.
- Build completed: 2026-10-03T23:44:38.728Z; availability observed 2026-10-03T23:49:49.617533+00:00.
- Current Apple availability, replacement upload and remote build counter: Not checked.
- Physical acceptance for build 56: Not recorded.
- Native changes waiting for a build: 105 files differ from the TestFlight source.
  - native-app/app.config.js
  - native-app/app.json
  - native-app/app/\_layout.tsx
  - native-app/app/history.tsx
  - native-app/app/monitor.tsx
  - 100 more; inspect the source comparison before preparing a binary.

- Open PRs (2026-10-30T03:45:33.639Z): 6 total; 4 Codex, 1 Dependabot, 1 other; 3 draft.
- Production migrations: Operational receipts are kept private; no ledger or access-control details are published here.

Next steps:

1. Finish current-source checks for the remaining reviewed PRs and compose them against current main.
2. Review the native release intent and exact-build device checklist for the inspected source; a build remains a separate action.
3. Record parked iPhone Silent-mode Safari/PWA alerts, Watch delivery and exact-build device checks.
4. Keep production receipts private; review deployment prerequisites and the separate #206 decision before enabling dependent features.
5. Review remaining security and consent changes, then benchmark parked detector flags before changing released alerts.

Refresh the Git facts with `npm run status -- --write` in a current full-history checkout.
Supply only approved public snapshots in `docs/status-observations.json` and a complete PR snapshot in
`docs/status-pull-requests.json`; optional `--observations FILE`, `--pull-requests FILE` and `--ref REF` override them.
The tool performs no network requests, deployments, builds, database changes or external writes.
See [product scope and evidence rules](APP_ROADMAP.md) and [earlier records](archive/APP_ROADMAP_2026-09-28.md).
