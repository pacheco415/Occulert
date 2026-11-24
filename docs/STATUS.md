# Occulert status

These are dated snapshots. Source, deployment, build availability and device tests are separate.

- Inspected source (origin/main): `4a734292c071b6d95b47a9e49cf066c9d5b448c4`.
- Source commit date: 2026-11-22T09:55:30-08:00.

- Production website: Deployment receipts are kept private; no current receipt is published here.

- Historical TestFlight dashboard receipt: 1.0.0 (60); observed Ready to Submit, upload Complete; internal group assigned.
- TestFlight source: `21ab21cd02666a7c825ba6b037f543133481eb3a`.
- Build completed: 2026-11-04T05:05:40.475Z; saved dashboard receipt records internal availability as of 2026-11-11T02:46:45Z.
- Current Apple availability, replacement upload and remote build counter: Not checked.
- Physical acceptance for build 60: Not recorded.
- Native changes waiting for a build: 116 files differ from the TestFlight source.
  - native-app/app.config.js
  - native-app/app.json
  - native-app/app/\_layout.tsx
  - native-app/app/history.tsx
  - native-app/app/index.tsx
  - 111 more; inspect the source comparison before preparing a binary.

- Open PRs (2026-11-24T00:23:25.412Z): 6 total; 5 Codex, 1 Dependabot, 0 other; 0 draft.
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
