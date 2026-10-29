# Occulert status

These are dated snapshots. Source, deployment, build availability and device tests are separate.

- Inspected source (origin/main): `282aba3258a8e5a8386a0cffd5affc1d4dab2b86`.
- Source commit date: 2026-10-28T20:08:00-07:00.

- Production website: Deployment receipts are kept private; no current receipt is published here.

- Historical TestFlight receipt: 1.0.0 (56); observed Apple VALID, internal IN_BETA_TESTING.
- TestFlight source: `0d11ad22b66baab61ea9db6456bfaed837871537`.
- Build completed: 2026-10-03T23:44:38.728Z; availability observed 2026-10-03T23:49:49.617533+00:00.
- Current Apple availability, replacement upload and remote build counter: Not checked.
- Physical acceptance for build 56: Not recorded.
- Native changes waiting for a build: 67 files differ from the TestFlight source.
  - native-app/app.json
  - native-app/app/history.tsx
  - native-app/app/monitor.tsx
  - native-app/app/settings.tsx
  - native-app/components/AlertSystem.tsx
  - 62 more; inspect the source comparison before preparing a binary.

- Open PRs (2026-10-29T03:09:24Z): 13 total; 6 Codex, 6 Dependabot, 1 other; 3 draft.
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
