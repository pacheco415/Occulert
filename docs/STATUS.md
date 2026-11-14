# Occulert status

These are dated snapshots. Source, deployment, build availability and device tests are separate.

- Inspected source (origin/main): `a39bf4a8fbe9fff57a9214893eb3c0e29b009217`.
- Source commit date: 2026-11-14T18:50:06Z.

- Production website: Deployment receipts are kept private; no current receipt is published here.

- Historical TestFlight dashboard receipt: 1.0.0 (60); observed Ready to Submit, upload Complete; internal group assigned.
- TestFlight source: `21ab21cd02666a7c825ba6b037f543133481eb3a`.
- Build completed: 2026-11-04T05:05:40.475Z; saved dashboard receipt records internal availability as of 2026-11-11T02:46:45Z.
- Current Apple availability, replacement upload and remote build counter: Not checked.
- Physical acceptance for build 60: Not recorded.
- Native changes waiting for a build: 10 files differ from the TestFlight source.
  - native-app/app/index.tsx
  - native-app/components/CloudSyncCard.tsx
  - native-app/lib/cloudSync.ts
  - native-app/lib/strings.ts
  - native-app/package-lock.json
  - 5 more; inspect the source comparison before preparing a binary.

- Open PRs (2026-11-14T18:53:41Z): 13 total; 11 Codex, 2 Dependabot, 0 other; 3 draft.
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
